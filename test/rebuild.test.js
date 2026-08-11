// rebuildRepairSheet() rewrites the owner's production repair history, so
// drive it against a sheet shaped like the real one: Google Form columns on
// the left (a column per issue type, Thai date/time headers), the app's own
// flat columns bolted onto the right, and each row filling in only one side.
const stubs = require('./stubs');
stubs.install();
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');

global.Session = { getScriptTimeZone: () => 'Asia/Bangkok' };
global.Utilities.formatDate = () => '2026-08-11';

const D = (s) => new Date(s + 'T00:00:00Z');

// Left half = the Form's own columns. Right half = what getOrCreateColumns
// appended once the app started closing jobs.
const LEGACY_HEADERS = [
  'ประทับเวลา', 'Date (Cal)', 'Time-เวลา', 'วันที่ Cal', 'MT Job No.', 'Shift',
  'Main Issue (ประเภทปัญหา)', 'Machanical(กลไก)', 'Electrical(ไฟฟ้า)', 'Software', 'Camera&Vision',
  'Time (minute)', 'Production line', 'ผู้ซ่อม', 'หมายเหตุเพิ่มเติม',
  // appended by the app, far right:
  'Date', 'Area', 'Station', 'Main_Issue', 'Issue', 'Detail', 'Improvements',
  'Spare_Parts', 'By', 'Time_Min', 'Photo_After_URL'
];
const blanks = (n) => new Array(n).fill('');

// A form-era row: everything on the left, right half empty.
const formRow = [
  D('2025-08-16'), D('2025-08-16'), '8:30:00', D('2025-08-16'), '16082025-15', 'A',
  'Machanical', 'Bolt/Nuts', '', '', '',
  45, 'Line 4', 'ช่างสมชาย', 'ขันใหม่ทั้งชุด',
  ...blanks(11)
];
// An app-era row: MT Job No. + Shift happen to share the Form's column names,
// so those two sit on the left while everything else jumps to the right.
const appRow = [
  '', '', '', '', '06082026-3', 'B',
  '', '', '', '', '',
  '', '', '', '',
  D('2026-08-06'), 'Assembly M/C', 'Arc chute 06', 'Electrical', 'Sensor',
  'เซนเซอร์ไม่จับชิ้นงาน', 'เปลี่ยนเซนเซอร์ใหม่', 'PR-200', 'ช่างสมหมาย', 20,
  'https://drive.google.com/thumbnail?id=abc'
];
// Junk the reader must drop (no valid MT Job No.).
const junkRow = ['', '', '', '', 'รวม', '', '', '', '', '', '', 900, '', '', '', ...blanks(11)];

let SHEETS = {};
function makeSheet(rows) {
  const data = rows.map(r => r.slice());
  const sheet = {
    name: null, rows: data, frozen: 0,
    getLastRow: () => data.length,
    getLastColumn: () => Math.max(1, ...data.map(r => r.length)),
    setName: function (n) { delete SHEETS[this.name]; this.name = n; SHEETS[n] = this; },
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
      }
    })
  };
  return sheet;
}
function addSheet(name, rows) { const s = makeSheet(rows); s.name = name; SHEETS[name] = s; return s; }

const ss = {
  insertSheet: (name) => addSheet(name, [])
};
global.getSS = () => ss;
global.getSheet = (n) => SHEETS[n] || null;
global.getSheetOrThrow = (n) => { const s = SHEETS[n]; if (!s) throw new Error('no sheet ' + n); return s; };
global.ensureSheets = () => {};

addSheet('Record ซ่อม', [LEGACY_HEADERS, formRow, appRow, junkRow]);
addSheet('CONFIG', [
  ['Type', 'Value', 'Parent', 'Active'],
  ['Area', 'ENC H9', '', true],
  ['Area', 'Assembly M/C', 'ASSY', true]
]);

