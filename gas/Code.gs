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

var SHEET_BM_REQ   = 'Record แจ้งซ่อม '; // NOTE: trailing space is intentional
var SHEET_BM_REP   = 'Record ซ่อม';
var SHEET_WORK     = 'Work_Actual';
var SHEET_PM_MAST  = 'PM_MASTER';
var SHEET_PM_REC   = 'PM_RECORDS';
var SHEET_CONFIG   = 'CONFIG';
var SHEET_USERS    = 'USERS';

var PHOTO_ROOT_FOLDER = 'Maintenance_Photos';

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
  MACHINE_STOP:19  // S Machine_Stop
};
var BM_WIDTH = 19;

// Status flow
var ST_NEW    = 'แจ้งซ่อม';
var ST_ACCEPT = 'รับงานแล้ว';
var ST_REPAIR = 'กำลังซ่อม';
var ST_WAIT   = 'รออะไหล่';
var ST_DONE   = 'ปิดงาน';

// Data columns we manage inside "Record ซ่อม" (looked up / appended by header name).
var REP_FIELDS = [
  'MT Job No.', 'Date', 'Shift', 'Production line', 'Station', 'Main_Issue',
  'Issue', 'Detail', 'Improvements', 'Spare_Parts', 'By', 'Time_Min', 'Photo_After_URL'
];

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
      case 'adminCRUD':      data = apiAdminCRUD(payload, user); break;
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

/** Idempotent: run once after deploy (or auto-run lazily) to bootstrap new sheets. */
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
    usr.getRange(1, 1, 1, 5).setValues([['Emp_ID', 'Name', 'Role', 'Line', 'PIN']]);
    usr.getRange(2, 1, 3, 5).setValues([
      ['0001', 'ผู้ดูแลระบบ',  'Manager',    '',       '1234'],
      ['0002', 'ช่างสมชาย',    'Technician', 'Line 1', '1111'],
      ['0003', 'หัวหน้ากะ',    'Supervisor', 'Line 4', '2222']
    ]);
    created.push(SHEET_USERS);
  }
  if (!getSheet(SHEET_PM_MAST)) {
    var pm = ss.insertSheet(SHEET_PM_MAST);
    pm.getRange(1, 1, 1, 10).setValues([[
      'PM_ID', 'Line', 'MC_Station', 'PM_Item', 'Standard',
      'Frequency', 'Last_Done', 'Next_Due', 'Assigned_To', 'Active'
    ]]);
    created.push(SHEET_PM_MAST);
  }
  if (!getSheet(SHEET_PM_REC)) {
    var pr = ss.insertSheet(SHEET_PM_REC);
    pr.getRange(1, 1, 1, 9).setValues([[
      'Record_ID', 'PM_ID', 'Done_DateTime', 'Technician', 'Result',
      'NG_Detail', 'Action_Taken', 'Photo_URL', 'Status'
    ]]);
    created.push(SHEET_PM_REC);
  }

  return { created: created, message: created.length ? 'สร้างชีทใหม่แล้ว' : 'ชีทครบถ้วนแล้ว' };
}

