// migrateH9ToOwnSheets() copies the owner's live production records between
// sheets, so drive it against a spreadsheet shaped like the real one: a
// request sheet holding both pre-app rows (A–J only) and app rows, and a
// Google Form repair sheet with a column per issue type on the left and the
// app's own columns bolted onto the right.
const stubs = require('./stubs');
stubs.install();
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');

global.Session = { getScriptTimeZone: () => 'Asia/Bangkok' };
global.Utilities.formatDate = () => '2026-08-11';

const D = (s) => new Date(s + 'T00:00:00Z');
const blanks = (n) => new Array(n).fill('');

// --- the two original sheets ---------------------------------------------
const REQ_HEADERS = [
  'ประทับเวลา', 'Date', 'Shift', 'Production line', 'M/C No.', 'Job order No.',
  'No.', 'MT job No.', '1%', 'Progress %', 'Symptom', 'Priority', 'Reporter',
  'Photo_Before_URL', 'Status', 'Accept_DateTime', 'Finish_DateTime',
  'Downtime_Min', 'Machine_Stop', 'Area'
];
// Pre-app row: A–J only, no Status. Must stay behind.
const preAppReq = [D('2025-08-16'), D('2025-08-16'), 'A', 'Line 4', 'Station 10',
  'JO-1', 1, '16082025-15', '', 100, ...blanks(10)];
// App rows: Status always present.
const appReqClosed = [D('2026-08-06'), D('2026-08-06'), 'B', 'Line 4', 'Station 10',
  '', '', '06082026-1', '', 100, 'โซ่ตก', 'ปกติ', 'ช่างสมชาย', '', 'ปิดงาน',
  D('2026-08-06'), D('2026-08-06'), 30, false, ''];
const appReqOpen = [D('2026-08-07'), D('2026-08-07'), 'A', 'Line 5', 'Station 3',
  '', '', '07082026-1', '', 0, 'ไฟไม่ติด', 'ด่วน', 'หัวหน้ากะ', '', 'แจ้งซ่อม',
  '', '', '', true, 'ENC H9'];

const REP_HEADERS = [
  'ประทับเวลา', 'Date (Cal)', 'Time-เวลา', 'MT Job No.', 'Shift',
  'Main Issue (ประเภทปัญหา)', 'Machanical(กลไก)', 'Electrical(ไฟฟ้า)',
  'Time (minute)', 'Production line', 'ผู้ซ่อม',
  'Date', 'Area', 'Station', 'Main_Issue', 'Issue', 'Detail', 'Improvements',
  'Spare_Parts', 'By', 'Time_Min', 'Photo_After_URL'
];
// Form-era repair for the pre-app job — stays behind with its request.
const formRep = [D('2025-08-16'), D('2025-08-16'), '8:30:00', '16082025-15', 'A',
  'Machanical', 'Bolt/Nuts', '', 45, 'Line 4', 'ช่างสมชาย', ...blanks(11)];
// App-era repair for the closed app job — follows its request across.
const appRep = ['', '', '', '06082026-1', 'B', '', '', '', '', '', '',
  D('2026-08-06'), 'ENC H9', 'Station 10', 'Mechanical', 'Chain',
  'โซ่หย่อน', 'ตั้งความตึงใหม่', '-', 'ช่างสมชาย', 30, 'https://drive/x'];

let SHEETS = {};
function makeSheet(rows) {
  const data = rows.map(r => r.slice());
  return {
    name: null, rows: data, frozen: 0, maxCols: 30,
    getName: function () { return this.name; },
    getDataRange: () => ({ getValues: () => data.map(r => r.slice()) }),
    deleteRow: (n) => { data.splice(n - 1, 1); },
    setName: function (n) { delete SHEETS[this.name]; this.name = n; SHEETS[n] = this; },
    getLastRow: () => data.length,
    getLastColumn: () => Math.max(1, ...data.map(r => r.length)),
    getMaxColumns: function () { return this.maxCols; },
    insertColumnsAfter: function (after, n) { this.maxCols += n; },
    setFrozenRows: function (n) { this.frozen = n; },
    autoResizeColumns: () => {},
    getRange: (r, c, nr, nc) => ({
      getValue: () => (data[r - 1] || [])[c - 1],
      setValue: (v) => { while (data.length < r) data.push([]); data[r - 1][c - 1] = v; },
      setValues: (vals) => {
        vals.forEach((row, i) => {
          while (data.length < r + i) data.push([]);
          row.forEach((v, j) => { data[r - 1 + i][c - 1 + j] = v; });
        });
      },
      getValues: () => {
        const out = [];
        for (let i = 0; i < (nr || 1); i++) {
          const row = data[r - 1 + i] || [];
          const slice = [];
          for (let j = 0; j < (nc || 1); j++) slice.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]);
          out.push(slice);
        }
        return out;
      },
      setNumberFormat: () => {}
    })
  };
}
function addSheet(name, rows) { const s = makeSheet(rows); s.name = name; SHEETS[name] = s; return s; }

const ss = {
  insertSheet: (name) => addSheet(name, []),
  deleteSheet: (s) => { delete SHEETS[s.name]; },
  getSheets: () => Object.keys(SHEETS).map(k => SHEETS[k])
};
global.getSS = () => ss;
global.getSheet = (n) => SHEETS[n] || null;
global.getSheetOrThrow = (n) => { const s = SHEETS[n]; if (!s) throw new Error('no sheet ' + n); return s; };