eval(src
  .replace(/^function getSS\(/m, 'function __x0(')
  .replace(/^function getSheet\(/m, 'function __x1(')
  .replace(/^function getSheetOrThrow\(/m, 'function __x2(')
  .replace(/^function ensureSheets\(/m, 'function __x3('));

let fails = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; console.log('FAIL ' + label + '\n       got  ' + JSON.stringify(actual) + '\n       want ' + JSON.stringify(expected)); }
  else console.log('ok   ' + label);
}

// --- reading the messy sheet ---------------------------------------------
const read = readRepairRowsFromSheet('Record ซ่อม');
eq(read.length, 2, 'junk row without a real MT Job No. is dropped');

const form = read[0], app = read[1];
eq(form.mtJob, '16082025-15', 'form row: MT Job No.');
eq(form.specificIssue, 'Bolt/Nuts', 'form row: per-type column folds into one Issue');
eq(form.mainIssue, 'Machanical', 'form row: main issue');
eq(form.timeMin, 45, 'form row: "Time (minute)" read as Time_Min');
eq(form.line, 'Line 4', 'form row: production line');
eq(form.shift, 'A', 'form row: shift');
eq(form.by, 'ช่างสมชาย', 'form row: ผู้ซ่อม read as By');

eq(app.mtJob, '06082026-3', 'app row: MT Job No.');
eq(app.specificIssue, 'Sensor', 'app row: Issue');
eq(app.detail, 'เซนเซอร์ไม่จับชิ้นงาน', 'app row: Detail');
eq(app.improvements, 'เปลี่ยนเซนเซอร์ใหม่', 'app row: Improvements');
eq(app.spareParts, 'PR-200', 'app row: Spare_Parts');
eq(app.station, 'Arc chute 06', 'app row: Station');
eq(app.area, 'Assembly M/C', 'app row: Area');
eq(app.photoAfterUrl, 'https://drive.google.com/thumbnail?id=abc', 'app row: photo URL');

// --- the rebuild ----------------------------------------------------------
const before = SHEETS['Record ซ่อม'].rows.length;
const res = rebuildRepairSheet();

eq(res.migrated, 2, 'both real rows migrated');
eq(res.backupSheet, 'Record ซ่อม (เดิม 2026-08-11)', 'original renamed aside, dated');
eq(!!SHEETS[res.backupSheet], true, 'backup sheet still exists');
eq(SHEETS[res.backupSheet].rows.length, before, 'backup keeps every original row untouched');
eq(SHEETS[res.backupSheet].rows[0], LEGACY_HEADERS, 'backup keeps the original headers');

const fresh = SHEETS['Record ซ่อม'];
eq(fresh.rows[0], REP_FIELDS, 'new sheet uses exactly REP_FIELDS as its header');
eq(fresh.rows.length, 3, 'header + two rows');
eq(fresh.frozen, 1, 'header row frozen');

// Both eras now sit in the same columns.
const col = (name) => REP_FIELDS.indexOf(name);
eq(fresh.rows[1][col('MT Job No.')], '16082025-15', 'form-era row keeps its job number');
eq(fresh.rows[1][col('Issue')], 'Bolt/Nuts', 'form-era per-type value lands in Issue');
eq(fresh.rows[1][col('Time_Min')], 45, 'form-era minutes land in Time_Min');
eq(fresh.rows[1][col('Area')], 'ENC H9', 'form-era row gets the default area, not a blank');
eq(fresh.rows[1][col('By')], 'ช่างสมชาย', 'form-era technician preserved');

eq(fresh.rows[2][col('MT Job No.')], '06082026-3', 'app-era row keeps its job number');
eq(fresh.rows[2][col('Issue')], 'Sensor', 'app-era Issue in the same column as the form-era one');
eq(fresh.rows[2][col('Area')], 'Assembly M/C', 'app-era area preserved as written');
eq(fresh.rows[2][col('Improvements')], 'เปลี่ยนเซนเซอร์ใหม่', 'app-era fix text preserved');

// Nothing is silently dropped. REP_FIELDS has no home for the Form's
// time-of-day column or its free-text note, so both are reported rather than
// vanishing quietly — and both still sit in the backup sheet. (The time of a
// repair is recoverable anyway: Record แจ้งซ่อม timestamps the same job.)
eq(res.unmappedColumns, ['Time-เวลา', 'หมายเหตุเพิ่มเติม'], 'columns with data but no REP_FIELDS home are reported');
eq(SHEETS[res.backupSheet].rows[1][2], '8:30:00', 'the unmapped time-of-day survives in the backup');
eq(SHEETS[res.backupSheet].rows[1][14], 'ขันใหม่ทั้งชุด', 'so does the unmapped note');

// Re-reading through the normal path now sees one consistent shape.
const after = readRepairRowsFromSheet('Record ซ่อม');
eq(after.length, 2, 'rebuilt sheet reads back cleanly');
eq(after.map(r => r.mtJob), ['16082025-15', '06082026-3'], 'in the same order');
eq(after[0].timeMin, 45, 'and with the same numbers');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
