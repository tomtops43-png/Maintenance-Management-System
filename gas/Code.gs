/**
 * Maintenance Management System (BM + PM)
 * Google Apps Script Web App — REST API over Google Sheets + Google Drive.
 *
 * Deploy: Deploy > New deployment > Web app
 *   - Execute as: Me
 *   - Who has access: Anyone
 * Script Properties (File > Project settings > Script properties):
 *   - SPREADSHEET_ID  : id of the "Record_Downtime" spreadsheet (optional if bound)
 *   - FOLDER_ID       : id of the Drive folder to hold Maintenance_Photos (optional)
 *
 * All requests come through doPost as JSON: { action, payload, user }
 * All responses:                              { success, data, error }
 *
 * The frontend calls with Content-Type text/plain to avoid CORS preflight.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// The two original sheets. Both predate this app — the request sheet carries
// legacy A–J columns (Job order No. / 1% / Progress %) and the repair sheet is
// a Google Form response sheet. They are now READ-ONLY archives: the app
// writes to its own H9 sheets below and never touches these again.
var SHEET_BM_REQ   = 'Record แจ้งซ่อม '; // NOTE: trailing space is intentional
var SHEET_BM_REP   = 'Record ซ่อม';

var SHEET_BM_REQ_H9   = 'Record แจ้งซ่อม H9';
var SHEET_BM_REP_H9   = 'Record ซ่อม H9';
var SHEET_BM_REQ_ASSY = 'Record แจ้งซ่อม ASSY';
var SHEET_BM_REP_ASSY = 'Record ซ่อม ASSY';
var SHEET_WORK     = 'Work_Actual';
var SHEET_PM_MAST  = 'PM_MASTER';
var SHEET_PM_REC   = 'PM_RECORDS';
var SHEET_CONFIG   = 'CONFIG';
var SHEET_USERS    = 'USERS';
var SHEET_KB_ART   = 'KB_ARTICLES';
var SHEET_KB_FB    = 'KB_FEEDBACK';
var SHEET_SESSIONS = 'SESSIONS';

// How long a login stays valid. Long on purpose: this is a shop-floor tool
// logged into once per phone, and being thrown back to a PIN screen mid-shift
// is how people stop filing reports at all.
var SESSION_DAYS = 30;

// Marker the client watches for to send someone back to the login screen
// rather than showing a raw error. Appended to the message because the
// response envelope only carries { success, data, error }.
var ERR_SESSION = '[SESSION_EXPIRED]';

var PHOTO_ROOT_FOLDER = 'Maintenance_Photos';

// ---------------------------------------------------------------------------
// BM "books" — one production area = one pair of sheets + its own photo folder
// ---------------------------------------------------------------------------
//
// Every area writes the SAME 20-column request layout and the same repair
// fields, so all the read/write code below is shared: only the sheet name,
// the MT Job No. prefix and the Drive folder differ. That keeps adding an
// area cheap, at the cost of a few always-blank legacy columns (Job order
// No. / No. / 1%) in the newer sheets.
//
// Rules that make routing work without the client having to know about books:
//   - every non-default book MUST have a unique, non-empty MT prefix, so a
//     job can always be traced back to its sheet from its number alone;
//   - which area maps to which book comes from CONFIG (Type='Area', Parent =
//     book key), so an admin can add an area without a code change. Anything
//     unmapped falls back to DEFAULT_BOOK.
//
// Machine selection is three levels deep and uniform across areas:
//   ไลน์หลัก (Area)  ->  ไลน์/เครื่องหลัก (Line)  ->  M/C (Station)
//   ENC H9           ->  Line 1 / 4 / 5           ->  Station 1..21
//   Assembly M/C     ->  Arc chute / GV.2         ->  Arc chute 06 / 07 / 08
// Levels 2 and 3 land in the same sheet columns they always did (Production
// line / M/C No.), so records written before areas existed still line up.
var BOOKS = {
  ENC: {
    key: 'ENC',
    label: 'ENC H9',
    req: SHEET_BM_REQ_H9,
    rep: SHEET_BM_REP_H9,
    // Everything recorded before this app existed stays where it is. It's
    // still read (the Dashboard and ประวัติ show one continuous picture) but
    // never written to, so the messy legacy shapes stop spreading.
    reqArchive: SHEET_BM_REQ,
    repArchive: SHEET_BM_REP,
    prefix: '',                 // legacy numbering: 06082026-1
    photoFolder: 'ENC H9',
    lineGroupProp: 'LINE_GROUP_ID'
  },
  ASSY: {
    key: 'ASSY',
    label: 'Assembly M/C',
    req: SHEET_BM_REQ_ASSY,
    rep: SHEET_BM_REP_ASSY,
    prefix: 'AS-',              // AS-06082026-1
    photoFolder: 'Assembly M-C', // "/" is confusing in a Drive path — use "-"
    lineGroupProp: 'LINE_GROUP_ID_ASSY'
  }
};
var DEFAULT_BOOK = 'ENC';

// Record แจ้งซ่อม column layout (1-based). A–J are existing, K–S are added.
var BM = {
  TIMESTAMP:   1,  // A ประทับเวลา
  DATE:        2,  // B Date
  SHIFT:       3,  // C Shift
  LINE:        4,  // D Production line
  MC:          5,  // E M/C No.
  JOB_ORDER:   6,  // F Job order No.
  NO:          7,  // G No.
  MT_JOB:      8,  // H MT job No.
  PCT1:        9,  // I 1%
  PROGRESS:    10, // J Progress %
  SYMPTOM:     11, // K Symptom
  PRIORITY:    12, // L Priority
  REPORTER:    13, // M Reporter
  PHOTO_BEFORE:14, // N Photo_Before_URL
  STATUS:      15, // O Status
  ACCEPT_DT:   16, // P Accept_DateTime
  FINISH_DT:   17, // Q Finish_DateTime
  DOWNTIME:    18, // R Downtime_Min
  MACHINE_STOP:19, // S Machine_Stop
  AREA:        20  // T Area — ไลน์หลัก (ENC H9 / Assembly M/C). Blank on rows
                   //   written before areas existed; those are all ENC H9,
                   //   which is why blank reads back as the default area.
};
var BM_WIDTH = 20;

// Status flow
var ST_NEW    = 'แจ้งซ่อม';
var ST_ACCEPT = 'รับงานแล้ว';
var ST_REPAIR = 'กำลังซ่อม';
var ST_WAIT   = 'รออะไหล่';
var ST_DONE   = 'ปิดงาน';

// Data columns we manage inside "Record ซ่อม" (looked up / appended by header name).
var REP_FIELDS = [
  'MT Job No.', 'Date', 'Shift', 'Area', 'Production line', 'Station', 'Main_Issue',
  'Issue', 'Detail', 'Improvements', 'Spare_Parts', 'By', 'Time_Min', 'Photo_After_URL'
];

// ---------------------------------------------------------------------------
// Book routing
// ---------------------------------------------------------------------------

/** Area -> book key, read from CONFIG rows Type='Area' (Value=area name,
 * Parent=book key; blank Parent means the default book). Cached for the life
 * of one execution — every BM call touches this and re-reading CONFIG per row
 * would be wasteful. */
var _areaBookCache = null;
function areaBookMap() {
  if (_areaBookCache) return _areaBookCache;
  var map = {};
  try {
    var sh = getSheet(SHEET_CONFIG);
    if (sh) {
      var values = sh.getDataRange().getValues();
      for (var r = 1; r < values.length; r++) {
        if (String(values[r][0] || '').trim() !== 'Area') continue;
        var area = String(values[r][1] || '').trim();
        var key  = String(values[r][2] || '').trim().toUpperCase();
        if (area) map[area] = BOOKS[key] ? key : DEFAULT_BOOK;
      }
    }
  } catch (e) {
    Logger.log('areaBookMap failed, falling back to default book: ' + e);
  }
  _areaBookCache = map;
  return map;
}

function bookForArea(area) {
  var key = areaBookMap()[String(area || '').trim()];
  return BOOKS[key] || BOOKS[DEFAULT_BOOK];
}

/** ไลน์/เครื่องหลัก -> ไลน์หลัก, from CONFIG Line rows. Lets records that only
 * carry a line (PM plans, KB articles) still find their area. */
var _lineAreaCache = null;
function lineAreaMap() {
  if (_lineAreaCache) return _lineAreaCache;
  var map = {};
  try {
    var sh = getSheet(SHEET_CONFIG);
    if (sh) {
      var values = sh.getDataRange().getValues();
      for (var r = 1; r < values.length; r++) {
        if (String(values[r][0] || '').trim() !== 'Line') continue;
        var line = String(values[r][1] || '').trim();
        var area = String(values[r][2] || '').trim();
        if (line && area) map[line] = area;
      }
    }
  } catch (e) {
    Logger.log('lineAreaMap failed, falling back to default area: ' + e);
  }
  _lineAreaCache = map;
  return map;
}

function areaForLine(line) {
  return lineAreaMap()[String(line || '').trim()] || defaultAreaName();
}

/** The area name that owns the default book — the one blank Area cells on
 * legacy rows (and blank-Parent Station rows) implicitly belong to. */
function defaultAreaName() {
  var map = areaBookMap();
  for (var area in map) { if (map[area] === DEFAULT_BOOK) return area; }
  return BOOKS[DEFAULT_BOOK].label;
}

/** Resolve a job's book from its MT Job No. alone, so status/close calls
 * don't need the client to remember which area a job came from. */
function bookForMTJob(mtJob) {
  var mt = String(mtJob || '').trim();
  for (var k in BOOKS) {
    var b = BOOKS[k];
    if (b.prefix && mt.indexOf(b.prefix) === 0) return b;
  }
  return BOOKS[DEFAULT_BOOK];
}

function allBooks() {
  return Object.keys(BOOKS).map(function (k) { return BOOKS[k]; });
}

/** Every sheet a book's requests can live in, live sheet first. The archive
 * only exists for ENC, whose history predates this app. Order matters: the
 * first sheet to yield a given MT Job No. is the one that wins. */
function bookRequestSheets(book) {
  return [book.req, book.reqArchive].filter(Boolean);
}

function bookRepairSheets(book) {
  return [book.rep, book.repArchive].filter(Boolean);
}

/** MT Job No. shape for one book: [prefix]DDMMYYYY-n */
function mtJobRe(book) {
  var p = book && book.prefix ? book.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
  return new RegExp('^' + p + '\\d{8}-\\d+$');
}

/** True for any book's numbering — used where rows from several sheets are
 * screened together (repair sheets, garbage-row filtering). */
function isValidMTJob(mt) {
  var s = String(mt || '').trim();
  return allBooks().some(function (b) { return mtJobRe(b).test(s); });
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

function doGet(e) {
  // Health check / manual browser test.
  return jsonOut({ success: true, data: { service: 'Maintenance MS', time: new Date() } });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut({ success: false, error: 'รูปแบบข้อมูลไม่ถูกต้อง (invalid JSON)' });
  }

  var action  = req.action;
  var payload = req.payload || {};
  var user    = req.user || {};

  try {
    var data;
    switch (action) {
      case 'ping':           data = { pong: true }; break;
      case 'login':          data = apiLogin(payload); break;
      case 'logout':         data = { ok: revokeSession(user && user.token) }; break;
      case 'getUserNames':   data = apiGetUserNames(); break;
      case 'getConfig':      data = apiGetConfig(); break;
      case 'createBM':       data = apiCreateBM(payload, user); break;
      case 'getBMJobs':      data = apiGetBMJobs(payload); break;
      case 'updateBMStatus': data = apiUpdateBMStatus(payload, user); break;
      case 'closeBM':        data = apiCloseBM(payload, user); break;
      case 'getPMMaster':    data = apiGetPMMaster(payload); break;
      case 'getPMDue':       data = apiGetPMDue(payload); break;
      case 'submitPM':       data = apiSubmitPM(payload, user); break;
      case 'getDashboard':   data = apiGetDashboard(payload); break;
      case 'getHistory':     data = apiGetHistory(payload); break;
      case 'getMachineHistory': data = apiGetMachineHistory(payload); break;
      case 'adminCRUD':      data = apiAdminCRUD(payload, user); break;
      case 'getKBList':      data = apiGetKBList(payload); break;
      case 'getKBDetail':    data = apiGetKBDetail(payload); break;
      case 'searchKB':       data = apiSearchKB(payload); break;
      case 'saveKB':         data = apiSaveKB(payload, user); break;
      case 'deleteKB':       data = apiDeleteKB(payload, user); break;
      case 'getRepairDetail': data = apiGetRepairDetail(payload); break;
      case 'getKBRelated':   data = apiGetKBRelated(payload); break;
      case 'setup':          data = ensureSheets(); break;
      default:
        return jsonOut({ success: false, error: 'ไม่รู้จัก action: ' + action });
    }
    return jsonOut({ success: true, data: data });
  } catch (err) {
    Logger.log('doPost error [action=' + action + ']: ' + (err && err.stack ? err.stack : err));
    return jsonOut({ success: false, error: (err && err.message) ? err.message : String(err) });
  }
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// Spreadsheet access
// ---------------------------------------------------------------------------

function getSS() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error('ไม่พบ SPREADSHEET_ID ใน Script Properties');
}

/** Find a sheet by exact name, tolerant of trailing/leading spaces. */
function getSheet(name) {
  var ss = getSS();
  var sh = ss.getSheetByName(name);
  if (sh) return sh;
  var trimmed = String(name).trim();
  var all = ss.getSheets();
  for (var i = 0; i < all.length; i++) {
    if (all[i].getName().trim() === trimmed) return all[i];
  }
  return null;
}

function getSheetOrThrow(name) {
  var sh = getSheet(name);
  if (!sh) throw new Error('ไม่พบชีท "' + name + '"');
  return sh;
}

// ---------------------------------------------------------------------------
// Setup: create new sheets + seed CONFIG / USERS
// ---------------------------------------------------------------------------

/** Bumped whenever ensureSheets() gains work that an existing spreadsheet
 * needs done to it. Stored in Script Properties so the full pass runs once
 * per deploy instead of on every single getConfig call. */
var SETUP_VERSION = '2026-08-11-h9-own-sheets';
var SETUP_PROP = 'SETUP_VERSION';

/**
 * Cheap guard for the request path. ensureSheets() makes dozens of individual
 * Sheets calls — formatting columns, checking headers, reading CONFIG — and
 * apiGetConfig() runs on every page load. Doing that per request is what made
 * the app slow, and enough concurrent traffic is what makes Sheets throw
 * "Service Spreadsheets timed out". Once a deploy has completed it once,
 * later requests skip straight past.
 */
function ensureSheetsOnce() {
  if (PropertiesService.getScriptProperties().getProperty(SETUP_PROP) === SETUP_VERSION) return;
  ensureSheets(); // stamps on success; a failure part-way leaves it to retry
}

/**
 * Idempotent: run once after deploy (or auto-run lazily) to bootstrap new
 * sheets. Always does the full pass — the editor's Run button and the `setup`
 * action both land here, and "I ran setup and it did nothing" is worse than a
 * few seconds of redundant work.
 */