function reset() {
  SHEETS = {};
  addSheet('Record แจ้งซ่อม ', [REQ_HEADERS, preAppReq, appReqClosed, appReqOpen]);
  addSheet('Record ซ่อม', [REP_HEADERS, formRep, appRep]);
  addSheet('CONFIG', [
    ['Type', 'Value', 'Parent', 'Active'],
    ['Area', 'ENC H9', '', true],
    ['Area', 'Assembly M/C', 'ASSY', true],
    ['Line', 'Line 4', 'ENC H9', true],
    ['Line', 'Line 5', 'ENC H9', true]
  ]);
  addSheet('USERS', [['Emp_ID', 'Name', 'Role', 'Line', 'PIN', 'Shift']]);
  _areaBookCache = null; _lineAreaCache = null;
  stubs.state.properties = {};
}

eval(src
  .replace(/^function getSS\(/m, 'function __x0(')
  .replace(/^function getSheet\(/m, 'function __x1(')
  .replace(/^function getSheetOrThrow\(/m, 'function __x2('));

let fails = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; console.log('FAIL ' + label + '\n       got  ' + JSON.stringify(actual) + '\n       want ' + JSON.stringify(expected)); }
  else console.log('ok   ' + label);
}
const jobsIn = (name) => (SHEETS[name] ? SHEETS[name].rows.slice(1).map(r => r[BM.MT_JOB - 1]) : []);
const repairJobsIn = (name) => (SHEETS[name] ? SHEETS[name].rows.slice(1).map(r => r[0]) : []);

// --- the migration --------------------------------------------------------
reset();
const res = migrateH9ToOwnSheets();

eq(res.requestsCopied, 2, 'both app requests copied');
eq(res.repairsCopied, 1, 'only the repair whose request moved is copied');
eq(res.appJobsFound, 2, 'pre-app request not counted as the app\'s');

eq(jobsIn('Record แจ้งซ่อม H9'), ['06082026-1', '07082026-1'], 'new request sheet holds exactly the app jobs');
eq(repairJobsIn('Record ซ่อม H9'), ['06082026-1'], 'new repair sheet holds the matching repair');
eq(SHEETS['Record แจ้งซ่อม H9'].rows[0], BM_REQUEST_HEADERS, 'new request sheet uses the app layout');
eq(SHEETS['Record ซ่อม H9'].rows[0], REP_FIELDS, 'new repair sheet uses REP_FIELDS');

// The originals must come through completely untouched.
eq(jobsIn('Record แจ้งซ่อม '), ['16082025-15', '06082026-1', '07082026-1'], 'archive request sheet unchanged');
eq(SHEETS['Record ซ่อม'].rows.length, 3, 'archive repair sheet unchanged');
eq(SHEETS['Record ซ่อม'].rows[0], REP_HEADERS, 'archive keeps its Form headers');

// Field-level check on a migrated row.
const c = (n) => REP_FIELDS.indexOf(n);
const movedRep = SHEETS['Record ซ่อม H9'].rows[1];
eq(movedRep[c('Issue')], 'Chain', 'repair Issue carried over');
eq(movedRep[c('Improvements')], 'ตั้งความตึงใหม่', 'repair fix text carried over');
eq(movedRep[c('Time_Min')], 30, 'repair minutes carried over');
eq(movedRep[c('Area')], 'ENC H9', 'repair area carried over');

const movedOpen = SHEETS['Record แจ้งซ่อม H9'].rows[2];
eq(movedOpen[BM.STATUS - 1], 'แจ้งซ่อม', 'an open job keeps its status');
eq(movedOpen[BM.SYMPTOM - 1], 'ไฟไม่ติด', 'and its symptom');
eq(movedOpen[BM.AREA - 1], 'ENC H9', 'blank Area is filled with the default');

// --- no double counting ---------------------------------------------------
// Every job now exists in two sheets; readers must still see each one once.
const jobs = apiGetBMJobs({});
eq(jobs.map(j => j.mtJob).sort(), ['06082026-1', '07082026-1', '16082025-15'],
  'each job read exactly once across live sheet and archive');
eq(jobs.filter(j => j.mtJob === '06082026-1').length, 1, 'the migrated job is not duplicated');
eq(jobs.find(j => j.mtJob === '06082026-1').sheet, 'Record แจ้งซ่อม H9', 'and is read from the live sheet');
eq(jobs.find(j => j.mtJob === '16082025-15').sheet, 'Record แจ้งซ่อม ', 'while the pre-app job still comes from the archive');

const repairs = readRepairRowsFull();
eq(repairs.map(r => r.mtJob).sort(), ['06082026-1', '16082025-15'], 'repairs deduped the same way');

// --- running it twice -----------------------------------------------------
const again = migrateH9ToOwnSheets();
eq(again.requestsCopied, 0, 'second run copies no requests');
eq(again.repairsCopied, 0, 'second run copies no repairs');
eq(jobsIn('Record แจ้งซ่อม H9').length, 2, 'and adds no duplicate rows');

// --- resuming after an interrupted repair rebuild -------------------------
// The earlier rebuild attempt left the real data under a dated backup name
// and an empty sheet under the live one. The migration has to put that right
// before it can read anything.
reset();
SHEETS['Record ซ่อม'].setName('Record ซ่อม (เดิม 2026-08-11)');
addSheet('Record ซ่อม', []);

const restored = migrateH9ToOwnSheets();
eq(restored.notes.length, 1, 'restore was reported');
eq(!!SHEETS['Record ซ่อม'], true, 'archive repair sheet exists again');
eq(SHEETS['Record ซ่อม'].rows.length, 3, 'with its rows back');
eq(!!SHEETS['Record ซ่อม (เดิม 2026-08-11)'], false, 'and the backup name is gone');
eq(restored.repairsCopied, 1, 'migration then proceeds normally');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
