// Bulk sign-off exists for backfilling paper, which means back-dated entries
// arriving out of order. Two things have to hold or the schedule quietly
// rots: the date on the paper is the date recorded, and Last_Done never
// walks backwards.
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
      setValues: (vals) => {
        vals.forEach((row, i) => {
          while (data.length < r + i) data.push([]);
          row.forEach((v, j) => { data[r - 1 + i][c - 1 + j] = v; });
        });
      },
      setNumberFormat: () => {}
    })
  };
}

global.getSheet = (name) => SHEETS[name] || null;
global.getSheetOrThrow = (name) => { if (!SHEETS[name]) throw new Error('no sheet ' + name); return SHEETS[name]; };
global.ensureSheets = () => {};
global.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };

eval(src
  .replace(/^function getSheet\(/m, 'function __x1(')
  .replace(/^function getSheetOrThrow\(/m, 'function __x2(')
  .replace(/^function ensureSheets\(/m, 'function __x3('));

let fails = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; console.log('FAIL ' + label + '\n       got  ' + JSON.stringify(actual) + '\n       want ' + JSON.stringify(expected)); }
  else console.log('ok   ' + label);
}

const REC_HEAD = [
  'Record_ID', 'PM_ID', 'Done_DateTime', 'Technician', 'Result',
  'NG_Detail', 'Action_Taken', 'Photo_URL', 'Status',
  'Line', 'MC_Station', 'PM_Item', 'Standard', 'Frequency'
];
const COL = {};
REC_HEAD.forEach((h, i) => { COL[h] = i; });

function reset() {
  SHEETS.PM_MASTER = makeSheet([
    ['PM_ID', 'Line', 'MC_Station', 'PM_Item', 'Standard', 'Frequency',
     'Last_Done', 'Next_Due', 'Assigned_To', 'Active', 'Notes', 'Photo_URL'],
    ['PM-001', 'Line 5', 'Station 5', 'ทำ 5ส ตู้คอนโทรลไฟฟ้า', 'สะอาด', 'Monthly',
     new Date(2026, 7, 1), new Date(2026, 8, 1), '', true, '', ''],
    ['PM-002', 'Line 5', 'Station 5', 'ตรวจสอบระบบลม', 'ความดันปกติ', 'Monthly',
     new Date(2026, 7, 1), new Date(2026, 8, 1), '', true, '', ''],
    ['PM-003', 'Line 4', 'Station 10', 'อัดจารบีเซอร์โว', 'เดือนละครั้ง', 'Monthly',
     new Date(2026, 7, 1), new Date(2026, 8, 1), '', true, '', '']
  ]);
  SHEETS.PM_RECORDS = makeSheet([REC_HEAD.slice()]);
}

function recRows() { return SHEETS.PM_RECORDS.rows.slice(1); }
function masterRow(i) { return SHEETS.PM_MASTER.rows[i]; }

// --- a normal backfill -----------------------------------------------------
reset();
const res = apiSubmitPMBulk({
  doneDate: '2026-08-28',
  technician: 'ช่างสมชาย',
  items: [
    { pmId: 'PM-001', result: 'OK', actionTaken: 'ทำความสะอาดตู้คอนโทรล' },
    { pmId: 'PM-002', result: 'NG', ngDetail: 'ลมรั่วที่ข้อต่อ', actionTaken: 'เปลี่ยนข้อต่อ' },
    { pmId: 'PM-003', result: 'OK', actionTaken: 'อัดจารบีตามรอบ', technician: 'ช่างสมหมาย' }
  ]
}, { name: 'Admin' });

eq(res.saved, 3, 'all three signed off in one call');
eq(res.failed, [], 'nothing rejected');
eq(recRows().length, 3, 'three record rows written');

const r0 = recRows()[0];
eq(r0[COL.Record_ID], 'PM20260828-1', 'record id is minted for the date on the paper');
eq(recRows()[2][COL.Record_ID], 'PM20260828-3', 'and sequences within the batch');
eq(r0[COL.Done_DateTime].getTime(), new Date(2026, 7, 28).getTime(),
   'Done_DateTime is the paper date, not today');
eq(r0[COL.Technician], 'ช่างสมชาย', 'the shared technician applies to the batch');
eq(recRows()[2][COL.Technician], 'ช่างสมหมาย', 'and a row can name its own');
eq(r0[COL.Status], 'OnTime', 'done before the due date is on time');
eq(r0[COL.Line], 'Line 5', 'the plan snapshot rides along, same as a single sign-off');
eq(r0[COL.PM_Item], 'ทำ 5ส ตู้คอนโทรลไฟฟ้า', 'including the item name');
eq(recRows()[1][COL.Result], 'NG', 'an NG in the batch stays NG');
eq(recRows()[1][COL.NG_Detail], 'ลมรั่วที่ข้อต่อ', 'with what was found');

eq(masterRow(1)[6].getTime(), new Date(2026, 7, 28).getTime(), 'Last_Done moves to the paper date');
eq(masterRow(1)[7].getTime(), new Date(2026, 8, 28).getTime(), 'and Next_Due is computed from it');

// --- late work -------------------------------------------------------------
reset();
SHEETS.PM_MASTER.rows[1][7] = new Date(2026, 6, 1);   // was due 1 July
apiSubmitPMBulk({ doneDate: '2026-08-28', items: [{ pmId: 'PM-001', result: 'OK' }] }, { name: 'Admin' });
eq(recRows()[0][COL.Status], 'Overdue', 'signed off after the due date is late');

// --- paper arriving out of order ------------------------------------------
reset();
apiSubmitPMBulk({ doneDate: '2026-08-28', items: [{ pmId: 'PM-001', result: 'OK' }] }, { name: 'Admin' });
apiSubmitPMBulk({ doneDate: '2026-08-05', items: [{ pmId: 'PM-001', result: 'OK' }] }, { name: 'Admin' });
eq(recRows().length, 2, 'both sheets are recorded');
eq(masterRow(1)[6].getTime(), new Date(2026, 7, 28).getTime(),
   'an older sheet entered later does not drag Last_Done backwards');
eq(masterRow(1)[7].getTime(), new Date(2026, 8, 28).getTime(),
   'so the plan does not re-open on a schedule it has already passed');

// --- ids continue from what is already there ------------------------------
reset();
apiSubmitPMBulk({ doneDate: '2026-08-28', items: [{ pmId: 'PM-001', result: 'OK' }] }, { name: 'Admin' });
apiSubmitPMBulk({ doneDate: '2026-08-28', items: [{ pmId: 'PM-002', result: 'OK' }] }, { name: 'Admin' });
eq(recRows().map(r => r[COL.Record_ID]), ['PM20260828-1', 'PM20260828-2'],
   'a second batch on the same day keeps counting, it does not collide');

// --- refusals --------------------------------------------------------------
reset();
const mixed = apiSubmitPMBulk({
  doneDate: '2026-08-28',
  items: [{ pmId: 'PM-001', result: 'OK' }, { pmId: 'PM-999', result: 'OK' }]
}, { name: 'Admin' });
eq(mixed.saved, 1, 'a plan that does not exist is skipped');
eq(mixed.failed, [{ pmId: 'PM-999', error: 'ไม่พบแผน PM นี้' }], 'and reported back by name');
eq(recRows().length, 1, 'the good row still lands');

function throws(fn, re, label) {
  let msg = '';
  try { fn(); } catch (e) { msg = e.message; }
  eq(re.test(msg), true, label);
}
reset();
throws(() => apiSubmitPMBulk({ doneDate: '2026-08-28', items: [] }, {}), /ไม่มีรายการ/,
  'an empty batch is refused');
throws(() => apiSubmitPMBulk({ doneDate: '2099-01-01', items: [{ pmId: 'PM-001' }] }, {}),
  /อนาคต/, 'a future date is refused — paper cannot record work not yet done');
eq(recRows().length, 0, 'and nothing is written when the batch is refused');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