function ensureSheets() {
  var ss = getSS();
  var created = [];

  if (!getSheet(SHEET_CONFIG)) {
    var cfg = ss.insertSheet(SHEET_CONFIG);
    cfg.getRange(1, 1, 1, 4).setValues([['Type', 'Value', 'Parent', 'Active']]);
    seedConfig(cfg);
    created.push(SHEET_CONFIG);
  }
  if (!getSheet(SHEET_USERS)) {
    var usr = ss.insertSheet(SHEET_USERS);
    usr.getRange(1, 1, 1, 6).setValues([['Emp_ID', 'Name', 'Role', 'Line', 'PIN', 'Shift']]);
    // Force Emp_ID/PIN columns to Plain text BEFORE writing, so Sheets
    // doesn't silently coerce "0001" into the number 1 (dropping the
    // leading zero — the classic Sheets numeric-string auto-detect gotcha).
    usr.getRange('A2:A1000').setNumberFormat('@');
    usr.getRange('E2:E1000').setNumberFormat('@');
    usr.getRange(2, 1, 3, 6).setValues([
      ['0001', 'ผู้ดูแลระบบ',  'Manager',    '',       '1234', 'A'],
      ['0002', 'ช่างสมชาย',    'Technician', 'Line 1', '1111', 'A'],
      ['0003', 'หัวหน้ากะ',    'Supervisor', 'Line 4', '2222', 'B']
    ]);
    created.push(SHEET_USERS);
  } else {
    // Existing sheet: whatever order the columns are actually in (they've
    // drifted before — a column got deleted by hand and broke position-based
    // reads), find Emp_ID/PIN by header name and force them to Plain text.
    // Only append a new "Shift" column if one doesn't already exist anywhere.
    var existingUsr = getSheet(SHEET_USERS);
    var exMap = userColMap(existingUsr);
    if (exMap.empId >= 0) existingUsr.getRange(2, exMap.empId + 1, 999).setNumberFormat('@');
    if (exMap.pin >= 0) existingUsr.getRange(2, exMap.pin + 1, 999).setNumberFormat('@');
    if (exMap.shift < 0) {
      var nextCol = existingUsr.getLastColumn() + 1;
      existingUsr.getRange(1, nextCol).setValue('Shift');
    }
  }
  if (!getSheet(SHEET_PM_MAST)) {
    var pm = ss.insertSheet(SHEET_PM_MAST);
    pm.getRange(1, 1, 1, 12).setValues([[
      'PM_ID', 'Line', 'MC_Station', 'PM_Item', 'Standard',
      'Frequency', 'Last_Done', 'Next_Due', 'Assigned_To', 'Active', 'Notes', 'Photo_URL'
    ]]);
    created.push(SHEET_PM_MAST);
  } else {
    // Existing sheets predate the Notes / Photo_URL columns (added for the
    // richer "add PM plan" form) — append whichever of the two are missing,
    // by header name so this is safe to re-run regardless of column count.
    var existingPm = getSheet(SHEET_PM_MAST);
    var pmHeaders = existingPm.getRange(1, 1, 1, existingPm.getLastColumn()).getValues()[0];
    ['Notes', 'Photo_URL'].forEach(function (h) {
      if (pmHeaders.indexOf(h) < 0) {
        existingPm.getRange(1, existingPm.getLastColumn() + 1).setValue(h);
      }
    });
  }
  if (ensureSheetWithHeaders(ss, SHEET_PM_REC, [
    'Record_ID', 'PM_ID', 'Done_DateTime', 'Technician', 'Result',
    'NG_Detail', 'Action_Taken', 'Photo_URL', 'Status'
  ])) created.push(SHEET_PM_REC);

  if (!getSheet(SHEET_KB_ART)) {
    var kb = ss.insertSheet(SHEET_KB_ART);
    kb.getRange(1, 1, 1, 23).setValues([[
      'KB_ID', 'Title', 'Category', 'Main_Issue', 'Line', 'Station', 'Symptom_Keywords',
      'Problem', 'Root_Cause', 'Solution', 'Prevention', 'Tools', 'Spare_Parts', 'Time_Est',
      'Warning', 'Photo_URLs', 'Ref_MTJobNo', 'Author', 'Created_Date', 'Updated_Date',
      'Views', 'Helpful_Count', 'Status'
    ]]);
    seedKB(kb);
    created.push(SHEET_KB_ART);
  }
  if (ensureSheetWithHeaders(ss, SHEET_KB_FB,
    ['Feedback_ID', 'KB_ID', 'Emp_ID', 'Action', 'DateTime'])) created.push(SHEET_KB_FB);

  if (ensureSheetWithHeaders(ss, SHEET_SESSIONS, ['Token', 'Emp_ID', 'Created', 'Expires'])) {
    // Emp_ID as plain text, or Sheets turns "0001" into 1 and the token stops
    // matching the user it was issued to.
    getSheet(SHEET_SESSIONS).getRange('B2:B').setNumberFormat('@');
    created.push(SHEET_SESSIONS);
  }

  var headersAdded = ensureBMRequestHeaders();
  if (headersAdded) created.push(SHEET_BM_REQ + ' (headers K–S)');

  // Every area writes to its own pair — including ENC H9, whose originals are
  // now read-only archives rather than write targets.
  allBooks().forEach(function (b) {
    if (ensureSheetWithHeaders(ss, b.req, BM_REQUEST_HEADERS)) created.push(b.req);
    if (ensureSheetWithHeaders(ss, b.rep, REP_FIELDS)) created.push(b.rep);
  });

  // Every request sheet must physically have BM_WIDTH columns before we can
  // read/write a full row — the Area column (T) is newer than the sheets.
  allBooks().forEach(function (b) {
    var sh = getSheet(b.req);
    if (!sh) return;
    if (sh.getMaxColumns() < BM_WIDTH) {
      sh.insertColumnsAfter(sh.getMaxColumns(), BM_WIDTH - sh.getMaxColumns());
    }
    var t1 = String(sh.getRange(1, BM.AREA).getValue() || '').trim();
    // 'Main_MC' was this column's name for one deploy before the three-level
    // ไลน์หลัก/ไลน์/เครื่อง structure replaced it.
    if (!t1 || t1 === 'Main_MC') sh.getRange(1, BM.AREA).setValue('Area');

    var repSh = getSheet(b.rep);
    if (repSh) renameHeader(repSh, 'Main_MC', 'Area');
  });

  if (ensureAreaConfig()) created.push(SHEET_CONFIG + ' (ไลน์หลัก/เครื่องจักร)');

  // Only stamped once every step above has succeeded — a run that dies
  // half-way (Sheets timing out mid-write) must be retried, not skipped.
  PropertiesService.getScriptProperties().setProperty(SETUP_PROP, SETUP_VERSION);

  return { created: created, message: created.length ? 'สร้างชีทใหม่แล้ว' : 'ชีทครบถ้วนแล้ว' };
}

/**
 * Create a sheet if it's missing, and write its header row if row 1 is blank.
 *
 * That second half matters: Sheets can time out *between* insertSheet() and
 * the header write (it has), leaving an empty sheet that every later run
 * skips over as "already there" — so the sheet exists forever with no
 * headers and nothing reads it correctly. Checking A1 makes a half-finished
 * create heal itself on the next run.
 *
 * Returns true if it created or repaired anything.
 */
function ensureSheetWithHeaders(ss, name, headers) {
  var sh = getSheet(name);
  var touched = false;
  if (!sh) { sh = ss.insertSheet(name); touched = true; }
  if (!String(sh.getRange(1, 1).getValue() || '').trim()) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    touched = true;
  }
  return touched;
}

/** Full header row for a brand-new area's request sheet. Mirrors the legacy
 * ENC H9 layout column-for-column (blank-but-present A–J) so every reader
 * and writer in this file works on either sheet without branching. */
var BM_REQUEST_HEADERS = [
  'ประทับเวลา', 'Date', 'Shift', 'Production line', 'M/C No.', 'Job order No.',
  'No.', 'MT job No.', '1%', 'Progress %', 'Symptom', 'Priority', 'Reporter',
  'Photo_Before_URL', 'Status', 'Accept_DateTime', 'Finish_DateTime',
  'Downtime_Min', 'Machine_Stop', 'Area'
];

/** Rename a header cell in place, leaving whatever data sits under it alone.
 * No-op unless `from` exists and `to` doesn't, so re-running can't collapse
 * two real columns into one. */
function renameHeader(sh, from, to) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var fromIdx = -1;
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] || '').trim();
    if (h === to) return false;      // already renamed (or both exist — leave it)
    if (h === from) fromIdx = c;
  }
  if (fromIdx < 0) return false;
  sh.getRange(1, fromIdx + 1).setValue(to);
  return true;
}

/**
 * Bring an EXISTING CONFIG sheet up to the three-level ไลน์หลัก/ไลน์/เครื่อง
 * structure. seedConfig() only runs on a fresh install, so without this an
 * already-deployed sheet would never grow the Area rows.
 *
 * Also cleans up after the one deploy that shipped a flatter, two-level
 * shape (Type=LineBook/MainMC/SubMC, plus a Line row for 'Assembly M/C'
 * itself). Those rows are ours, not hand-entered, and leaving them behind
 * would put 'Assembly M/C' in the ไลน์ dropdown *under* ENC H9 — so they're
 * dropped rather than left to rot.
 *
 * Idempotent, and never touches a (Type, Value) pair it didn't put there.
 */
function ensureAreaConfig() {
  var sh = getSheet(SHEET_CONFIG);
  if (!sh) return false;
  var values = sh.getDataRange().getValues();
  var changed = false;
  var DEFAULT_AREA = BOOKS[DEFAULT_BOOK].label; // 'ENC H9'

  // 1. Drop rows from the superseded two-level shape (bottom-up: deleting a
  //    row shifts every row under it).
  var OBSOLETE_TYPES = { LineBook: true, MainMC: true, SubMC: true };
  for (var r = values.length - 1; r >= 1; r--) {
    var type = String(values[r][0] || '').trim();
    var val  = String(values[r][1] || '').trim();
    if (OBSOLETE_TYPES[type] || (type === 'Line' && val === 'Assembly M/C')) {
      sh.deleteRow(r + 1);
      values.splice(r, 1);
      changed = true;
    }
  }

  // 2. Existing Line rows are all ENC H9's, from before areas existed: undo
  //    the "H9 " disambiguation prefix (the area column carries that now, and
  //    every historical record still says "Line 4") and adopt them into it.
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0] || '').trim() !== 'Line') continue;
    var name = String(values[i][1] || '').trim();
    var stripped = name.replace(/^H9\s+(?=Line\s)/i, '');
    if (stripped !== name) { sh.getRange(i + 1, 2).setValue(stripped); values[i][1] = stripped; changed = true; }
    if (!String(values[i][2] || '').trim()) {
      sh.getRange(i + 1, 3).setValue(DEFAULT_AREA); values[i][2] = DEFAULT_AREA; changed = true;
    }
  }

  // 3. Append whatever the target structure is still missing.
  var seen = {};
  for (var s = 1; s < values.length; s++) {
    seen[String(values[s][0] || '').trim() + '||' + String(values[s][1] || '').trim()] = true;
  }
  var missing = areaConfigRows().filter(function (row) { return !seen[row[0] + '||' + row[1]]; });
  if (missing.length) {
    sh.getRange(sh.getLastRow() + 1, 1, missing.length, 4).setValues(missing);
    changed = true;
  }

  if (changed) { _areaBookCache = null; _lineAreaCache = null; }
  return changed;
}

/** ไลน์หลัก + their lines/machines, as CONFIG rows [Type, Value, Parent, Active].
 *
 * ENC H9's own Line rows aren't listed here — they already exist on every
 * deployed sheet and ensureAreaConfig() adopts them into the default area
 * instead, so this never fights a hand-renamed line. Its Station 1..21 rows
 * keep their blank Parent, which reads as "every line in the default area".
 *
 * Machines beyond the ones seeded here are meant to be added from the
 * Settings page (Type=Station, Parent=<ไลน์/เครื่องหลัก>) — no code change. */
function areaConfigRows() {
  var ASSY = 'Assembly M/C';
  var rows = [
    ['Area', BOOKS[DEFAULT_BOOK].label, '', true],   // ENC H9 -> default book
    ['Area', ASSY, 'ASSY', true],
    ['Line', 'Arc chute', ASSY, true],
    ['Line', 'GV.2', ASSY, true]
  ];
  ['06', '07', '08'].forEach(function (n) {
    rows.push(['Station', 'Arc chute ' + n, 'Arc chute', true]);
  });
  return rows;
}

/** 5 starter articles so the Knowledge Base isn't empty on day one — an
 * empty KB means nobody comes back to check it. Drafted from the kinds of
 * recurring issues this line actually sees; technicians can edit freely. */