function seedConfig(sheet) {
  var rows = [];
  function add(type, value, parent) { rows.push([type, value, parent || '', true]); }

  ['Line 1', 'Line 4', 'Line 5'].forEach(function (v) { add('Line', v); });

  for (var i = 1; i <= 17; i++) add('Station', 'Station ' + i);
  add('Station', 'อื่นๆ');

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
  ensureSheets();
  var sh = getSheetOrThrow(SHEET_CONFIG);
  var values = sh.getDataRange().getValues();
  var out = { Line: [], Station: [], Shift: [], Main_Issue: [], Issue: [], Priority: [], By: [], Setting: {} };

  for (var r = 1; r < values.length; r++) {
    var type = String(values[r][0] || '').trim();
    var val  = values[r][1];
    var parent = String(values[r][2] || '').trim();
    var active = values[r][3];
    if (!type || val === '' || val === null) continue;
    if (active === false || String(active).toUpperCase() === 'FALSE') continue;

    if (type === 'Issue') {
      out.Issue.push({ value: String(val), parent: parent });
    } else if (type === 'Setting') {
      out.Setting[parent] = String(val);
    } else if (out[type]) {
      out[type].push(String(val));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function apiLogin(payload) {
  var sh = getSheetOrThrow(SHEET_USERS);
  var values = sh.getDataRange().getValues();
  var empId = String(payload.empId || '').trim();
  var name  = String(payload.name || '').trim();
  var pin   = String(payload.pin || '').trim();

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var rEmp = String(row[0] || '').trim();
    var rName = String(row[1] || '').trim();
    var rPin = String(row[4] || '').trim();
    var match = (empId && rEmp === empId) || (!empId && name && rName === name);
    if (match && rPin === pin) {
      return { empId: rEmp, name: rName, role: String(row[2] || ''), line: String(row[3] || '') };
    }
  }
  throw new Error('ชื่อผู้ใช้หรือ PIN ไม่ถูกต้อง');
}

/** Public list of names only (no PIN) for the login dropdown. */
function apiGetUserNames() {
  var sh = getSheet(SHEET_USERS);
  if (!sh) return [];
  var values = sh.getDataRange().getValues();
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var name = String(values[r][1] || '').trim();
    var emp = String(values[r][0] || '').trim();
    if (name) out.push({ empId: emp, name: name });
  }
  return out;
}

function apiGetUsers() {
  var sh = getSheetOrThrow(SHEET_USERS);
  var values = sh.getDataRange().getValues();
  var out = [];
  for (var r = 1; r < values.length; r++) {
    if (!values[r][0] && !values[r][1]) continue;
    out.push({
      empId: String(values[r][0] || ''), name: String(values[r][1] || ''),
      role: String(values[r][2] || ''), line: String(values[r][3] || '')
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
    var sh = getSheetOrThrow(SHEET_BM_REQ);
    var now = new Date();
    var mtJob = generateMTJobNo(sh, now);

    var photoUrl = '';
    if (payload.photoBase64) {
      photoUrl = savePhoto(payload.photoBase64, mtJob, 'before', now);
    }

    var shift = payload.shift || detectShift(now);
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

    sh.appendRow(row);

    return { mtJob: mtJob, status: ST_NEW, photoUrl: photoUrl };
  } finally {
    lock.releaseLock();
  }
}

/** MT Job No. = DDMMYYYY-n, n = next running number for that calendar day. */
function generateMTJobNo(sh, date) {
  var prefix = pad2(date.getDate()) + pad2(date.getMonth() + 1) + date.getFullYear();
  var last = sh.getLastRow();
  var max = 0;
  if (last >= 2) {
    var col = sh.getRange(2, BM.MT_JOB, last - 1, 1).getValues();
    var re = new RegExp('^' + prefix + '-(\\d+)$');
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

function apiGetBMJobs(payload) {
  var sh = getSheetOrThrow(SHEET_BM_REQ);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, BM_WIDTH).getValues();

  var fLine  = payload.line ? String(payload.line) : '';
  var fShift = payload.shift ? String(payload.shift) : '';
  var fStatus = payload.status ? String(payload.status) : '';
  var fDate  = payload.date ? parseYMD(payload.date) : null;
  var mtRe = /^\d{8}-\d+$/;

  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var mt = String(row[BM.MT_JOB - 1] || '').trim();
    if (!mtRe.test(mt)) continue; // drop garbage / formula rows

    if (fLine && String(row[BM.LINE - 1]) !== fLine) continue;
    if (fShift && String(row[BM.SHIFT - 1]) !== fShift) continue;
    if (fStatus && String(row[BM.STATUS - 1]) !== fStatus) continue;
    if (fDate) {
      var d = row[BM.DATE - 1] || row[BM.TIMESTAMP - 1];
      if (!sameDay(d, fDate)) continue;
    }

    out.push({
      rowIndex:    i + 2,
      timestamp:   toIso(row[BM.TIMESTAMP - 1]),
      date:        toIso(row[BM.DATE - 1]),
      shift:       String(row[BM.SHIFT - 1] || ''),
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

// ---------------------------------------------------------------------------
// BM: status transitions
// ---------------------------------------------------------------------------

function apiUpdateBMStatus(payload, user) {
  var sh = getSheetOrThrow(SHEET_BM_REQ);
  var rowIdx = findBMRow(sh, payload.mtJob);
  if (rowIdx < 0) throw new Error('ไม่พบงาน ' + payload.mtJob);

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
    var reqSh = getSheetOrThrow(SHEET_BM_REQ);
    var rowIdx = findBMRow(reqSh, payload.mtJob);
    if (rowIdx < 0) throw new Error('ไม่พบงาน ' + payload.mtJob);

    var now = new Date();
    var reqRow = reqSh.getRange(rowIdx, 1, 1, BM_WIDTH).getValues()[0];
    var reportedAt = reqRow[BM.TIMESTAMP - 1];
    var machineStop = reqRow[BM.MACHINE_STOP - 1] === true ||
                      String(reqRow[BM.MACHINE_STOP - 1]).toUpperCase() === 'TRUE';

    var repairMin = Number(payload.timeMin) || 0;
    var downtime;
    if (machineStop && reportedAt instanceof Date) {
      downtime = Math.round((now.getTime() - reportedAt.getTime()) / 60000);
      if (downtime < 0) downtime = repairMin; // guard against bad data
    } else {
      downtime = repairMin;
    }

    // After photo -> Drive
    var afterUrl = '';
    if (payload.photoBase64) {
      afterUrl = savePhoto(payload.photoBase64, payload.mtJob, 'after', now);
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
      'Station':         payload.station || reqRow[BM.MC - 1] || '',
      'Main_Issue':      normalizeMainIssue(payload.mainIssue),
      'Issue':           payload.issue || '',
      'Detail':          payload.detail || '',
      'Improvements':    payload.improvements || '',
      'Spare_Parts':     payload.spareParts || '',
      'By':              payload.by || (user && user.name) || '',
      'Time_Min':        repairMin,
      'Photo_After_URL': afterUrl
    });

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

function writeRepairRow(fields) {
  var sh = getSheetOrThrow(SHEET_BM_REP);
  var map = getOrCreateColumns(sh, REP_FIELDS);
  var targetRow = sh.getLastRow() + 1;

  // Write ONLY the mapped columns for our fields, cell by cell. This avoids
  // clobbering any existing (possibly formula) columns that may sit between
  // our fields when some field names already exist in the legacy sheet.
  REP_FIELDS.forEach(function (f) {
    if (fields[f] !== undefined) sh.getRange(targetRow, map[f]).setValue(fields[f]);
  });
}

// ---------------------------------------------------------------------------
// PM
// ---------------------------------------------------------------------------

function readPMMaster() {
  var sh = getSheetOrThrow(SHEET_PM_MAST);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, 10).getValues();
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
      active:    row[9] === true || String(row[9]).toUpperCase() === 'TRUE'
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
      photoUrl = savePhoto(payload.photoBase64, 'PM_' + payload.pmId, 'pm', now);
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

  inRange.forEach(function (j) {
    var dt = Number(j.downtime) || 0;
    var closed = j.status === ST_DONE;
    if (closed) { totalDowntime += dt; mttrSum += dt; mttrCount++; }
    else open++;

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

function readRepairsInRange(range, fLine) {
  var sh = getSheet(SHEET_BM_REP);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var map = getOrCreateColumns(sh, REP_FIELDS);
  var maxCol = sh.getLastColumn();
  var values = sh.getRange(2, 1, last - 1, maxCol).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var mt = String(row[map['MT Job No.'] - 1] || '').trim();
    if (!/^\d{8}-\d+$/.test(mt)) continue;
    var d = row[map['Date'] - 1];
    if (d instanceof Date) { if (d < range.from || d > range.to) continue; }
    var line = String(row[map['Production line'] - 1] || '');
    if (fLine && line !== fLine) continue;
    out.push({
      mtJob: mt,
      mainIssue: String(row[map['Main_Issue'] - 1] || ''),
      issue: String(row[map['Issue'] - 1] || ''),
      timeMin: row[map['Time_Min'] - 1]
    });
  }
  return out;
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
  requireRole(user, ['Supervisor', 'Manager']);
  var entity = payload.entity;
  var op = payload.op;

  if (entity === 'USERS')     return crudUsers(op, payload);
  if (entity === 'CONFIG')    return crudConfig(op, payload);
  if (entity === 'PM_MASTER') return crudPMMaster(op, payload);
  throw new Error('entity ไม่ถูกต้อง: ' + entity);
}

function requireRole(user, roles) {
  var role = user && user.role ? String(user.role) : '';
  if (roles.indexOf(role) < 0) throw new Error('ไม่มีสิทธิ์ (ต้องเป็น ' + roles.join('/') + ')');
}

function crudUsers(op, payload) {
  var sh = getSheetOrThrow(SHEET_USERS);
  if (op === 'list') return apiGetUsers();
  var d = payload.data || {};
  if (op === 'create') {
    sh.appendRow([d.empId, d.name, d.role, d.line, d.pin]);
    return { ok: true };
  }
  if (op === 'update' || op === 'delete') {
    var row = findPMRow(sh, d.empId); // reuse: matches col A
    if (row < 0) throw new Error('ไม่พบผู้ใช้ ' + d.empId);
    if (op === 'delete') { sh.deleteRow(row); return { ok: true }; }
    sh.getRange(row, 1, 1, 5).setValues([[d.empId, d.name, d.role, d.line, d.pin]]);
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
    sh.appendRow([
      pmId, d.line, d.mcStation, d.pmItem, d.standard, d.frequency,
      d.lastDone ? parseYMD(d.lastDone) : '', next, d.assignedTo, d.active !== false
    ]);
    return { ok: true, pmId: pmId };
  }
  var row = findPMRow(sh, d.pmId);
  if (row < 0) throw new Error('ไม่พบแผน PM ' + d.pmId);
  if (op === 'delete') { sh.deleteRow(row); return { ok: true }; }
  if (op === 'update') {
    sh.getRange(row, 1, 1, 10).setValues([[
      d.pmId, d.line, d.mcStation, d.pmItem, d.standard, d.frequency,
      d.lastDone ? parseYMD(d.lastDone) : '', d.nextDue ? parseYMD(d.nextDue) : '',
      d.assignedTo, d.active !== false
    ]]);
    return { ok: true };
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
// Drive photo storage
// ---------------------------------------------------------------------------

function savePhoto(base64, mtJob, kind, date) {
  var data = base64;
  var m = /^data:(image\/\w+);base64,(.*)$/.exec(base64);
  var mime = 'image/jpeg';
  if (m) { mime = m[1]; data = m[2]; }

  var bytes = Utilities.base64Decode(data);
  var ts = date.getTime();
  var fileName = mtJob.replace(/[^\w\-]/g, '_') + '_' + kind + '_' + ts + '.jpg';
  var blob = Utilities.newBlob(bytes, mime, fileName);

  var folder = getMonthFolder(date);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w800';
}

function getMonthFolder(date) {
  var root = getRootPhotoFolder();
  var monthName = date.getFullYear() + '-' + pad2(date.getMonth() + 1);
  var it = root.getFoldersByName(monthName);
  return it.hasNext() ? it.next() : root.createFolder(monthName);
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

  // Hook point: wire up email / LINE notification here in the future.
  Logger.log('dailyScan: overduePM=' + overduePM.length + ', staleBM=' + staleBM.length);
  return { overduePM: overduePM.length, staleBM: staleBM.length };
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
