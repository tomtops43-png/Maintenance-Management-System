// PM_RECORDS is the audit trail an outside auditor reads, so the two things
// that make it trustworthy are pinned here: it's addressed by header name
// (columns have moved once already), and a signed-off record keeps saying
// what it said even after its plan is renamed or moved.
const stubs = require('./stubs');
stubs.install();
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');

let SHEETS = {};

function makeSheet(rows) {
  const data = rows.map(r => r.slice());
  return {
    rows: data,
    getLastRow: () => data.length,
    getLastColumn: () => Math.max(1, ...data.map(r => r.length)),
    setFrozenRows: () => {},
    appendRow: (r) => { data.push(r.slice()); },
    getRange: (r, c, nr, nc) => ({
      getValue: () => (data[r - 1] || [])[c - 1],
      setValue: (v) => { while (data.length < r) data.push([]); data[r - 1][c - 1] = v; },
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
      setValues: () => {},
      setNumberFormat: () => {}
    })
  };
}

global.getSheet = (name) => SHEETS[name] || null;
global.getSheetOrThrow = (name) => { if (!SHEETS[name]) throw new Error('no sheet ' + name); return SHEETS[name]; };
global.ensureSheets = () => {};

eval(src
  .replace(/^function getSheet\(/m, 'function __x1(')
  .replace(/^function getSheetOrThrow\(/m, 'function __x2(')
  .replace(/^function ensureSheets\(/m, 'function __x3(')
  .replace(/^function areaForLine\(/m, 'function __unusedAreaForLine(')
  .replace(/^function apiGetBMJobs\(/m, 'function __unusedGetBMJobs(')
  .replace(/^function readRepairRowsFull\(/m, 'function __unusedReadRepairs('));

// CONFIG lives in a sheet this test doesn't build, and the machine page never
// needs more than "which area owns this line".
global.areaForLine = (line) => (line === 'Arc chute' ? 'Assembly M/C' : 'ENC H9');
global.apiGetBMJobs = () => [];
global.readRepairRowsFull = () => [];
areaForLine = global.areaForLine;
apiGetBMJobs = global.apiGetBMJobs;
readRepairRowsFull = global.readRepairRowsFull;

let fails = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; console.log('FAIL ' + label + '\n       got  ' + JSON.stringify(actual) + '\n       want ' + JSON.stringify(expected)); }
  else console.log('ok   ' + label);
}

const d = (s) => new Date(s + 'T03:00:00Z');

// Record_ID and PM_ID deliberately swapped, and a stray column appended by
// hand — nothing may be read by position.
const REC_HEAD = [
  'PM_ID', 'Record_ID', 'Done_DateTime', 'Technician', 'Result',
  'NG_Detail', 'Action_Taken', 'Photo_URL', 'Status',
  'Line', 'MC_Station', 'PM_Item', 'Standard', 'Frequency', 'หมายเหตุของหัวหน้า'
];

SHEETS.PM_RECORDS = makeSheet([
  REC_HEAD,
  // Written before the snapshot columns existed: only PM_ID to go on.
  ['PM-001', 'PM20260601-1', d('2026-06-01'), 'ช่างสมชาย', 'OK', '', '', '', 'OnTime',
   '', '', '', '', '', ''],
  // Written after: carries its own copy of the plan.
  ['PM-001', 'PM20260701-1', d('2026-07-01'), 'ช่างสมชาย', 'OK', '', '', '', 'OnTime',
   'Line 4', 'Station 10', 'ทำ 5ส ตู้คอนโทรลไฟฟ้า', 'ทำความสะอาดตู้', 'Monthly', ''],
  ['PM-002', 'PM20260801-1', d('2026-08-01'), 'ช่างสมหมาย', 'NG', 'ลมรั่วที่ข้อต่อ', 'เปลี่ยนข้อต่อ',
   'http://drive/x.jpg', 'Overdue', 'Line 4', 'Station 10', 'ตรวจสอบระบบลม (Pneumatic)', 'ความดันลมปกติ', 'Monthly', ''],
  ['PM-003', 'PM20260801-2', d('2026-08-01'), 'ช่างสมหมาย', 'OK', '', '', '', 'OnTime',
   'Line 4', 'Station 11', 'อัดจารบี', 'เดือนละครั้ง', 'Monthly', '']
]);

// The plan behind the first two records has since been renamed AND moved.
SHEETS.PM_MASTER = makeSheet([
  ['PM_ID', 'Line', 'MC_Station', 'PM_Item', 'Standard', 'Frequency',
   'Last_Done', 'Next_Due', 'Assigned_To', 'Active', 'Notes', 'Photo_URL'],
  ['PM-001', 'Line 1', 'Station 99', 'ชื่อใหม่หลังย้ายเครื่อง', 'เกณฑ์ใหม่', 'Weekly',
   d('2026-07-01'), d('2026-08-01'), '', true, '', '']
]);

const recs = readPMRecords();
eq(recs.length, 4, 'every signed-off record is read');
eq(recs[0].recordId, 'PM20260601-1', 'Record_ID found by header, not by position');
eq(recs[0].pmId, 'PM-001', 'PM_ID likewise, though the two are swapped in the sheet');

// The whole point of the snapshot: renaming or moving a plan must not
// retroactively change what an already-signed record says.
eq(recs[1].pmItem, 'ทำ 5ส ตู้คอนโทรลไฟฟ้า', 'a snapshot record keeps the name it was signed under');
eq(recs[1].mcStation, 'Station 10', 'and the machine it was actually done on');
eq(recs[1].frequency, 'Monthly', 'and the frequency in force at the time');

// Older records have no snapshot, so the current plan is the best available
// answer — better than showing an auditor a blank row.
eq(recs[0].pmItem, 'ชื่อใหม่หลังย้ายเครื่อง', 'a pre-snapshot record falls back to the plan');
eq(recs[0].mcStation, 'Station 99', 'fallback fills the machine too');

eq(recs[2].result, 'NG', 'NG result carried through');
eq(recs[2].ngDetail, 'ลมรั่วที่ข้อต่อ', 'what was wrong');
eq(recs[2].actionTaken, 'เปลี่ยนข้อต่อ', 'and what was done about it — the corrective action');
eq(recs[2].photoUrl, 'http://drive/x.jpg', 'evidence photo');

// --- filtering -------------------------------------------------------------
const st10 = apiGetPMRecords({ mc: 'Station 10', line: 'Line 4' });
eq(st10.length, 2, 'filters to one machine on one line');
eq(st10[0].recordId, 'PM20260801-1', 'newest first');
eq(st10[1].recordId, 'PM20260701-1', 'then older');

eq(apiGetPMRecords({ mc: 'Station 11' }).length, 1, 'a different station is its own record');
eq(apiGetPMRecords({ pmId: 'PM-001' }).length, 2, 'by plan');
eq(apiGetPMRecords({ result: 'NG' }).length, 1, 'by result — the list an auditor asks for first');
eq(apiGetPMRecords({ from: '2026-07-01', to: '2026-07-31' }).length, 1, 'by date range');
eq(apiGetPMRecords({ from: '2026-08-01', to: '2026-08-01' }).length, 2, 'range ends are inclusive');
eq(apiGetPMRecords({}).length, 4, 'no filter returns everything');
// The pre-snapshot record's fallback says Station 99 / Line 1 — filtering has
// to follow what the record reports, not the PM_ID it came from.
eq(apiGetPMRecords({ mc: 'Station 99' }).length, 1, 'fallback details are what the filter sees');

// --- writing ---------------------------------------------------------------
const row = pmRecordRow(SHEETS.PM_RECORDS, {
  'Record_ID': 'PM20260901-1', 'PM_ID': 'PM-002', 'Result': 'OK', 'Frequency': 'Monthly'
});
eq(row[0], 'PM-002', 'a written row follows the sheet\'s own column order');
eq(row[1], 'PM20260901-1', 'even swapped, each value lands under its header');
eq(row[13], 'Monthly', 'snapshot columns are written too');
eq(row[14], '', 'a column this code knows nothing about is left alone');
eq(row.length, 15, 'the row spans the full sheet width');

// --- rollups ---------------------------------------------------------------
eq(computePMCompliance({ from: d('2026-01-01'), to: d('2026-12-31') }), 75,
   'compliance is on-time sign-offs over all of them');
eq(computePMCompliance({ from: d('2026-07-01'), to: d('2026-07-31') }), 100,
   'and respects the date window');

const h = apiGetMachineHistory({ area: 'ENC H9', line: 'Line 4', mc: 'Station 10' });
eq(h.stats.pmCount, 2, 'machine history counts this machine\'s PM');
eq(h.stats.pmNg, 1, 'and how many came back NG');
eq(h.stats.pmCompliance, 50, 'and how much of it was done on time');
eq(h.stats.lastPM, d('2026-08-01').toISOString(), 'and when it was last serviced');
eq(h.pms.length, 2, 'the records themselves ride along for the timeline');
eq(h.pmTruncated, false, 'not truncated at this size');

// A machine nobody has ever PM'd must read as zero, not as a broken page.
const none = apiGetMachineHistory({ area: 'ENC H9', line: 'Line 4', mc: 'Station 21' });
eq(none.stats.pmCount, 0, 'a machine with no PM history reports none');
eq(none.stats.lastPM, '', 'and no last-serviced date');

// No sheet at all — the state every new deployment starts in.
SHEETS.PM_RECORDS = null;
delete SHEETS.PM_RECORDS;
eq(readPMRecords(), [], 'a missing sheet is empty history, not an error');
eq(computePMCompliance({ from: d('2026-01-01'), to: d('2026-12-31') }), 0, 'and compliance is 0');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