function seedKB(sh) {
  var now = new Date();
  var rows = [
    ['KB-0001', 'โซ่ Station 10 ตกบ่อย - วิธีตั้งความตึงที่ถูกต้อง', 'Repair_Case', 'Mechanical', 'Line 4', 'Station 10',
      'โซ่ตก,โซ่หย่อน,chain,สายพานหลุด,โซ่ขาด',
      'โซ่ขับเคลื่อนหลุดออกจากเฟือง หรือหย่อนจนกระตุกขณะเครื่องทำงาน',
      'ความตึงโซ่ไม่ได้มาตรฐาน หรือเฟืองสึกหรอจนโซ่ไม่เข้าร่องพอดี',
      '1. ปิดเครื่องและล็อกพลังงานก่อนทุกครั้ง\n2. คลายน็อตยึดมอเตอร์ปรับความตึง\n3. ดันมอเตอร์ให้โซ่ตึงพอดี (กดกลางโซ่ยุบได้ประมาณ 1 ซม.)\n4. ขันน็อตยึดกลับให้แน่น\n5. หมุนเครื่องด้วยมือ 2-3 รอบ เช็คว่าโซ่ไม่สะดุด',
      'ตรวจสอบความตึงโซ่ทุกครั้งที่ทำ PM รายเดือน และหยอดจารบีตามรอบที่กำหนด',
      'ประแจเลื่อน, ไขควง', 'โซ่สำรอง (ถ้าโซ่ยืดเกินไป)', 30,
      'ต้องล็อกพลังงานเครื่อง (LOTO) ก่อนเข้าใกล้จุดขับเคลื่อนทุกครั้ง',
      '', '', 'System', now, now, 0, 0, 'Published'],
    ['KB-0002', 'Reed Switch ไม่ทำงาน - เช็คจุดไหนก่อน', 'Troubleshoot', 'Electrical', 'ทุกไลน์', 'ทุก Station',
      'reed switch,เซนเซอร์ไม่ทำงาน,sensor ไม่ติด,กระบอกลมไม่รับสัญญาณ',
      'กระบอกสูบลมไม่ส่งสัญญาณตำแหน่งกลับมาที่ PLC เครื่องค้างไม่ทำงานต่อ',
      'Reed Switch หลวมเลื่อนหลุดตำแหน่ง หรือตัว Switch เสื่อมสภาพจากความร้อน/สั่นสะเทือน',
      '1. เช็คไฟที่ Reed Switch ด้วยมัลติมิเตอร์ว่าสวิตช์ทำงานหรือไม่\n2. เลื่อนตำแหน่ง Switch ให้ตรงกับแม่เหล็กบนก้านสูบ\n3. ขันน็อตล็อกให้แน่น\n4. รันเครื่องทดสอบ 2-3 รอบ',
      'ตรวจสอบตำแหน่ง Reed Switch ทุกรอบ PM และหลีกเลี่ยงการกระแทกกระบอกสูบ',
      'มัลติมิเตอร์, ไขควง', 'Reed Switch สำรอง', 20,
      'ปิดลมก่อนถอด/ปรับตำแหน่งกระบอกสูบทุกครั้ง',
      '', '', 'System', now, now, 0, 0, 'Published'],
    ['KB-0003', 'Solenoid Valve ค้าง/ไม่คืนตัว - วิธีเช็คเบื้องต้น', 'Troubleshoot', 'Mechanical', 'ทุกไลน์', 'ทุก Station',
      'solenoid,วาล์วค้าง,ลมไม่ปล่อย,วาล์วไม่คืน',
      'กระบอกลมไม่เคลื่อนที่ หรือค้างตำแหน่งเดียวหลังสั่งงาน',
      'มีสิ่งสกปรก/คราบน้ำมันอุดตันในวาล์ว หรือคอยล์ไฟฟ้าเสีย',
      '1. ตัดไฟและปิดลมก่อนถอด\n2. ถอดวาล์วออกมาเช็คคราบสกปรกในช่องลม\n3. ทำความสะอาดด้วยลมเป่า\n4. เช็คไฟที่คอยล์ด้วยมัลติมิเตอร์ ถ้าไม่มีความต้านทานให้เปลี่ยนคอยล์\n5. ประกอบกลับและทดสอบ',
      'เปลี่ยนไส้กรองลมตามรอบ PM เพื่อลดสิ่งสกปรกเข้าวาล์ว',
      'ประแจ, ปืนลม, มัลติมิเตอร์', 'Solenoid coil สำรอง', 40,
      'ปิดลมและตัดไฟก่อนถอดวาล์วทุกครั้ง ระวังลมอัดค้างในระบบ',
      '', '', 'System', now, now, 0, 0, 'Published'],
    ['KB-0004', 'กล้องไม่เชื่อมต่อ (Not Connection) - แก้ไขเบื้องต้น', 'Troubleshoot', 'Camera&Vision', 'ทุกไลน์', 'ทุก Station',
      'กล้องไม่ติด,not connection,camera error,กล้องหลุด,vision ไม่ทำงาน',
      'ระบบตรวจสอบด้วยกล้อง (Vision) ขึ้น error ไม่เชื่อมต่อ หรือภาพค้าง',
      'สาย LAN/USB หลวมหลุด หรือ IP Address กล้องขัดแย้งกับอุปกรณ์อื่น',
      '1. เช็คสายสัญญาณกล้องว่าเสียบแน่นหรือไม่\n2. รีสตาร์ทกล้องโดยตัดไฟ 10 วินาทีแล้วเปิดใหม่\n3. เช็ค IP Address กล้องในโปรแกรมว่าตรงกับที่ตั้งค่าไว้\n4. ถ้ายังไม่หาย ให้แจ้งช่าง Software',
      'หลีกเลี่ยงการดึง/กระแทกสายกล้อง และรัดสายให้เรียบร้อยไม่ให้สั่นหลุด',
      'โน้ตบุ๊ก/PC สำหรับเช็คระบบ', 'สาย LAN สำรอง', 15, '',
      '', '', 'System', now, now, 0, 0, 'Published'],
    ['KB-0005', 'ทริค PM: จุดหล่อลื่นที่มักถูกลืม', 'PM_Tips', 'ทั่วไป', 'ทุกไลน์', 'ทุก Station',
      'จารบี,หล่อลื่น,PM,ลืมจุดหล่อลื่น,lubricate',
      'จุดหล่อลื่นบางจุดถูกมองข้ามระหว่างทำ PM ทำให้ชิ้นส่วนสึกหรอเร็วกว่าปกติ',
      'จุดหล่อลื่นบางจุดซ่อนอยู่ใต้การ์ดครอบ มองไม่เห็นง่ายจึงถูกข้ามบ่อย',
      '1. เช็คจุดหมุนใต้การ์ดครอบสายพาน\n2. เช็คแบริ่งท้ายมอเตอร์ที่มักถูกมองข้าม\n3. เช็คร่องเลื่อนแกน X/Y ที่มีจารบีแห้งบ่อย\n4. ทาจารบีบางๆ อย่าให้มากเกินจนดักฝุ่น',
      'ทำ checklist จุดหล่อลื่นแนบในแผน PM และเช็คให้ครบทุกจุดก่อนปิดงาน',
      'ปืนอัดจารบี, แปรง', '', 25, '',
      '', '', 'System', now, now, 0, 0, 'Published']
  ];
  sh.getRange(2, 1, rows.length, 23).setValues(rows);
}

/** Write header labels for the K–S columns we append to the legacy request
 * sheet. Idempotent: only writes if K1 is currently blank, so it never
 * touches the pre-existing A–J headers or overwrites a manual edit. */
function ensureBMRequestHeaders() {
  var sh = getSheet(SHEET_BM_REQ);
  if (!sh) return false;
  var k1 = sh.getRange(1, BM.SYMPTOM).getValue();
  if (k1) return false; // already labeled

  var headers = [
    'Symptom', 'Priority', 'Reporter', 'Photo_Before_URL', 'Status',
    'Accept_DateTime', 'Finish_DateTime', 'Downtime_Min', 'Machine_Stop'
  ];
  sh.getRange(1, BM.SYMPTOM, 1, headers.length).setValues([headers]);
  return true;
}

function seedConfig(sheet) {
  var rows = [];
  function add(type, value, parent) { rows.push([type, value, parent || '', true]); }

  ['Line 1', 'Line 4', 'Line 5'].forEach(function (v) { add('Line', v, 'ENC H9'); });

  // Blank Parent = shared by every line in the default area, which is how
  // Station 1..17 have always behaved for ENC H9's three lines.
  for (var i = 1; i <= 17; i++) add('Station', 'Station ' + i);
  add('Station', 'อื่นๆ');

  // ไลน์หลัก + Assembly M/C's machines. Kept in one place so a fresh install
  // and an existing sheet (ensureAreaConfig) end up with the same rows.
  areaConfigRows().forEach(function (r) { rows.push(r); });

  ['A', 'B'].forEach(function (v) { add('Shift', v); });

  ['Mechanical', 'Electrical', 'Software', 'Camera&Vision'].forEach(function (v) { add('Main_Issue', v); });

  // Common issues grouped by Main_Issue (datalist — free text also allowed on frontend)
  add('Issue', 'Chain', 'Mechanical');
  add('Issue', 'Solenoid valve', 'Mechanical');
  add('Issue', 'Cylinder', 'Mechanical');
  add('Issue', 'Belt', 'Mechanical');
  add('Issue', 'Reed SW.', 'Electrical');
  add('Issue', 'Sensor', 'Electrical');
  add('Issue', 'Motor', 'Electrical');
  add('Issue', 'Not Connection', 'Software');
  add('Issue', 'Program Error', 'Software');
  add('Issue', 'Flash Not active', 'Camera&Vision');
  add('Issue', 'Camera Blur', 'Camera&Vision');
  add('Issue', 'Lens Dirty', 'Camera&Vision');

  add('Priority', 'ด่วนมาก (เครื่องหยุด)');
  add('Priority', 'ด่วน');
  add('Priority', 'ปกติ');

  ['Leader', 'Engineer', 'Technician'].forEach(function (v) { add('By', v); });

  // Shift boundaries (editable). Shift A = [start, endExclusive); rest is B.
  add('Setting', '8', 'ShiftA_StartHour');   // 08:00
  add('Setting', '20', 'ShiftB_StartHour');  // 20:00

  sheet.getRange(2, 1, rows.length, 4).setValues(rows);
}

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------

function apiGetConfig() {
  ensureSheetsOnce();
  var sh = getSheetOrThrow(SHEET_CONFIG);
  var values = sh.getDataRange().getValues();
  // Flat lists stay flat — every screen that just needs "all lines" or "all
  // machines" keeps working unchanged. The three-level structure rides
  // alongside as lookup maps, so nothing has to re-derive it client-side.
  var out = {
    Area: [], Line: [], Station: [], Shift: [], Main_Issue: [], Issue: [], Priority: [], By: [],
    LinesByArea: {},      // ไลน์หลัก -> [ไลน์/เครื่องหลัก]
    AreaOfLine: {},       // ไลน์/เครื่องหลัก -> ไลน์หลัก
    StationsByLine: {},   // ไลน์/เครื่องหลัก -> [M/C] (only where declared)
    SharedStations: [],   // blank-Parent stations = every line in DefaultArea
    DefaultArea: '',
    AllMachines: [],
    Setting: {}
  };

  for (var r = 1; r < values.length; r++) {
    var type = String(values[r][0] || '').trim();
    var val  = values[r][1];
    var parent = String(values[r][2] || '').trim();
    var active = values[r][3];
    if (!type || val === '' || val === null) continue;
    if (active === false || String(active).toUpperCase() === 'FALSE') continue;
    val = String(val);

    if (type === 'Issue') {
      out.Issue.push({ value: val, parent: parent });
    } else if (type === 'Setting') {
      out.Setting[parent] = val;
    } else if (type === 'Area') {
      out.Area.push(val);
    } else if (type === 'Line') {
      out.Line.push(val);
      // A line with no area named is one of the default area's own, from
      // before ไลน์หลัก existed.
      var area = parent || defaultAreaName();
      out.AreaOfLine[val] = area;
      (out.LinesByArea[area] = out.LinesByArea[area] || []).push(val);
    } else if (type === 'Station') {
      out.Station.push(val);
      if (parent) (out.StationsByLine[parent] = out.StationsByLine[parent] || []).push(val);
      else out.SharedStations.push(val);
    } else if (out[type]) {
      out[type].push(val);
    }
  }

  out.DefaultArea = defaultAreaName();
  if (!out.Area.length) out.Area.push(out.DefaultArea); // pre-migration sheets

  var seenMachine = {};
  out.Station.forEach(function (name) {
    if (name && !seenMachine[name]) { seenMachine[name] = true; out.AllMachines.push(name); }
  });

  return out;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Google Sheets silently coerces numeric-looking text ("0001") to a plain
 * number (1), dropping leading zeros. Compare Emp_ID / PIN in a canonical
 * form so that doesn't break matching either value type. */
function stripLeadingZeros(v) {
  var s = String(v == null ? '' : v).trim();
  return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s;
}
function normalizePin(v) {
  var s = String(v == null ? '' : v).trim();
  return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '').padStart(4, '0') : s;
}

/** Resolve USERS columns by header name instead of fixed position — a
 * column got deleted by hand once already and silently shifted PIN into
 * the Line slot, breaking login for every account. Order-independent and
 * survives future column inserts/deletes/reorders as long as headers stay
 * recognizable. */
function userColMap(sh) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h || '').toLowerCase().trim();
  });
  function find(cands) {
    for (var i = 0; i < headers.length; i++) {
      for (var j = 0; j < cands.length; j++) {
        if (headers[i] === cands[j] || headers[i].indexOf(cands[j]) >= 0) return i;
      }
    }
    return -1;
  }
  return {
    empId: find(['emp_id', 'empid', 'emp id']),
    name:  find(['name']),
    role:  find(['role']),
    line:  find(['line']),
    pin:   find(['pin']),
    shift: find(['shift'])
  };
}
function uCell(row, idx) { return idx >= 0 ? row[idx] : ''; }

function apiLogin(payload) {
  var sh = getSheetOrThrow(SHEET_USERS);
  var map = userColMap(sh);
  var values = sh.getDataRange().getValues();
  var empId = stripLeadingZeros(payload.empId);
  var name  = String(payload.name || '').trim();
  var pin   = normalizePin(payload.pin);

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var rEmp = stripLeadingZeros(uCell(row, map.empId));
    var rName = String(uCell(row, map.name) || '').trim();
    var rPin = normalizePin(uCell(row, map.pin));
    var match = (empId && rEmp === empId) || (!empId && name && rName === name);
    if (match && rPin === pin) {
      var rEmpId = String(uCell(row, map.empId) || '').trim();
      return {
        empId: rEmpId, name: rName,
        role: String(uCell(row, map.role) || ''),
        line: String(uCell(row, map.line) || ''),
        shift: String(uCell(row, map.shift) || '').trim(),
        // The client keeps this and sends it back; it — not the role field
        // beside it — is what proves who the caller is on privileged calls.
        token: issueSession(rEmpId)
      };
    }
  }
  throw new Error('ชื่อผู้ใช้หรือ PIN ไม่ถูกต้อง');
}

/** Public list of names only (no PIN) for the login dropdown. */
function apiGetUserNames() {
  var sh = getSheet(SHEET_USERS);
  if (!sh) return [];
  var map = userColMap(sh);
  var values = sh.getDataRange().getValues();
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var name = String(uCell(values[r], map.name) || '').trim();
    var emp = String(uCell(values[r], map.empId) || '').trim();
    if (name) out.push({ empId: emp, name: name });
  }
  return out;
}

