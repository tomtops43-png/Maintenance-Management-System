// The audit report is arithmetic someone from outside the company will check
// line by line, so the two numbers that carry it are pinned here: how many
// times a plan should have run in a window, and what counts as missed.
const stubs = require('./stubs');
stubs.install();
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');

let SHEETS = {};

function makeSheet(rows) {
  const data = rows.map(r => r.slice());
  return {
    getLastRow: () => data.length,
    getLastColumn: () => Math.max(1, ...data.map(r => r.length)),
    setFrozenRows: () => {},
    appendRow: (r) => { data.push(r.slice()); },
    getRange: (r, c, nr, nc) => ({
      getValue: () => (data[r - 1] || [])[c - 1],
      setValue: () => {},
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

global.areaForLine = () => 'ENC H9';
global.readRepairRowsFull = () => [];
// One NG on PM-002 was handed off to a BM job; the audit has to find it.
global.apiGetBMJobs = () => ([
  { mtJob: '05032026-1', status: 'ปิดงาน', timestamp: '2026-03-05T04:00:00Z',
    symptom: 'จากผล PM PM-002: ลมรั่วที่ข้อต่อ' },
  { mtJob: '01012026-9', status: 'ปิดงาน', timestamp: '2026-01-01T04:00:00Z',
    symptom: 'จากผล PM PM-002: เคสเก่าก่อนหน้านี้' },
  { mtJob: '07032026-2', status: 'กำลังซ่อม', timestamp: '2026-03-07T04:00:00Z',
    symptom: 'โซ่ตก ไม่เกี่ยวกับ PM' }
]);
areaForLine = global.areaForLine;
apiGetBMJobs = global.apiGetBMJobs;
readRepairRowsFull = global.readRepairRowsFull;

let fails = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; console.log('FAIL ' + label + '\n       got  ' + JSON.stringify(actual) + '\n       want ' + JSON.stringify(expected)); }
  else console.log('ok   ' + label);
}

// --- schedule reconstruction ----------------------------------------------
const from = new Date(2026, 0, 1);            // 1 Jan 2026
const to = new Date(2026, 2, 31, 23, 59, 59); // 31 Mar 2026 — one quarter

// Next_Due sits after the window: the schedule behind it is walked backwards.
eq(pmScheduleInRange(new Date(2026, 3, 15), 'Monthly', from, to).length, 3,
   'a monthly plan is due three times in a quarter');
eq(pmScheduleInRange(new Date(2026, 3, 15), 'Monthly', from, to).map(d => d.getDate()).join(','),
   '15,15,15', 'and lands on the same day each month');
eq(pmScheduleInRange(new Date(2026, 3, 15), 'Weekly', from, to).length, 12,
   'a weekly plan, twelve — the next slot back lands on 31 Dec, outside');
eq(pmScheduleInRange(new Date(2026, 3, 15), 'Quarterly', from, to).length, 1,
   'a quarterly plan, once');
eq(pmScheduleInRange(new Date(2026, 3, 15), 'Yearly', from, to).length, 0,
   'a yearly plan due in April owes nothing to Jan–Mar');

// An overdue plan's Next_Due is already behind us — stepping has to run
// forward from there instead of backwards past it.
eq(pmScheduleInRange(new Date(2025, 11, 20), 'Monthly', from, to).length, 3,
   'a plan already overdue before the window still owes its three');
eq(pmScheduleInRange(new Date('nope'), 'Monthly', from, to), [],
   'an unreadable Next_Due yields no schedule rather than a crash');

// --- the report ------------------------------------------------------------
const d = (iso) => new Date(iso);

SHEETS.PM_MASTER = makeSheet([
  ['PM_ID', 'Line', 'MC_Station', 'PM_Item', 'Standard', 'Frequency',
   'Last_Done', 'Next_Due', 'Assigned_To', 'Active', 'Notes', 'Photo_URL'],
  // Monthly, done every month: 3 expected, 3 done.
  ['PM-001', 'Line 4', 'Station 10', 'ทำ 5ส ตู้คอนโทรล', 'สะอาด', 'Monthly',
   d('2026-03-10T03:00:00Z'), new Date(2026, 3, 10), '', true, '', ''],
  // Monthly, done once: 3 expected, 1 done -> 2 missed. The finding.
  ['PM-002', 'Line 4', 'Station 10', 'ตรวจระบบลม', 'ความดันปกติ', 'Monthly',
   d('2026-03-05T03:00:00Z'), new Date(2026, 3, 5), '', true, '', ''],
  // Retired mid-window: judged on what it did, never charged a miss.
  ['PM-003', 'Line 1', 'Station 3', 'แผนที่ปิดไปแล้ว', '', 'Monthly',
   d('2026-01-20T03:00:00Z'), new Date(2026, 1, 20), '', false, '', ''],
  // Active but nothing due in the window and nothing done: not a row at all.
  ['PM-004', 'Line 5', 'Station 8', 'แผนรายปี', '', 'Yearly',
   '', new Date(2026, 10, 1), '', true, '', '']
]);

SHEETS.PM_RECORDS = makeSheet([
  ['Record_ID', 'PM_ID', 'Done_DateTime', 'Technician', 'Result',
   'NG_Detail', 'Action_Taken', 'Photo_URL', 'Status',
   'Line', 'MC_Station', 'PM_Item', 'Standard', 'Frequency'],
  ['PM20260110-1', 'PM-001', d('2026-01-10T03:00:00Z'), 'ช่างสมชาย', 'OK', '', '', '', 'OnTime',
   'Line 4', 'Station 10', 'ทำ 5ส ตู้คอนโทรล', 'สะอาด', 'Monthly'],
  ['PM20260212-1', 'PM-001', d('2026-02-12T03:00:00Z'), 'ช่างสมชาย', 'OK', '', '', '', 'Overdue',
   'Line 4', 'Station 10', 'ทำ 5ส ตู้คอนโทรล', 'สะอาด', 'Monthly'],
  ['PM20260310-1', 'PM-001', d('2026-03-10T03:00:00Z'), 'ช่างสมชาย', 'OK', '', '', '', 'OnTime',
   'Line 4', 'Station 10', 'ทำ 5ส ตู้คอนโทรล', 'สะอาด', 'Monthly'],
  ['PM20260305-1', 'PM-002', d('2026-03-05T03:00:00Z'), 'ช่างสมหมาย', 'NG', 'ลมรั่วที่ข้อต่อ', 'เปลี่ยนข้อต่อ',
   'http://drive/ng.jpg', 'Overdue', 'Line 4', 'Station 10', 'ตรวจระบบลม', 'ความดันปกติ', 'Monthly'],
  ['PM20260120-1', 'PM-003', d('2026-01-20T03:00:00Z'), 'ช่างสมชาย', 'OK', '', '', '', 'OnTime',
   'Line 1', 'Station 3', 'แผนที่ปิดไปแล้ว', '', 'Monthly'],
  // Outside the window entirely — must not reach the report.
  ['PM20251210-1', 'PM-001', d('2025-12-10T03:00:00Z'), 'ช่างสมชาย', 'OK', '', '', '', 'OnTime',
   'Line 4', 'Station 10', 'ทำ 5ส ตู้คอนโทรล', 'สะอาด', 'Monthly']
]);

const rep = apiGetPMAudit({ from: '2026-01-01', to: '2026-03-31' });

eq(rep.summary.plans, 3, 'a plan with nothing due and nothing done is left out');
eq(rep.summary.expected, 7, 'expected = 3 + 3 + the retired plan judged on its 1');
eq(rep.summary.done, 5, 'sign-offs inside the window only');
eq(rep.summary.onTime, 3, 'on-time sign-offs');
eq(rep.summary.late, 2, 'the rest were signed off late');
eq(rep.summary.missed, 2, 'the two months PM-002 was never done');
eq(rep.summary.ng, 1, 'one NG finding');
eq(rep.summary.compliance, 71.43, 'compliance is done over expected, not over done');
eq(rep.summary.onTimeRate, 60, 'and the on-time rate is a separate number');

const byId = {};
rep.plans.forEach(p => { byId[p.pmId] = p; });
eq(rep.plans[0].pmId, 'PM-002', 'the plan with findings sorts to the top');
eq([byId['PM-002'].expected, byId['PM-002'].done, byId['PM-002'].missed], [3, 1, 2],
   'planned vs actual per plan');
eq([byId['PM-001'].expected, byId['PM-001'].done, byId['PM-001'].missed], [3, 3, 0],
   'a plan kept up to date shows no gap');
eq([byId['PM-003'].expected, byId['PM-003'].done, byId['PM-003'].missed], [1, 1, 0],
   'a retired plan is never charged a miss');
eq(byId['PM-001'].late, 1, 'one of the three was signed off late');
eq(byId['PM-001'].lastDone, d('2026-03-10T03:00:00Z').toISOString(), 'last sign-off in the window');
eq(byId['PM-001'].lastBy, 'ช่างสมชาย', 'and who signed it');

// The corrective-action thread: NG -> the BM job raised off it.
eq(rep.ng.length, 1, 'the NG list carries the finding');
eq(rep.ng[0].ngDetail, 'ลมรั่วที่ข้อต่อ', 'what was found');
eq(rep.ng[0].actionTaken, 'เปลี่ยนข้อต่อ', 'what was done');
eq(rep.ng[0].followUp, { mtJob: '05032026-1', status: 'ปิดงาน' },
   'and the repair job it was handed off to');

// A job raised months before the check can't be its corrective action.
eq(rep.ng[0].followUp.mtJob !== '01012026-9', true, 'an earlier job is not the follow-up');

// --- scoping ---------------------------------------------------------------
const line1 = apiGetPMAudit({ from: '2026-01-01', to: '2026-03-31', line: 'Line 1' });
eq(line1.summary.plans, 1, 'one line at a time');
eq(line1.plans[0].pmId, 'PM-003', 'and only that line\'s plan');

// Before the first sign-off ever filed there is no evidence either way, so
// the report must not manufacture a year of misses out of an empty sheet.
const before = apiGetPMAudit({ from: '2020-01-01', to: '2020-12-31' });
eq([before.summary.plans, before.summary.expected, before.summary.missed], [0, 0, 0],
   'a window entirely before recording began charges nothing');
eq(before.dataStart, d('2025-12-10T03:00:00Z').toISOString(),
   'and the report says when recording actually began');

// A window straddling that start date counts only from the start date on.
const straddle = apiGetPMAudit({ from: '2025-01-01', to: '2026-03-31' });
eq(straddle.expectedFrom, new Date(2025, 11, 10).toISOString(),
   'expected occurrences start at the first record, not at the window start');
eq(straddle.summary.missed, 2, 'so the only misses reported are the real ones');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