function apiGetUsers() {
  var sh = getSheetOrThrow(SHEET_USERS);
  var map = userColMap(sh);
  var values = sh.getDataRange().getValues();
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (!uCell(row, map.empId) && !uCell(row, map.name)) continue;
    out.push({
      empId: String(uCell(row, map.empId) || ''), name: String(uCell(row, map.name) || ''),
      role: String(uCell(row, map.role) || ''), line: String(uCell(row, map.line) || ''),
      shift: String(uCell(row, map.shift) || '').trim()
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BM: create
// ---------------------------------------------------------------------------

function apiCreateBM(payload, user) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var book = bookForArea(payload.area);
    // A newly added area's sheets may not exist yet if setup hasn't been run
    // since the deploy. Create them here rather than refusing the report —
    // ensureSheets is idempotent, and losing a breakdown report to a missing
    // sheet is far worse than one slow first submit.
    if (!getSheet(book.req) || !getSheet(book.rep)) ensureSheets();
    var sh = getSheetOrThrow(book.req);
    var now = new Date();
    var mtJob = generateMTJobNo(sh, now, book);

    var photoUrl = '';
    if (payload.photoBase64) {
      photoUrl = savePhoto(payload.photoBase64, mtJob, 'before', now, book);
    }

    // Shift comes from the reporting user's assigned shift; falls back to
    // the payload, then to time-of-day detection for anonymous/unset cases.
    var shift = (user && user.shift) || payload.shift || detectShift(now);
    var row = new Array(BM_WIDTH).fill('');
    row[BM.TIMESTAMP - 1]    = now;
    row[BM.DATE - 1]         = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    row[BM.SHIFT - 1]        = shift;
    row[BM.LINE - 1]         = payload.line || '';
    row[BM.MC - 1]           = payload.mc || '';
    row[BM.JOB_ORDER - 1]    = payload.jobOrder || '';
    row[BM.NO - 1]           = '';
    row[BM.MT_JOB - 1]       = mtJob;
    row[BM.PCT1 - 1]         = '';
    row[BM.PROGRESS - 1]     = 0;
    row[BM.SYMPTOM - 1]      = payload.symptom || '';
    row[BM.PRIORITY - 1]     = payload.priority || 'ปกติ';
    row[BM.REPORTER - 1]     = payload.reporter || (user && user.name) || '';
    row[BM.PHOTO_BEFORE - 1] = photoUrl;
    row[BM.STATUS - 1]       = ST_NEW;
    row[BM.ACCEPT_DT - 1]    = '';
    row[BM.FINISH_DT - 1]    = '';
    row[BM.DOWNTIME - 1]     = '';
    row[BM.MACHINE_STOP - 1] = payload.machineStop === true || String(payload.machineStop).toUpperCase() === 'TRUE';
    row[BM.AREA - 1]         = payload.area || '';

    sh.appendRow(row);

    // Push a LINE group notification (best-effort — never block the report).
    notifyLineNewBM({
      mtJob: mtJob, line: payload.line || '', mc: payload.mc || '',
      area: payload.area || '',
      symptom: payload.symptom || '', priority: payload.priority || 'ปกติ',
      machineStop: row[BM.MACHINE_STOP - 1], reporter: row[BM.REPORTER - 1],
      shift: shift, photoUrl: photoUrl
    }, book);

    return { mtJob: mtJob, status: ST_NEW, photoUrl: photoUrl };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Push a "new breakdown" message to the LINE group, mirroring the old
 * Google Form -> LINE script. Credentials come from Script Properties
 * (LINE_TOKEN, LINE_GROUP_ID) — never hard-coded, since this repo is public.
 * Silently no-ops if not configured, and never throws.
 */
/** Low-level push to the LINE group. Reads credentials from Script
 * Properties, no-ops if unset, and never throws. Returns true if sent. */
function linePush(text, book) {
  try {
    var props = PropertiesService.getScriptProperties();
    var token = props.getProperty('LINE_TOKEN');
    // Each area may have its own group (LINE_GROUP_ID_<BOOK>); when that
    // property isn't set, its alerts fall back to the main group, so adding a
    // line never silently stops notifying anyone.
    var groupId = '';
    if (book && book.lineGroupProp) groupId = props.getProperty(book.lineGroupProp) || '';
    if (!groupId) groupId = props.getProperty('LINE_GROUP_ID');
    if (!token || !groupId) return false; // not configured — skip quietly

    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({
        to: groupId,
        messages: [{ type: 'text', text: text }]
      }),
      muteHttpExceptions: true
    });
    return true;
  } catch (err) {
    Logger.log('linePush failed (continuing): ' + err);
    return false;
  }
}

/** "เครื่องจักรมีปัญหา" — sent when a new BM report is created. */
function notifyLineNewBM(bm, book) {
  var lines = [
    '📢 แจ้งเตือนเครื่องจักรมีปัญหา 📢',
    '',
    '🔧 เลขงาน: ' + bm.mtJob,
    '🏭 ไลน์/จุด: ' + machineLabel(bm),
    '⚙️ อาการ: ' + (bm.symptom || '-'),
    '🚦 ความเร่งด่วน: ' + (bm.priority || '-'),
    '⛔ เครื่องหยุด: ' + (bm.machineStop ? 'ใช่' : 'ไม่'),
    '🕒 กะ: ' + (bm.shift || '-'),
    '👤 ผู้แจ้ง: ' + (bm.reporter || '-')
  ];
  if (bm.photoUrl) lines.push('📷 รูป: ' + bm.photoUrl);
  linePush(lines.join('\n'), book);
}

/** "ENC H9 / Line 4 / Station 10" — the full ไลน์หลัก → ไลน์ → เครื่อง path,
 * skipping any level that's blank or just repeats the one below it. */
function machineLabel(bm) {
  var parts = [];
  [bm.area, bm.line, bm.mc].forEach(function (p) {
    p = String(p || '').trim();
    if (p && parts.indexOf(p) < 0) parts.push(p);
  });
  return parts.length ? parts.join(' / ') : '-';
}

/** "แก้ไขเสร็จสิ้น" — sent when a job is closed. */
function notifyLineCloseBM(bm, book) {
  var lines = [
    '✅ แก้ไขเครื่องจักรที่มีปัญหาเสร็จสิ้น ✅',
    '',
    '🔧 เลขงาน: ' + bm.mtJob,
    '🏭 ไลน์/จุด: ' + machineLabel(bm),
    '🩺 ประเภทปัญหา: ' + (bm.mainIssue || '-') + (bm.issue ? ' • ' + bm.issue : ''),
    '🛠️ การแก้ไข: ' + (bm.improvements || '-'),
    '⏱️ Downtime: ' + (bm.downtime || 0) + ' นาที',
    '👨‍🔧 ผู้ซ่อม: ' + (bm.by || '-')
  ];
  if (bm.photoUrl) lines.push('📷 รูปหลังซ่อม: ' + bm.photoUrl);
  linePush(lines.join('\n'), book);
}

/** Manual test: run once in the editor to verify LINE credentials + group. */
function testLineNotify() {
  notifyLineNewBM({
    mtJob: 'TEST-0', line: 'Line 4', mc: 'Station 10',
    symptom: 'ทดสอบการแจ้งเตือน LINE', priority: 'ปกติ',
    machineStop: false, reporter: 'ระบบ', shift: 'A', photoUrl: ''
  });
  notifyLineCloseBM({
    mtJob: 'TEST-0', line: 'Line 4', mc: 'Station 10',
    mainIssue: 'Mechanical', issue: 'Chain', improvements: 'เปลี่ยนโซ่ใหม่',
    by: 'ช่างทดสอบ', downtime: 45, photoUrl: ''
  });
}

/** MT Job No. = DDMMYYYY-n, n = next running number for that calendar day. */
function generateMTJobNo(sh, date, book) {
  var prefix = (book && book.prefix ? book.prefix : '') +
    pad2(date.getDate()) + pad2(date.getMonth() + 1) + date.getFullYear();
  var last = sh.getLastRow();
  var max = 0;
  if (last >= 2) {
    var col = sh.getRange(2, BM.MT_JOB, last - 1, 1).getValues();
    var re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d+)$');
    for (var i = 0; i < col.length; i++) {
      var m = re.exec(String(col[i][0] || '').trim());
      if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
    }
  }
  return prefix + '-' + (max + 1);
}

// ---------------------------------------------------------------------------
// BM: read jobs
// ---------------------------------------------------------------------------

/**
 * Read jobs across every area. A line filter narrows this to that line's own
 * sheet; without one, all books are read and merged so the job board, the
 * dashboard and history keep showing one combined picture.
 */
function apiGetBMJobs(payload) {
  payload = payload || {};
  var fLine  = payload.line ? String(payload.line) : '';
  var fArea  = payload.area ? String(payload.area) : '';
  var fShift = payload.shift ? String(payload.shift) : '';
  var fStatus = payload.status ? String(payload.status) : '';
  var fDate  = payload.date ? parseYMD(payload.date) : null;

  var books = fArea ? [bookForArea(fArea)] : allBooks();
  var defaultArea = defaultAreaName();
  var out = [];
  // A job migrated out of the archive still has its original row sitting
  // there — the migration copies rather than moves, so the archive stays
  // exactly as it was. Whichever sheet is read first wins, and the book's own
  // sheet is always read first, so a migrated job is never counted twice.
  var seen = {};

  books.forEach(function (book) {
    // Own sheet first, archive second — so a job that exists in both is taken
    // from the live one and the stale archive copy is skipped.
    bookRequestSheets(book).forEach(function (sheetName) {
      var sh = getSheet(sheetName);
      if (!sh) return; // sheet not created yet
      var last = sh.getLastRow();
      if (last < 2) return;
      var width = Math.min(BM_WIDTH, sh.getMaxColumns());
      var values = sh.getRange(2, 1, last - 1, width).getValues();
      var mtRe = mtJobRe(book);

      for (var i = 0; i < values.length; i++) {
        var row = values[i];
        var mt = String(row[BM.MT_JOB - 1] || '').trim();
        if (!mtRe.test(mt)) continue; // drop garbage / formula rows
        if (seen[mt]) continue;
        seen[mt] = true;

        // Rows written before ไลน์หลัก existed have a blank Area cell; they
        // all belong to the default area, so read them that way.
        var area = String(row[BM.AREA - 1] || '') || defaultArea;
        if (fArea && area !== fArea) continue;
        if (fLine && String(row[BM.LINE - 1]) !== fLine) continue;
        if (fShift && String(row[BM.SHIFT - 1]) !== fShift) continue;
        if (fStatus && String(row[BM.STATUS - 1]) !== fStatus) continue;
        if (fDate) {
          var d = row[BM.DATE - 1] || row[BM.TIMESTAMP - 1];
          if (!sameDay(d, fDate)) continue;
        }

        out.push({
          rowIndex:    i + 2,
          book:        book.key,
          sheet:       sheetName,
          timestamp:   toIso(row[BM.TIMESTAMP - 1]),
          date:        toIso(row[BM.DATE - 1]),
          shift:       String(row[BM.SHIFT - 1] || ''),
          area:        area,
          line:        String(row[BM.LINE - 1] || ''),
          mc:          String(row[BM.MC - 1] || ''),
          mtJob:       mt,
          progress:    row[BM.PROGRESS - 1] || 0,
          symptom:     String(row[BM.SYMPTOM - 1] || ''),
          priority:    String(row[BM.PRIORITY - 1] || ''),
          reporter:    String(row[BM.REPORTER - 1] || ''),
          photoBefore: String(row[BM.PHOTO_BEFORE - 1] || ''),
          status:      String(row[BM.STATUS - 1] || ''),
          acceptDt:    toIso(row[BM.ACCEPT_DT - 1]),
          finishDt:    toIso(row[BM.FINISH_DT - 1]),
          downtime:    row[BM.DOWNTIME - 1] || '',
          machineStop: row[BM.MACHINE_STOP - 1] === true || String(row[BM.MACHINE_STOP - 1]).toUpperCase() === 'TRUE'
        });
      }
    });
  });

  // Merged books arrive sheet-by-sheet; newest-first ordering is what every
  // caller assumes, so sort once here rather than in each of them.
  out.sort(function (a, b) {
    return new Date(a.timestamp || a.date || 0) - new Date(b.timestamp || b.date || 0);
  });
  return out;
}

/** Locate the sheet row for a given MT Job No. Returns 1-based row, or -1. */
function findBMRow(sh, mtJob) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var col = sh.getRange(2, BM.MT_JOB, last - 1, 1).getValues();
  var target = String(mtJob).trim();
  for (var i = 0; i < col.length; i++) {
    if (String(col[i][0] || '').trim() === target) return i + 2;
  }
  return -1;
}

/**
 * Find the sheet AND row holding a job, checking the book's own sheet before
 * its archive. The archive matters for a job reported before the migration
 * ran and still open: it has to stay closable from the board rather than
 * becoming unreachable the moment the sheets were split.
 * Returns { sheet, row } or null.
 */
function locateBMRow(book, mtJob) {
  var names = bookRequestSheets(book);
  for (var i = 0; i < names.length; i++) {
    var sh = getSheet(names[i]);
    if (!sh) continue;
    var row = findBMRow(sh, mtJob);
    if (row > 0) return { sheet: sh, row: row };
  }
  return null;
}

// ---------------------------------------------------------------------------
// BM: status transitions
// ---------------------------------------------------------------------------

function apiUpdateBMStatus(payload, user) {
  var found = locateBMRow(bookForMTJob(payload.mtJob), payload.mtJob);
  if (!found) throw new Error('ไม่พบงาน ' + payload.mtJob);
  var sh = found.sheet, rowIdx = found.row;

  var newStatus = payload.status;
  var valid = [ST_ACCEPT, ST_REPAIR, ST_WAIT, ST_NEW];
  if (valid.indexOf(newStatus) < 0) throw new Error('สถานะไม่ถูกต้อง: ' + newStatus);

  sh.getRange(rowIdx, BM.STATUS).setValue(newStatus);
  if (newStatus === ST_ACCEPT && !sh.getRange(rowIdx, BM.ACCEPT_DT).getValue()) {
    sh.getRange(rowIdx, BM.ACCEPT_DT).setValue(new Date());
  }
  return { mtJob: payload.mtJob, status: newStatus };
}

// ---------------------------------------------------------------------------
// BM: close (writes Record ซ่อม + updates request row)
// ---------------------------------------------------------------------------

function apiCloseBM(payload, user) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var book = bookForMTJob(payload.mtJob);
    var found = locateBMRow(book, payload.mtJob);
    if (!found) throw new Error('ไม่พบงาน ' + payload.mtJob);
    var reqSh = found.sheet, rowIdx = found.row;

    var now = new Date();
    var reqRow = reqSh.getRange(rowIdx, 1, 1, Math.min(BM_WIDTH, reqSh.getMaxColumns())).getValues()[0];
    var reportedAt = reqRow[BM.TIMESTAMP - 1];

    // Time_Min / Downtime_Min are always computed from wall-clock elapsed
    // time (report -> close), not typed in by the technician.
    var elapsedMin = (reportedAt instanceof Date)
      ? Math.max(0, Math.round((now.getTime() - reportedAt.getTime()) / 60000))
      : 0;
    var repairMin = elapsedMin;
    var downtime = elapsedMin;

    // After photo -> Drive
    var afterUrl = '';
    if (payload.photoBase64) {
      afterUrl = savePhoto(payload.photoBase64, payload.mtJob, 'after', now, book);
    }

    // Update the request row
    reqSh.getRange(rowIdx, BM.STATUS).setValue(ST_DONE);
    reqSh.getRange(rowIdx, BM.FINISH_DT).setValue(now);
    reqSh.getRange(rowIdx, BM.DOWNTIME).setValue(downtime);
    reqSh.getRange(rowIdx, BM.PROGRESS).setValue(100);

    // Write the repair record row
    writeRepairRow({
      'MT Job No.':      payload.mtJob,
      'Date':            new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      'Shift':           reqRow[BM.SHIFT - 1] || detectShift(now),
      'Production line': reqRow[BM.LINE - 1] || '',
      'Area':            reqRow[BM.AREA - 1] || defaultAreaName(),
      'Station':         payload.station || reqRow[BM.MC - 1] || '',
      'Main_Issue':      normalizeMainIssue(payload.mainIssue),
      'Issue':           payload.issue || '',
      'Detail':          payload.detail || '',
      'Improvements':    payload.improvements || '',
      'Spare_Parts':     payload.spareParts || '',
      'By':              payload.by || (user && user.name) || '',
      'Time_Min':        repairMin,
      'Photo_After_URL': afterUrl
    }, book);

    // Push a LINE "repair finished" notification (best-effort).
    notifyLineCloseBM({
      mtJob: payload.mtJob,
      line: reqRow[BM.LINE - 1] || '',
      mc: payload.station || reqRow[BM.MC - 1] || '',
      area: reqRow[BM.AREA - 1] || '',
      mainIssue: normalizeMainIssue(payload.mainIssue),
      issue: payload.issue || '',
      improvements: payload.improvements || '',
      by: payload.by || (user && user.name) || '',
      downtime: downtime,
      photoUrl: afterUrl
    }, book);

    return { mtJob: payload.mtJob, status: ST_DONE, downtime: downtime, photoUrl: afterUrl };
  } finally {
    lock.releaseLock();
  }
}

/** Find existing header columns by name (row 1), appending any that are missing. */
function getOrCreateColumns(sh, fieldNames) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] || '').trim();
    if (h) map[h] = c + 1;
  }
  var nextCol = lastCol + 1;
  for (var i = 0; i < fieldNames.length; i++) {
    var name = fieldNames[i];
    if (!map[name]) {
      sh.getRange(1, nextCol).setValue(name);
      map[name] = nextCol;
      nextCol++;
    }
  }
  return map;
}

function writeRepairRow(fields, book) {
  var sh = getSheetOrThrow((book || BOOKS[DEFAULT_BOOK]).rep);
  var map = getOrCreateColumns(sh, REP_FIELDS);
  var targetRow = sh.getLastRow() + 1;

  // Write ONLY the mapped columns for our fields, cell by cell. This avoids
  // clobbering any existing (possibly formula) columns that may sit between
  // our fields when some field names already exist in the legacy sheet.
  REP_FIELDS.forEach(function (f) {
    if (fields[f] !== undefined) sh.getRange(targetRow, map[f]).setValue(fields[f]);
  });
}

/** Read one repair record's full detail (Issue/Detail/Improvements/
 * Spare_Parts/Time_Min/Photo_After_URL) by MT Job No. — used to pre-fill a
 * Knowledge Base article from a job the technician just closed (jobs.html
 * "บันทึกเป็นเคสตัวอย่าง") and by the read-only detail view.
 *
 * Goes through the same tolerant reader as everything else, across the book's
 * live sheet and its archive, so a job closed before the sheets were split
 * still opens. */
function apiGetRepairDetail(payload) {
  var mtJob = String((payload || {}).mtJob || '').trim();
  if (!mtJob) throw new Error('ไม่ระบุ MT Job No.');

  var book = bookForMTJob(mtJob);
  var names = bookRepairSheets(book);
  for (var s = 0; s < names.length; s++) {
    var rows = readRepairRowsFromSheet(names[s]);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].mtJob !== mtJob) continue;
      var rp = rows[i];
      return {
        mtJob: mtJob,
        line: rp.line || '',
        station: rp.station || '',
        area: rp.area || '',
        mainIssue: rp.mainIssue || '',
        issue: rp.specificIssue || '',
        detail: rp.detail || '',
        improvements: rp.improvements || '',
        spareParts: rp.spareParts || '',
        timeMin: rp.timeMin === undefined ? '' : rp.timeMin,
        photoAfterUrl: rp.photoAfterUrl || ''
      };
    }
  }
  throw new Error('ไม่พบข้อมูลซ่อมของงาน ' + mtJob);
}

// ---------------------------------------------------------------------------
// PM
// ---------------------------------------------------------------------------

function readPMMaster() {
  var sh = getSheetOrThrow(SHEET_PM_MAST);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var width = Math.max(sh.getLastColumn(), 12);
  var values = sh.getRange(2, 1, last - 1, width).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (!row[0]) continue;
    out.push({
      rowIndex:  i + 2,
      pmId:      String(row[0]),
      line:      String(row[1] || ''),
      mcStation: String(row[2] || ''),
      pmItem:    String(row[3] || ''),
      standard:  String(row[4] || ''),
      frequency: String(row[5] || ''),
      lastDone:  toIso(row[6]),
      nextDue:   toIso(row[7]),
      assignedTo:String(row[8] || ''),
      active:    row[9] === true || String(row[9]).toUpperCase() === 'TRUE',
      notes:     String(row[10] || ''),
      photoUrl:  String(row[11] || '')
    });
  }
  return out;
}

function apiGetPMMaster(payload) {
  return readPMMaster();
}

function apiGetPMDue(payload) {
  var all = readPMMaster();
  var today = startOfToday();
  var out = [];
  for (var i = 0; i < all.length; i++) {
    var p = all[i];
    if (!p.active) continue;
    var due = p.nextDue ? new Date(p.nextDue) : null;
    if (!due) continue;
    if (due <= endOfToday()) {
      var overdueDays = Math.floor((today.getTime() - startOfDay(due).getTime()) / 86400000);
      p.overdue = overdueDays > 0;
      p.overdueDays = overdueDays > 0 ? overdueDays : 0;
      out.push(p);
    }
  }
  out.sort(function (a, b) { return (b.overdueDays || 0) - (a.overdueDays || 0); });
  return out;
}

function apiSubmitPM(payload, user) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var mastSh = getSheetOrThrow(SHEET_PM_MAST);
    var recSh  = getSheetOrThrow(SHEET_PM_REC);
    var now = new Date();

    // Locate master row
    var mrow = findPMRow(mastSh, payload.pmId);
    if (mrow < 0) throw new Error('ไม่พบแผน PM ' + payload.pmId);
    var freq = String(mastSh.getRange(mrow, 6).getValue() || '');
    var nextDue = mastSh.getRange(mrow, 8).getValue();
    var dueBase = (nextDue instanceof Date) ? nextDue : now;
    var status = (startOfDay(now) > startOfDay(dueBase)) ? 'Overdue' : 'OnTime';

    var photoUrl = '';
    if (payload.photoBase64) {
      // Filed under the area that owns this PM plan's line, same as BM photos.
      photoUrl = savePhoto(payload.photoBase64, 'PM_' + payload.pmId, 'pm', now,
        bookForArea(areaForLine(mastSh.getRange(mrow, 2).getValue())));
    }

    var recId = generatePMRecordId(recSh, now);
    var result = (String(payload.result).toUpperCase() === 'NG') ? 'NG' : 'OK';
    recSh.appendRow([
      recId, payload.pmId, now, payload.technician || (user && user.name) || '',
      result, payload.ngDetail || '', payload.actionTaken || '', photoUrl, status
    ]);

    // Update master: Last_Done + Next_Due
    var newNext = computeNextDue(now, freq);
    mastSh.getRange(mrow, 7).setValue(now);       // Last_Done
    mastSh.getRange(mrow, 8).setValue(newNext);   // Next_Due

    return { recordId: recId, result: result, nextDue: toIso(newNext), status: status };
  } finally {
    lock.releaseLock();
  }
}

function findPMRow(sh, pmId) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var col = sh.getRange(2, 1, last - 1, 1).getValues();
  var target = String(pmId).trim();
  for (var i = 0; i < col.length; i++) {
    if (String(col[i][0] || '').trim() === target) return i + 2;
  }
  return -1;
}

function generatePMRecordId(sh, date) {
  var prefix = 'PM' + date.getFullYear() + pad2(date.getMonth() + 1) + pad2(date.getDate());
  var last = sh.getLastRow();
  var max = 0;
  if (last >= 2) {
    var col = sh.getRange(2, 1, last - 1, 1).getValues();
    var re = new RegExp('^' + prefix + '-(\\d+)$');
    for (var i = 0; i < col.length; i++) {
      var m = re.exec(String(col[i][0] || '').trim());
      if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
    }
  }
  return prefix + '-' + (max + 1);
}

function computeNextDue(from, frequency) {
  var d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  switch (String(frequency)) {
    case 'Weekly':    d.setDate(d.getDate() + 7); break;
    case 'Monthly':   d.setMonth(d.getMonth() + 1); break;
    case 'Quarterly': d.setMonth(d.getMonth() + 3); break;
    case 'HalfYear':  d.setMonth(d.getMonth() + 6); break;
    case 'Yearly':    d.setFullYear(d.getFullYear() + 1); break;
    default:          d.setDate(d.getDate() + 7);
  }
  return d;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function apiGetDashboard(payload) {
  var range = resolveRange(payload); // {from, to}
  var fLine = payload.line ? String(payload.line) : '';

  var jobs = apiGetBMJobs({}); // all valid jobs
  var inRange = jobs.filter(function (j) {
    var d = j.date ? new Date(j.date) : (j.timestamp ? new Date(j.timestamp) : null);
    if (!d) return false;
    if (d < range.from || d > range.to) return false;
    if (fLine && j.line !== fLine) return false;
    return true;
  });

  // KPI aggregates
  var totalDowntime = 0, mttrSum = 0, mttrCount = 0, open = 0;
  var paretoMap = {}, dailyMap = {}, stationMap = {}, mttrByIssue = {}, lineMap = {};

  var OPEN_STATUSES = [ST_NEW, ST_ACCEPT, ST_REPAIR, ST_WAIT];
  inRange.forEach(function (j) {
    var dt = Number(j.downtime) || 0;
    var closed = j.status === ST_DONE;
    if (closed) { totalDowntime += dt; mttrSum += dt; mttrCount++; }
    else if (OPEN_STATUSES.indexOf(j.status) >= 0) open++;

    var mi = normalizeMainIssue(''); // default; recompute below from repair sheet
    // Daily downtime
    var dayKey = j.date ? j.date.substring(0, 10) : '';
    if (dayKey) dailyMap[dayKey] = (dailyMap[dayKey] || 0) + dt;

    var st = j.mc || 'ไม่ระบุ';
    stationMap[st] = (stationMap[st] || 0) + 1;

    var ln = j.line || 'ไม่ระบุ';
    lineMap[ln] = (lineMap[ln] || 0) + dt;
  });

  // Pareto + MTTR by Main_Issue: use Record ซ่อม (normalized)
  var repairs = readRepairsInRange(range, fLine);
  repairs.forEach(function (rp) {
    var mi = normalizeMainIssue(rp.mainIssue);
    paretoMap[mi] = (paretoMap[mi] || 0) + 1;
    var tmin = Number(rp.timeMin) || 0;
    if (!mttrByIssue[mi]) mttrByIssue[mi] = { sum: 0, n: 0 };
    mttrByIssue[mi].sum += tmin; mttrByIssue[mi].n++;
  });

  // Work minutes for Downtime %
  var workMin = readWorkMinutes(range, fLine);
  var downtimePct = workMin > 0 ? (totalDowntime / workMin) * 100 : 0;

  // PM Compliance
  var pmCompliance = computePMCompliance(range);

  return {
    range: { from: toIso(range.from), to: toIso(range.to) },
    kpi: {
      totalDowntime: totalDowntime,
      downtimePct: round2(downtimePct),
      bmCount: inRange.length,
      mttr: mttrCount ? round2(mttrSum / mttrCount) : 0,
      openJobs: open,
      pmCompliance: pmCompliance
    },
    pareto: sortDesc(paretoMap),
    daily: sortByKey(dailyMap),
    topStations: sortDesc(stationMap).slice(0, 5),
    mttrByIssue: Object.keys(mttrByIssue).map(function (k) {
      return { key: k, value: round2(mttrByIssue[k].sum / mttrByIssue[k].n) };
    }),
    byLine: sortDesc(lineMap),
    recent: inRange.slice(-15).reverse()
  };
}

/**
 * Read every "Record ซ่อม" repair row, tolerant of BOTH layouts:
 *  - the app's own columns (Main_Issue / Issue / Time_Min / Production line), and
 *  - the legacy form layout (Main Issue (ประเภท…) + per-type detail columns
 *    Machanical/Electrical/Software/Camera&Vision, Date (Cal), etc.)
 * Values are coalesced per row so old and new records analyse the same way.
 */
function readRepairRowsFull() {
  var out = [];
  var seen = {};
  allBooks().forEach(function (book) {
    // Live sheet before archive: a repair copied out of the archive keeps its
    // original row there, and only the first copy of a job number is taken.
    bookRepairSheets(book).forEach(function (sheetName) {
      readRepairRowsFromSheet(sheetName).forEach(function (rp) {
        if (seen[rp.mtJob]) return;
        seen[rp.mtJob] = true;
        out.push(rp);
      });
    });
  });
  return out;
}

function readRepairRowsFromSheet(sheetName) {
  var sh = getSheet(sheetName);
  if (!sh) return [];
  return extractRepairRows(readAllValues(sh));
}

/** The header-matching half of the reader, working on values already fetched.
 * Split out so the rebuild can extract rows and audit unmapped columns from a
 * single read of a spreadsheet that is slow to read twice. */
function extractRepairRows(values) {
  if (!values || values.length < 2) return [];
  var headers = values[0].map(function (h) { return String(h || '').toLowerCase().trim(); });

  function findAll(preds) {
    var out = [];
    for (var i = 0; i < headers.length; i++) {
      for (var p = 0; p < preds.length; p++) {
        if (headers[i].indexOf(preds[p]) >= 0) { out.push(i); break; }
      }
    }
    return out;
  }
  /** Exact header match — for short words like "by" that would otherwise
   * match half the sheet as a substring. */
  function findExact(names) {
    var out = [];
    for (var i = 0; i < headers.length; i++) {
      if (names.indexOf(headers[i]) >= 0) out.push(i);
    }
    return out;
  }

  var mtCols   = findAll(['mt job', 'mt_job', 'mtjob']);
  var miCols   = findAll(['main issue', 'main_issue']);
  var areaCols = findAll(['area']);
  var lineCols = findAll(['production line']);
  var timeCols = findAll(['time_min', 'minute']); // app writes "Time_Min"; the legacy sheet's own column is "Time (minute)"
  var dateCols = findAll(['date', 'วันที่']).concat(findAll(['ประทับเวลา', 'timestamp'])); // real dates first, timestamp as fallback
  var typeCols = findAll(['machanical', 'mechanical', 'กลไก', 'electrical', 'ไฟฟ้า', 'software', 'camera', 'vision']);
  var issueCols = findAll(['issue']).filter(function (i) { return miCols.indexOf(i) < 0; }); // 'Issue' minus 'Main Issue'
  var detailCols = issueCols.concat(typeCols);

  // The rest of REP_FIELDS. Only the rebuild path reads these, but they cost
  // nothing here and keeping every mapping in one place is what stops the two
  // layouts drifting apart again.
  var shiftCols   = findAll(['shift', 'กะ']);
  var stationCols = findAll(['station', 'm/c', 'เครื่อง']);
  var descCols    = findAll(['detail', 'รายละเอียด']);
  var fixCols     = findAll(['improvement', 'แก้ไข', 'วิธีแก้']);
  var partCols    = findAll(['spare', 'อะไหล่']);
  var byCols      = findExact(['by']).concat(findAll(['ผู้ซ่อม', 'ช่างผู้ซ่อม', 'ผู้ดำเนินการ']));
  var photoCols   = findAll(['photo_after', 'photo after', 'รูปหลัง']);

  function coalesce(row, cols) {
    for (var i = 0; i < cols.length; i++) {
      var v = row[cols[i]];
      if (v !== '' && v !== null && v !== undefined) return v;
    }
    return '';
  }
  function str(row, cols) { return String(coalesce(row, cols) || '').trim(); }
  function firstDate(row, cols) {
    for (var i = 0; i < cols.length; i++) {
      var v = row[cols[i]];
      if (v instanceof Date) return v;
    }
    return null;
  }

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var mt = String(coalesce(row, mtCols) || '').trim();
    if (!isValidMTJob(mt)) continue;
    out.push({
      mtJob: mt,
      date: firstDate(row, dateCols),
      line: str(row, lineCols),
      area: str(row, areaCols),
      mainIssue: str(row, miCols),
      specificIssue: str(row, detailCols),
      timeMin: coalesce(row, timeCols),
      shift: str(row, shiftCols),
      station: str(row, stationCols),
      detail: str(row, descCols),
      improvements: str(row, fixCols),
      spareParts: str(row, partCols),
      by: str(row, byCols),
      photoAfterUrl: str(row, photoCols)
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// One-time migration: give ENC H9 its own sheets
// ---------------------------------------------------------------------------

/**
 * Copy every H9 record this app created out of the two original sheets and
 * into its own pair, so app data and pre-app data stop sharing a table.
 *
 * The originals were never designed for this app: the request sheet carries
 * legacy A–J columns and the repair sheet is a Google Form response sheet
 * with a column per issue type. Writing into them meant appending the app's
 * fields to the right-hand edge, leaving every row filled in on one side only.
 * After this runs the app writes solely to "Record แจ้งซ่อม H9" and
 * "Record ซ่อม H9", both in the app's own clean layout.
 *
 * The originals are COPIED FROM, never modified — they keep every row exactly
 * as it is and stay readable, so the Dashboard and ประวัติ still show one
 * continuous history. Readers skip an archived row once the same MT Job No.
 * exists in the live sheet, so nothing is counted twice.
 *
 * A request row counts as this app's if it has a Status — the app always
 * writes one and nothing before it ever did. Repairs follow their request:
 * a repair row moves across when its MT Job No. belongs to a migrated job.
 *
 * Idempotent: job numbers already present in the new sheets are skipped, so
 * a run interrupted by a Sheets timeout can simply be run again.
 */
function migrateH9ToOwnSheets() {
  var book = BOOKS.ENC;
  var ss = getSS();
  var notes = [];

  // An earlier repair-sheet rebuild could have been interrupted after it
  // renamed the original aside, leaving an empty sheet under the real name.
  // Put that back before reading anything.
  var restored = restoreInterruptedRebuild(ss, book.repArchive);
  if (restored) notes.push('กู้ชีต ' + book.repArchive + ' กลับจาก ' + restored);

  ensureSheets();

  // ---- requests ----------------------------------------------------------
  var reqArchive = getSheetOrThrow(book.reqArchive);
  var reqLive = getSheetOrThrow(book.req);

  var existingJobs = {};
  columnValues(reqLive, BM.MT_JOB).forEach(function (v) {
    var mt = String(v || '').trim();
    if (mt) existingJobs[mt] = true;
  });

  var archiveWidth = Math.min(BM_WIDTH, reqArchive.getMaxColumns());
  var archiveRows = reqArchive.getLastRow() > 1
    ? reqArchive.getRange(2, 1, reqArchive.getLastRow() - 1, archiveWidth).getValues()
    : [];

  var defaultArea = defaultAreaName();
  var movedJobs = {};
  var newRequests = [];

  archiveRows.forEach(function (row) {
    var mt = String(row[BM.MT_JOB - 1] || '').trim();
    if (!mtJobRe(book).test(mt)) return;                 // junk / formula row
    if (!String(row[BM.STATUS - 1] || '').trim()) return; // pre-app row: leave it
    movedJobs[mt] = true;
    if (existingJobs[mt]) return;                        // already migrated

    var out = new Array(BM_WIDTH).fill('');
    for (var c = 0; c < archiveWidth && c < BM_WIDTH; c++) out[c] = row[c];
    if (!String(out[BM.AREA - 1] || '').trim()) out[BM.AREA - 1] = defaultArea;
    newRequests.push(out);
  });

  if (newRequests.length) {
    writeRowsChunked(reqLive, newRequests, reqLive.getLastRow() + 1);
  }

  // ---- repairs -----------------------------------------------------------
  var repLive = getSheetOrThrow(book.rep);
  var existingRepairs = {};
  readRepairRowsFromSheet(book.rep).forEach(function (rp) { existingRepairs[rp.mtJob] = true; });

  var newRepairs = [];
  readRepairRowsFromSheet(book.repArchive).forEach(function (rp) {
    if (!movedJobs[rp.mtJob]) return;      // its request stayed behind
    if (existingRepairs[rp.mtJob]) return; // already migrated
    existingRepairs[rp.mtJob] = true;
    newRepairs.push(repairRowToTable(rp, defaultArea));
  });

  if (newRepairs.length) {
    writeRowsChunked(repLive, newRepairs, repLive.getLastRow() + 1);
  }

  var summary = {
    requestsCopied: newRequests.length,
    repairsCopied: newRepairs.length,
    appJobsFound: Object.keys(movedJobs).length,
    requestSheet: book.req,
    repairSheet: book.rep,
    archiveUntouched: [book.reqArchive, book.repArchive],
    notes: notes
  };
  Logger.log('migrateH9ToOwnSheets: ' + JSON.stringify(summary));
  return summary;
}

/** One repair record as a REP_FIELDS-ordered row. */
function repairRowToTable(rp, defaultArea) {
  return [
    rp.mtJob,
    rp.date || '',
    rp.shift || '',
    rp.area || defaultArea,
    rp.line || '',
    rp.station || '',
    normalizeMainIssue(rp.mainIssue),
    rp.specificIssue || '',
    rp.detail || '',
    rp.improvements || '',
    rp.spareParts || '',
    rp.by || '',
    rp.timeMin === '' || rp.timeMin === null || rp.timeMin === undefined ? '' : rp.timeMin,
    rp.photoAfterUrl || ''
  ];
}

/** Read one whole column's values (excluding the header). */
function columnValues(sh, col) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, col, last - 1, 1).getValues().map(function (r) { return r[0]; });
}

/**
 * Undo a repair-sheet rebuild that died after renaming the original aside:
 * the live name is left on an empty sheet while a dated backup holds the
 * data. Deletes the empty shell and puts the backup back under its own name.
 * Returns the backup's name if it restored one, else ''.
 */
function restoreInterruptedRebuild(ss, sheetName) {
  var live = getSheet(sheetName);
  if (live && !sheetHasNoRows(live)) return '';   // nothing to fix
  var backup = latestRebuildBackup(ss, sheetName);
  if (!backup) return '';

  var backupName = backup.getName();
  if (live) ss.deleteSheet(live);
  backup.setName(sheetName);
  Logger.log('restoreInterruptedRebuild: ' + backupName + ' -> ' + sheetName);
  return backupName;
}

/** True when a sheet holds no data rows — at most a header. */
function sheetHasNoRows(sh) {
  return sh.getLastRow() <= 1;
}

/** The most recent "<name> (เดิม …)" sheet left by a previous rebuild. */
function latestRebuildBackup(ss, baseName) {
  var prefix = baseName + ' (เดิม ';
  var found = null;
  ss.getSheets().forEach(function (s) {
    var n = s.getName();
    if (n.indexOf(prefix) !== 0) return;
    if (!found || n > found.getName()) found = s; // dated names sort correctly
  });
  return found;
}

function readAllValues(sh) {
  var last = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (last < 1 || lastCol < 1) return [];
  return sh.getRange(1, 1, last, lastCol).getValues();
}

/**
 * Write a table in blocks rather than one giant setValues, retrying each on a
 * transient Sheets timeout. This spreadsheet carries enough dependent formulas
 * that a single large write can push the service past its limit; smaller
 * writes with a flush between them get through where one big one doesn't.
 */
function writeRowsChunked(sh, table, startRow) {
  if (!table.length) return;
  var CHUNK = 200;
  var width = table[0].length;
  var base = startRow || 1;
  for (var start = 0; start < table.length; start += CHUNK) {
    var block = table.slice(start, start + CHUNK);
    var row = base + start;
    withSheetRetry(function () {
      sh.getRange(row, 1, block.length, width).setValues(block);
      SpreadsheetApp.flush();
    });
  }
}

/** Retry a Sheets operation through the transient "Service Spreadsheets timed
 * out" the service throws when the document is busy. Anything else rethrows
 * immediately — a real bug shouldn't be retried three times. */
function withSheetRetry(fn) {
  var attempts = 3;
  for (var i = 0; i < attempts; i++) {
    try { return fn(); }
    catch (err) {
      var msg = String((err && err.message) || err);
      var transient = msg.indexOf('timed out') >= 0 || msg.indexOf('try again') >= 0 ||
        msg.indexOf('Service Spreadsheets') >= 0;
      if (!transient || i === attempts - 1) throw err;
      Logger.log('withSheetRetry: transient failure, retrying — ' + msg);
      Utilities.sleep(3000 * (i + 1));
    }
  }
}


function readRepairsInRange(range, fLine) {
  return readRepairRowsFull().filter(function (rp) {
    if (rp.date instanceof Date) { if (rp.date < range.from || rp.date > range.to) return false; }
    if (fLine && rp.line && rp.line !== fLine) return false;
    return true;
  }).map(function (rp) {
    return { mtJob: rp.mtJob, mainIssue: rp.mainIssue, issue: rp.specificIssue, timeMin: rp.timeMin };
  });
}

// ---------------------------------------------------------------------------
// One machine's full service record
// ---------------------------------------------------------------------------

/**
 * Everything ever recorded against a single machine, plus the two numbers a
 * maintenance decision actually turns on: how long it takes to fix (MTTR) and
 * how long it stays fixed (MTBF). The dashboard can say which machines break
 * most often; this says whether a particular one is getting worse.
 *
 * Stats cover the machine's whole history; the job list is capped, since a
 * screen can't use hundreds of rows and the payload has to cross Apps Script.
 */
function apiGetMachineHistory(payload) {
  payload = payload || {};
  var mc   = String(payload.mc || '').trim();
  if (!mc) throw new Error('ไม่ระบุเครื่องจักร');
  var line = String(payload.line || '').trim();
  var area = String(payload.area || '').trim();
  var LIST_LIMIT = 200;

  var jobs = apiGetBMJobs({}).filter(function (j) {
    if (j.mc !== mc) return false;
    if (line && j.line !== line) return false;
    if (area && j.area !== area) return false;
    return true;
  });

  // What was actually wrong / what was done lives in the repair sheet.
  var repByMt = {};
  readRepairRowsFull().forEach(function (rp) { repByMt[rp.mtJob] = rp; });

  var closedDowntimes = [];
  var failureTimes = [];
  var issueCount = {};
  var totalDowntime = 0;
  var openJobs = 0;
  var OPEN = [ST_NEW, ST_ACCEPT, ST_REPAIR, ST_WAIT];

  jobs.forEach(function (j) {
    var t = j.timestamp ? new Date(j.timestamp) : (j.date ? new Date(j.date) : null);
    if (t && !isNaN(t.getTime())) failureTimes.push(t.getTime());

    if (j.status === ST_DONE) {
      var dt = Number(j.downtime) || 0;
      totalDowntime += dt;
      closedDowntimes.push(dt);
    } else if (OPEN.indexOf(j.status) >= 0) {
      openJobs++;
    }

    var rp = repByMt[j.mtJob];
    var label = rp && (rp.specificIssue || rp.mainIssue);
    if (label) issueCount[label] = (issueCount[label] || 0) + 1;
  });

  // MTBF: mean gap between consecutive failures, in days. Needs two failures
  // to mean anything — a machine that has broken once has no interval yet.
  failureTimes.sort(function (a, b) { return a - b; });
  var mtbfDays = 0;
  if (failureTimes.length >= 2) {
    var span = failureTimes[failureTimes.length - 1] - failureTimes[0];
    mtbfDays = round2((span / (failureTimes.length - 1)) / 86400000);
  }

  var mttr = closedDowntimes.length
    ? round2(closedDowntimes.reduce(function (a, b) { return a + b; }, 0) / closedDowntimes.length)
    : 0;

  var recent = jobs.slice().reverse().slice(0, LIST_LIMIT).map(function (j) {
    var rp = repByMt[j.mtJob] || {};
    return {
      mtJob: j.mtJob, date: j.date, timestamp: j.timestamp, status: j.status,
      shift: j.shift, area: j.area, line: j.line, mc: j.mc,
      symptom: j.symptom, priority: j.priority, reporter: j.reporter,
      downtime: j.downtime, machineStop: j.machineStop,
      mainIssue: rp.mainIssue || '', issue: rp.specificIssue || ''
    };
  });

  return {
    machine: { area: area, line: line, mc: mc },
    stats: {
      totalJobs: jobs.length,
      openJobs: openJobs,
      totalDowntime: totalDowntime,
      mttr: mttr,
      mtbfDays: mtbfDays,
      firstFailure: failureTimes.length ? toIso(new Date(failureTimes[0])) : '',
      lastFailure: failureTimes.length ? toIso(new Date(failureTimes[failureTimes.length - 1])) : ''
    },
    topIssues: sortDesc(issueCount).slice(0, 8),
    jobs: recent,
    truncated: jobs.length > recent.length
  };
}

// ---------------------------------------------------------------------------
// History (all-time retrospective analytics; frequency-based, no downtime)
// ---------------------------------------------------------------------------

function apiGetHistory(payload) {
  var jobs = apiGetBMJobs({}); // valid Record แจ้งซ่อม rows (garbage already filtered)
  var byMonth = {}, byLine = {}, byStation = {}, byShift = {};
  var minD = null, maxD = null;

  jobs.forEach(function (j) {
    var d = j.date ? new Date(j.date) : (j.timestamp ? new Date(j.timestamp) : null);
    if (d && !isNaN(d.getTime())) {
      var mk = d.getFullYear() + '-' + pad2(d.getMonth() + 1);
      byMonth[mk] = (byMonth[mk] || 0) + 1;
      if (!minD || d < minD) minD = d;
      if (!maxD || d > maxD) maxD = d;
    }
    var line = j.line || 'ไม่ระบุ'; byLine[line] = (byLine[line] || 0) + 1;
    var st = j.mc || 'ไม่ระบุ'; byStation[st] = (byStation[st] || 0) + 1;
    var sh = j.shift || 'ไม่ระบุ'; byShift[sh] = (byShift[sh] || 0) + 1;
  });

  var repairs = readRepairRowsFull();
  var byMainIssue = {}, byIssue = {};
  repairs.forEach(function (rp) {
    var mi = normalizeMainIssue(rp.mainIssue);
    byMainIssue[mi] = (byMainIssue[mi] || 0) + 1;
    var iss = rp.specificIssue;
    if (iss) byIssue[iss] = (byIssue[iss] || 0) + 1;
  });

  var monthsArr = sortByKey(byMonth);
  var stationsArr = sortDesc(byStation);
  var linesArr = sortDesc(byLine);
  var nMonths = monthsArr.length || 1;
  var busiest = monthsArr.slice().sort(function (a, b) { return b.value - a.value; })[0] || { key: '-', value: 0 };

  return {
    summary: {
      totalBM: jobs.length,
      repairRecords: repairs.length,
      firstDate: minD ? toIso(minD) : '',
      lastDate: maxD ? toIso(maxD) : '',
      months: monthsArr.length,
      avgPerMonth: round2(jobs.length / nMonths),
      busiestMonth: busiest,
      worstStation: stationsArr[0] || { key: '-', value: 0 },
      worstLine: linesArr[0] || { key: '-', value: 0 }
    },
    byMonth: monthsArr,
    byLine: linesArr,
    byStation: stationsArr.slice(0, 10),
    byShift: sortDesc(byShift),
    byMainIssue: sortDesc(byMainIssue),
    topIssues: sortDesc(byIssue).slice(0, 10)
  };
}

/** Sum Work_min for the range from Work_Actual. Best-effort by header detection. */
function readWorkMinutes(range, fLine) {
  var sh = getSheet(SHEET_WORK);
  if (!sh) return 0;
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var maxCol = sh.getLastColumn();
  var headers = sh.getRange(1, 1, 1, maxCol).getValues()[0].map(function (h) {
    return String(h || '').toLowerCase().trim();
  });
  function findCol(cands) {
    for (var i = 0; i < headers.length; i++) {
      for (var j = 0; j < cands.length; j++) {
        if (headers[i].indexOf(cands[j]) >= 0) return i;
      }
    }
    return -1;
  }
  var dateCol = findCol(['date', 'วันที่']);
  var lineCol = findCol(['line', 'ไลน์']);
  var minCol  = findCol(['work_min', 'work min', 'work_actual', 'นาที', 'minute']);
  var hrCol   = findCol(['hour', 'ชั่วโมง']);
  if (minCol < 0 && hrCol < 0) return 0;

  var values = sh.getRange(2, 1, last - 1, maxCol).getValues();
  var total = 0;
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    if (dateCol >= 0) {
      var d = row[dateCol];
      if (d instanceof Date) { if (d < range.from || d > range.to) continue; }
    }
    if (fLine && lineCol >= 0 && String(row[lineCol]) !== fLine) continue;
    if (minCol >= 0) total += Number(row[minCol]) || 0;
    else if (hrCol >= 0) total += (Number(row[hrCol]) || 0) * 60;
  }
  return total;
}

function computePMCompliance(range) {
  var sh = getSheet(SHEET_PM_REC);
  if (!sh) return 0;
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var values = sh.getRange(2, 1, last - 1, 9).getValues();
  var onTime = 0, total = 0;
  for (var i = 0; i < values.length; i++) {
    var d = values[i][2]; // Done_DateTime
    if (d instanceof Date) { if (d < range.from || d > range.to) continue; }
    total++;
    if (String(values[i][8]) === 'OnTime') onTime++;
  }
  return total ? round2((onTime / total) * 100) : 0;
}

// ---------------------------------------------------------------------------
// Admin CRUD (CONFIG / PM_MASTER / USERS)
// ---------------------------------------------------------------------------

function apiAdminCRUD(payload, user) {
  requireAdmin(user);
  var entity = payload.entity;
  var op = payload.op;

  if (entity === 'USERS')     return crudUsers(op, payload);
  if (entity === 'CONFIG')    return crudConfig(op, payload);
  if (entity === 'PM_MASTER') return crudPMMaster(op, payload);
  throw new Error('entity ไม่ถูกต้อง: ' + entity);
}

// ---------------------------------------------------------------------------
// Sessions — who the caller actually is
// ---------------------------------------------------------------------------
//
// The `user` object on every request is whatever the browser chose to send:
// this Web App is deployed "Anyone", and its URL ships in js/config.js on a
// public site, so a claimed role is worth nothing. Anything destructive has
// to re-derive the caller's identity here, from a token this script issued
// and the role written in the USERS sheet.

/** Record a login and hand back its token. */
function issueSession(empId) {
  ensureSheetsOnce();
  var sh = getSheetOrThrow(SHEET_SESSIONS);
  var token = Utilities.getUuid();
  var now = new Date();
  sh.appendRow([token, String(empId), now, new Date(now.getTime() + SESSION_DAYS * 86400000)]);
  return token;
}

/** Token -> Emp_ID, or '' if unknown/expired. Cached because every privileged
 * call pays for this, and the SESSIONS sheet only ever grows. */
function empIdForToken(token) {
  token = String(token || '').trim();
  if (!token) return '';

  var cache = CacheService.getScriptCache();
  var cacheKey = 'sess_' + token;
  var hit = cache.get(cacheKey);
  if (hit) return hit;

  var sh = getSheet(SHEET_SESSIONS);
  if (!sh) return '';
  var last = sh.getLastRow();
  if (last < 2) return '';

  var rows = sh.getRange(2, 1, last - 1, 4).getValues();
  var now = new Date();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() !== token) continue;
    var expires = rows[i][3];
    if (expires instanceof Date && expires < now) return ''; // let it lapse
    var empId = String(rows[i][1]).trim();
    cache.put(cacheKey, empId, 21600); // 6h — the cap CacheService allows
    return empId;
  }
  return '';
}

function revokeSession(token) {
  token = String(token || '').trim();
  if (!token) return false;
  CacheService.getScriptCache().remove('sess_' + token);
  var sh = getSheet(SHEET_SESSIONS);
  if (!sh) return false;
  var last = sh.getLastRow();
  if (last < 2) return false;
  var col = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = col.length - 1; i >= 0; i--) {
    if (String(col[i][0]).trim() === token) { sh.deleteRow(i + 2); return true; }
  }
  return false;
}

/** Look a user up by Emp_ID, tolerant of Sheets' leading-zero coercion. */
function userByEmpId(empId) {
  var sh = getSheet(SHEET_USERS);
  if (!sh) return null;
  var map = userColMap(sh);
  var values = sh.getDataRange().getValues();
  var target = stripLeadingZeros(empId);
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (stripLeadingZeros(uCell(row, map.empId)) !== target) continue;
    return {
      empId: String(uCell(row, map.empId) || '').trim(),
      name:  String(uCell(row, map.name) || '').trim(),
      role:  String(uCell(row, map.role) || ''),
      line:  String(uCell(row, map.line) || ''),
      shift: String(uCell(row, map.shift) || '').trim()
    };
  }
  return null;
}

/** The caller's real record, or null. Never trusts a field off the request. */
function resolveUser(clientUser) {
  var empId = empIdForToken(clientUser && clientUser.token);
  return empId ? userByEmpId(empId) : null;
}

/** Roles are free-form (Admin / Leader A/B / Leader Technician A/B / Technician);
 * "admin" access is anyone whose role name contains "admin" — mirrors
 * js/auth.js roleGroup() so client and server agree on who's an Admin.
 *
 * Returns the verified user so callers can attribute the change to them
 * instead of to a name the request supplied. */
function requireAdmin(clientUser) {
  var actual = resolveUser(clientUser);
  if (!actual) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่ ' + ERR_SESSION);
  if (String(actual.role || '').toLowerCase().indexOf('admin') < 0) {
    throw new Error('ไม่มีสิทธิ์ (ต้องเป็น Admin)');
  }
  return actual;
}

/** Find a USERS row by Emp_ID (by header-mapped column), tolerant of
 * Sheets' leading-zero coercion. */
function findUserRow(sh, empId) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var map = userColMap(sh);
  if (map.empId < 0) return -1;
  var col = sh.getRange(2, map.empId + 1, last - 1, 1).getValues();
  var target = stripLeadingZeros(empId);
  for (var i = 0; i < col.length; i++) {
    if (stripLeadingZeros(col[i][0]) === target) return i + 2;
  }
  return -1;
}

function crudUsers(op, payload) {
  var sh = getSheetOrThrow(SHEET_USERS);
  if (op === 'list') return apiGetUsers();
  var d = payload.data || {};
  var map = userColMap(sh);

  function writeFields(row, fields) {
    if (map.empId >= 0 && fields.empId !== undefined) sh.getRange(row, map.empId + 1).setValue(fields.empId);
    if (map.name  >= 0 && fields.name  !== undefined) sh.getRange(row, map.name  + 1).setValue(fields.name);
    if (map.role  >= 0 && fields.role  !== undefined) sh.getRange(row, map.role  + 1).setValue(fields.role);
    if (map.line  >= 0 && fields.line  !== undefined) sh.getRange(row, map.line  + 1).setValue(fields.line);
    if (map.pin   >= 0 && fields.pin   !== undefined) sh.getRange(row, map.pin   + 1).setValue(fields.pin);
    if (map.shift >= 0 && fields.shift !== undefined) sh.getRange(row, map.shift + 1).setValue(fields.shift);
  }

  if (op === 'create') {
    var newRow = sh.getLastRow() + 1;
    writeFields(newRow, { empId: d.empId, name: d.name, role: d.role, line: d.line, pin: d.pin, shift: d.shift || '' });
    return { ok: true };
  }
  if (op === 'update' || op === 'delete') {
    var row = findUserRow(sh, d.empId);
    if (row < 0) throw new Error('ไม่พบผู้ใช้ ' + d.empId);
    if (op === 'delete') { sh.deleteRow(row); return { ok: true }; }
    writeFields(row, { empId: d.empId, name: d.name, role: d.role, line: d.line, pin: d.pin, shift: d.shift || '' });
    return { ok: true };
  }
  throw new Error('op ไม่ถูกต้อง');
}

function crudConfig(op, payload) {
  var sh = getSheetOrThrow(SHEET_CONFIG);
  if (op === 'list') { return sh.getDataRange().getValues(); }
  var d = payload.data || {};
  if (op === 'create') {
    sh.appendRow([d.type, d.value, d.parent || '', d.active !== false]);
    return { ok: true };
  }
  if (op === 'delete') {
    var row = Number(d.rowIndex);
    if (row >= 2) { sh.deleteRow(row); return { ok: true }; }
    throw new Error('rowIndex ไม่ถูกต้อง');
  }
  if (op === 'update') {
    var r = Number(d.rowIndex);
    sh.getRange(r, 1, 1, 4).setValues([[d.type, d.value, d.parent || '', d.active !== false]]);
    return { ok: true };
  }
  throw new Error('op ไม่ถูกต้อง');
}

function crudPMMaster(op, payload) {
  var sh = getSheetOrThrow(SHEET_PM_MAST);
  if (op === 'list') return readPMMaster();
  var d = payload.data || {};
  if (op === 'create') {
    var pmId = d.pmId || generatePMId(sh);
    var next = d.nextDue ? parseYMD(d.nextDue) : computeNextDue(new Date(), d.frequency);
    // photoBase64 (a freshly-picked file) is uploaded once; photoUrl lets the
    // client round-trip an already-uploaded URL across a multi-machine batch
    // add without re-uploading the same reference photo per machine.
    var photoUrl = d.photoBase64 ? savePhoto(d.photoBase64, pmId, 'pm_ref', new Date()) : (d.photoUrl || '');
    sh.appendRow([
      pmId, d.line, d.mcStation, d.pmItem, d.standard, d.frequency,
      d.lastDone ? parseYMD(d.lastDone) : '', next, d.assignedTo, d.active !== false,
      d.notes || '', photoUrl
    ]);
    return { ok: true, pmId: pmId, photoUrl: photoUrl };
  }
  var row = findPMRow(sh, d.pmId);
  if (row < 0) throw new Error('ไม่พบแผน PM ' + d.pmId);
  if (op === 'delete') { sh.deleteRow(row); return { ok: true }; }
  if (op === 'update') {
    var photoUrl2 = d.photoBase64 ? savePhoto(d.photoBase64, d.pmId, 'pm_ref', new Date()) : (d.photoUrl || '');
    sh.getRange(row, 1, 1, 12).setValues([[
      d.pmId, d.line, d.mcStation, d.pmItem, d.standard, d.frequency,
      d.lastDone ? parseYMD(d.lastDone) : '', d.nextDue ? parseYMD(d.nextDue) : '',
      d.assignedTo, d.active !== false, d.notes || '', photoUrl2
    ]]);
    return { ok: true, photoUrl: photoUrl2 };
  }
  throw new Error('op ไม่ถูกต้อง');
}

function generatePMId(sh) {
  var last = sh.getLastRow();
  var max = 0;
  if (last >= 2) {
    var col = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < col.length; i++) {
      var m = /^PM-(\d+)$/.exec(String(col[i][0] || '').trim());
      if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
    }
  }
  return 'PM-' + pad3(max + 1);
}

// ---------------------------------------------------------------------------
// Knowledge Base
// ---------------------------------------------------------------------------

function readKBArticles() {
  var sh = getSheet(SHEET_KB_ART);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, 23).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (!row[0]) continue;
    out.push({
      kbId:            String(row[0]),
      title:           String(row[1] || ''),
      category:        String(row[2] || ''),
      mainIssue:       String(row[3] || ''),
      line:            String(row[4] || ''),
      station:         String(row[5] || ''),
      symptomKeywords: String(row[6] || ''),
      problem:         String(row[7] || ''),
      rootCause:       String(row[8] || ''),
      solution:        String(row[9] || ''),
      prevention:      String(row[10] || ''),
      tools:           String(row[11] || ''),
      spareParts:      String(row[12] || ''),
      timeEst:         row[13] || '',
      warning:         String(row[14] || ''),
      photoUrls:       String(row[15] || ''),
      refMtJobNo:      String(row[16] || ''),
      author:          String(row[17] || ''),
      createdDate:     toIso(row[18]),
      updatedDate:     toIso(row[19]),
      views:           Number(row[20]) || 0,
      helpfulCount:    Number(row[21]) || 0,
      status:          String(row[22] || '')
    });
  }
  return out;
}

/** List + filter (category/mainIssue/line/station) + sort (views/helpful/recent).
 * Drafts are excluded — this is the reader-facing list. */
function apiGetKBList(payload) {
  var p = payload || {};
  var all = readKBArticles().filter(function (a) { return a.status !== 'Draft'; });

  if (p.category)  all = all.filter(function (a) { return a.category === p.category; });
  if (p.mainIssue) all = all.filter(function (a) { return a.mainIssue === p.mainIssue; });
  if (p.line)      all = all.filter(function (a) { return a.line === p.line || a.line === 'ทุกไลน์'; });
  if (p.station)   all = all.filter(function (a) { return a.station === p.station || a.station === 'ทุก Station'; });

  var sort = p.sort || 'recent';
  if (sort === 'views') all.sort(function (a, b) { return b.views - a.views; });
  else if (sort === 'helpful') all.sort(function (a, b) { return b.helpfulCount - a.helpfulCount; });
  else all.sort(function (a, b) { return new Date(b.createdDate) - new Date(a.createdDate); });

  return all;
}

/** One article + up to 3 related ones (same Station or Main_Issue). */
function apiGetKBDetail(payload) {
  var all = readKBArticles();
  var id = String((payload || {}).kbId || '');
  var article = all.filter(function (a) { return a.kbId === id; })[0];
  if (!article) throw new Error('ไม่พบบทความ ' + id);

  var related = all.filter(function (a) {
    return a.kbId !== article.kbId && a.status !== 'Draft' &&
      (a.station === article.station || a.mainIssue === article.mainIssue);
  }).slice(0, 3);

  return { article: article, related: related };
}

/** Fuzzy score search: Title match = 3pts, Symptom_Keywords = 2pts,
 * Problem = 1pt, sorted by score desc. The frontend runs this same scoring
 * client-side against its cached getKBList result for instant-while-typing
 * results (see js/kb.js) — this server action exists for completeness and
 * for whenever the article count outgrows a comfortable client-side cache. */
function apiSearchKB(payload) {
  var q = String((payload || {}).q || '').trim().toLowerCase();
  if (!q) return [];
  var all = readKBArticles().filter(function (a) { return a.status !== 'Draft'; });
  var scored = all.map(function (a) {
    var score = 0;
    if (a.title.toLowerCase().indexOf(q) >= 0) score += 3;
    if ((a.symptomKeywords || '').toLowerCase().indexOf(q) >= 0) score += 2;
    if ((a.problem || '').toLowerCase().indexOf(q) >= 0) score += 1;
    return { article: a, score: score };
  }).filter(function (x) { return x.score > 0; });
  scored.sort(function (x, y) { return y.score - x.score; });
  return scored.map(function (x) { return x.article; });
}

/** Station+Line+symptom-keyword match, for suggesting KB articles on a job
 * card (jobs.html "💡 เคยเจอเคสนี้"). This is the server-side twin of
 * jobs.js's findRelatedKB, which runs the same scoring client-side against
 * an already-cached getKBList result so the job board never waits on a
 * network call per card — this action exists for spec completeness / any
 * future caller that isn't already holding that cached list. */
function apiGetKBRelated(payload) {
  var p = payload || {};
  var station = String(p.station || '');
  var line = String(p.line || '');
  var symptom = String(p.symptom || '').toLowerCase();
  var all = readKBArticles().filter(function (a) { return a.status !== 'Draft'; });

  var scored = all.map(function (a) {
    var score = 0;
    if (station && a.station === station) score += 3;
    else if (a.station === 'ทุก Station') score += 1;
    if (line && a.line === line) score += 2;
    else if (a.line === 'ทุกไลน์') score += 1;
    var kws = (a.symptomKeywords || '').split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
    kws.forEach(function (kw) { if (kw && symptom.indexOf(kw) >= 0) score += 2; });
    return { article: a, score: score };
  }).filter(function (x) { return x.score >= 3; });
  scored.sort(function (x, y) { return y.score - x.score; });
  return scored.map(function (x) { return x.article; });
}

/** Locate a KB_ARTICLES row by KB_ID. Returns 1-based row, or -1. */
function findKBRow(sh, kbId) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var col = sh.getRange(2, 1, last - 1, 1).getValues();
  var target = String(kbId).trim();
  for (var i = 0; i < col.length; i++) {
    if (String(col[i][0] || '').trim() === target) return i + 2;
  }
  return -1;
}

function generateKBId(sh) {
  var last = sh.getLastRow();
  var max = 0;
  if (last >= 2) {
    var col = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < col.length; i++) {
      var m = /^KB-(\d+)$/.exec(String(col[i][0] || '').trim());
      if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
    }
  }
  return 'KB-' + ('000' + (max + 1)).slice(-4);
}

/** Create or update a KB article. Required: title, problem, solution.
 * Photos: existingPhotoUrls (comma string of URLs to keep) + photoBase64List
 * (array of newly-picked images this session) are merged; only the new ones
 * get uploaded to Drive. Author/Created_Date are set once on create and
 * never touched again; Updated_Date refreshes on every save. */
function apiSaveKB(payload, user) {
  var sh = getSheetOrThrow(SHEET_KB_ART);
  var d = payload || {};
  if (!d.title || !d.problem || !d.solution) {
    throw new Error('กรอก ชื่อเรื่อง, อาการที่เจอ, วิธีแก้ ให้ครบ');
  }
  var now = new Date();

  var photoUrls = d.existingPhotoUrls ? String(d.existingPhotoUrls).split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
  var newKbIdForPhotos = d.kbId || generateKBId(sh);
  (d.photoBase64List || []).forEach(function (b64, i) {
    photoUrls.push(saveKBPhoto(b64, newKbIdForPhotos, photoUrls.length + i, now));
  });

  if (d.kbId) {
    var row = findKBRow(sh, d.kbId);
    if (row < 0) throw new Error('ไม่พบบทความ ' + d.kbId);
    var existing = sh.getRange(row, 1, 1, 23).getValues()[0];
    sh.getRange(row, 1, 1, 23).setValues([[
      d.kbId, d.title, d.category || '', d.mainIssue || '', d.line || '', d.station || '',
      d.symptomKeywords || '', d.problem, d.rootCause || '', d.solution, d.prevention || '',
      d.tools || '', d.spareParts || '', d.timeEst || '', d.warning || '',
      photoUrls.join(','), d.refMtJobNo || '', existing[17], existing[18], now,
      existing[20], existing[21], d.status || 'Draft'
    ]]);
    return { ok: true, kbId: d.kbId };
  }

  var kbId = newKbIdForPhotos;
  sh.appendRow([
    kbId, d.title, d.category || '', d.mainIssue || '', d.line || '', d.station || '',
    d.symptomKeywords || '', d.problem, d.rootCause || '', d.solution, d.prevention || '',
    d.tools || '', d.spareParts || '', d.timeEst || '', d.warning || '',
    photoUrls.join(','), d.refMtJobNo || '', (user && user.name) || 'ไม่ระบุ',
    now, now, 0, 0, d.status || 'Draft'
  ]);
  return { ok: true, kbId: kbId };
}

/** Deleting an article is destructive and irreversible, so the same rule
 * kb-detail.js applies in the UI (admin, or the article's own author) is
 * re-checked here against the caller's verified identity. */
function apiDeleteKB(payload, user) {
  var actual = resolveUser(user);
  if (!actual) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่ ' + ERR_SESSION);

  var sh = getSheetOrThrow(SHEET_KB_ART);
  var kbId = String((payload || {}).kbId || '').trim();
  if (!kbId) throw new Error('ไม่ระบุ KB_ID');
  var row = findKBRow(sh, kbId);
  if (row < 0) throw new Error('ไม่พบบทความ ' + kbId);

  var author = String(sh.getRange(row, 18).getValue() || '').trim(); // R Author
  var isAdmin = String(actual.role || '').toLowerCase().indexOf('admin') >= 0;
  if (!isAdmin && author && author !== actual.name) {
    throw new Error('ลบได้เฉพาะบทความของตัวเอง (หรือให้ Admin ลบให้)');
  }

  sh.deleteRow(row);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Drive photo storage
// ---------------------------------------------------------------------------

// Human-readable subfolder per photo kind, nested under that day's folder.
// 'pm_ref' is intentionally excluded — a PM plan's reference photo isn't
// evidence from a specific day's work, so it lives in its own flat folder
// instead (see getPMPlanPhotoFolder), same reasoning as KB's photos.
var KIND_FOLDERS = { before: 'แจ้งซ่อม', after: 'หลังซ่อม', pm: 'PM' };

function savePhoto(base64, mtJob, kind, date, book) {
  var data = base64;
  var m = /^data:(image\/\w+);base64,(.*)$/.exec(base64);
  var mime = 'image/jpeg';
  if (m) { mime = m[1]; data = m[2]; }

  var bytes = Utilities.base64Decode(data);
  var ts = date.getTime();
  var fileName = mtJob.replace(/[^\w\-]/g, '_') + '_' + kind + '_' + ts + '.jpg';
  var blob = Utilities.newBlob(bytes, mime, fileName);

  var folder = (kind === 'pm_ref') ? getPMPlanPhotoFolder() : getDayKindFolder(date, kind, book);
  var file = folder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (shareErr) {
    // Some accounts/domains restrict "anyone with link" sharing. Don't let
    // that block the BM/PM submission — the file still exists and the URL
    // is still stored; it just may not render for users without access.
    Logger.log('savePhoto: setSharing failed (continuing without it): ' + shareErr);
  }
  return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w800';
}

/** Maintenance_Photos/<พื้นที่>/YYYY-MM-DD/<แจ้งซ่อม|หลังซ่อม|PM>/ — split by
 * production area first so two lines' evidence photos never mix, then by day
 * so a day's folder holds everything from that day, then by photo kind so
 * "before" and "after" shots stay apart.
 *
 * Photos taken before the area level existed sit directly under
 * Maintenance_Photos/YYYY-MM-DD/ — they're left where they are (their URLs
 * are already stored in the sheets), so only new photos get the area folder. */
function getDayKindFolder(date, kind, book) {
  var root = getRootPhotoFolder();
  var areaName = (book && book.photoFolder) ? book.photoFolder : '';
  if (areaName) {
    var areaIt = root.getFoldersByName(areaName);
    root = areaIt.hasNext() ? areaIt.next() : root.createFolder(areaName);
  }
  var dayName = date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  var dayIt = root.getFoldersByName(dayName);
  var dayFolder = dayIt.hasNext() ? dayIt.next() : root.createFolder(dayName);

  var kindName = KIND_FOLDERS[kind] || kind;
  var kindIt = dayFolder.getFoldersByName(kindName);
  return kindIt.hasNext() ? kindIt.next() : dayFolder.createFolder(kindName);
}

function getPMPlanPhotoFolder() {
  var root = getRootPhotoFolder();
  var it = root.getFoldersByName('PM_Plans');
  return it.hasNext() ? it.next() : root.createFolder('PM_Plans');
}

/** KB photos live in one flat Maintenance_Photos/KB/ folder rather than
 * month subfolders — an article's photos aren't tied to a single date the
 * way a BM/PM record is. */
function getKBPhotoFolder() {
  var root = getRootPhotoFolder();
  var it = root.getFoldersByName('KB');
  return it.hasNext() ? it.next() : root.createFolder('KB');
}

function saveKBPhoto(base64, kbId, index, date) {
  var data = base64;
  var m = /^data:(image\/\w+);base64,(.*)$/.exec(base64);
  var mime = 'image/jpeg';
  if (m) { mime = m[1]; data = m[2]; }

  var bytes = Utilities.base64Decode(data);
  var fileName = String(kbId).replace(/[^\w\-]/g, '_') + '_' + index + '_' + date.getTime() + '.jpg';
  var blob = Utilities.newBlob(bytes, mime, fileName);

  var folder = getKBPhotoFolder();
  var file = folder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (shareErr) {
    Logger.log('saveKBPhoto: setSharing failed (continuing without it): ' + shareErr);
  }
  return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w800';
}

function getRootPhotoFolder() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('FOLDER_ID');
  if (folderId) {
    var parent = DriveApp.getFolderById(folderId);
    var it = parent.getFoldersByName(PHOTO_ROOT_FOLDER);
    return it.hasNext() ? it.next() : parent.createFolder(PHOTO_ROOT_FOLDER);
  }
  var rootIt = DriveApp.getFoldersByName(PHOTO_ROOT_FOLDER);
  return rootIt.hasNext() ? rootIt.next() : DriveApp.createFolder(PHOTO_ROOT_FOLDER);
}

// ---------------------------------------------------------------------------
// Daily time-driven trigger (set up once via setupDailyTrigger)
// ---------------------------------------------------------------------------

function setupDailyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'dailyScan') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('dailyScan').timeBased().atHour(6).everyDays(1).create();
}

/** 06:00 daily: mark overdue PM + flag BM jobs open > 24h (hook for future alerts). */
function dailyScan() {
  var overduePM = [];
  try { overduePM = apiGetPMDue({}).filter(function (p) { return p.overdue; }); } catch (e) {}

  var staleBM = [];
  try {
    var now = new Date();
    apiGetBMJobs({}).forEach(function (j) {
      if (j.status === ST_DONE) return;
      var t = j.timestamp ? new Date(j.timestamp) : null;
      if (t && (now.getTime() - t.getTime()) > 24 * 3600 * 1000) staleBM.push(j.mtJob);
    });
  } catch (e) {}

  var purged = purgeExpiredSessions();

  // Hook point: wire up email / LINE notification here in the future.
  Logger.log('dailyScan: overduePM=' + overduePM.length + ', staleBM=' + staleBM.length +
    ', sessionsPurged=' + purged);
  return { overduePM: overduePM.length, staleBM: staleBM.length, sessionsPurged: purged };
}

/** SESSIONS only ever grows otherwise, and every privileged call scans it. */
function purgeExpiredSessions() {
  var sh = getSheet(SHEET_SESSIONS);
  if (!sh) return 0;
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var rows = sh.getRange(2, 1, last - 1, 4).getValues();
  var now = new Date();
  var removed = 0;
  for (var i = rows.length - 1; i >= 0; i--) {  // bottom-up: deleting shifts rows
    var expires = rows[i][3];
    if (expires instanceof Date && expires < now) { sh.deleteRow(i + 2); removed++; }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Normalization + utilities
// ---------------------------------------------------------------------------

/** Map messy legacy Main_Issue spellings to the 4 canonical values. */
function normalizeMainIssue(raw) {
  var s = String(raw || '').toLowerCase().trim();
  if (!s) return 'อื่นๆ';
  if (/mach|mech|กล/.test(s)) return 'Mechanical';       // Machanical, Mechanical, กลไก
  if (/elec|ไฟ/.test(s)) return 'Electrical';            // Electrical (ไฟฟ้า)
  if (/soft|program|โปรแกรม/.test(s)) return 'Software';
  if (/cam|vision|กล้อง/.test(s)) return 'Camera&Vision';
  return 'อื่นๆ';
}

function detectShift(date) {
  var aStart = 8, bStart = 20;
  try {
    var cfg = apiGetConfig();
    if (cfg.Setting.ShiftA_StartHour) aStart = parseInt(cfg.Setting.ShiftA_StartHour, 10);
    if (cfg.Setting.ShiftB_StartHour) bStart = parseInt(cfg.Setting.ShiftB_StartHour, 10);
  } catch (e) {}
  var h = date.getHours();
  return (h >= aStart && h < bStart) ? 'A' : 'B';
}

function resolveRange(payload) {
  var p = payload || {};
  var now = new Date();
  if (p.from && p.to) {
    return { from: startOfDay(parseYMD(p.from)), to: endOfDay(parseYMD(p.to)) };
  }
  switch (p.period) {
    case 'today':
      return { from: startOfToday(), to: endOfToday() };
    case '7d':
      return { from: startOfDay(new Date(now.getTime() - 6 * 86400000)), to: endOfToday() };
    case 'month':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1),
               to: endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
    default:
      return { from: startOfDay(new Date(now.getTime() - 6 * 86400000)), to: endOfToday() };
  }
}

function sortDesc(map) {
  return Object.keys(map).map(function (k) { return { key: k, value: map[k] }; })
    .sort(function (a, b) { return b.value - a.value; });
}
function sortByKey(map) {
  return Object.keys(map).sort().map(function (k) { return { key: k, value: map[k] }; });
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function pad3(n) { return ('00' + n).slice(-3); }
function round2(n) { return Math.round(n * 100) / 100; }

function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function endOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }
function startOfToday() { return startOfDay(new Date()); }
function endOfToday() { return endOfDay(new Date()); }
function sameDay(a, b) {
  if (!(a instanceof Date)) a = new Date(a);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function parseYMD(s) {
  if (s instanceof Date) return s;
  var parts = String(s).split('-');
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
}
function toIso(v) {
  if (v instanceof Date) return v.toISOString();
  if (v === '' || v === null || v === undefined) return '';
  var d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toISOString();
}
