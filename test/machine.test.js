// apiGetMachineHistory does real arithmetic (MTTR, MTBF) that a person will
// make maintenance decisions on, so pin the numbers down with a known dataset.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');

require('./stubs').install();
global.getSheet = () => null;
global.getSheetOrThrow = (n) => { throw new Error('no sheet ' + n); };
global.ensureSheets = () => {};

const DAY = 86400000;
const t0 = new Date('2026-06-01T08:00:00Z').getTime();

// Station 10 fails on days 0, 10, 20, 30 -> three 10-day gaps -> MTBF 10 days.
// Downtimes 30/60/90 on the closed ones -> MTTR 60. The last one is still open.
const JOBS = [
  { mtJob: '01062026-1', mc: 'Station 10', line: 'Line 4', area: 'ENC H9', status: 'ปิดงาน', downtime: 30, timestamp: new Date(t0).toISOString(),           date: new Date(t0).toISOString(), symptom: 'โซ่ตก' },
  { mtJob: '11062026-1', mc: 'Station 10', line: 'Line 4', area: 'ENC H9', status: 'ปิดงาน', downtime: 60, timestamp: new Date(t0 + 10 * DAY).toISOString(), date: new Date(t0 + 10 * DAY).toISOString(), symptom: 'โซ่ตกอีก' },
  { mtJob: '21062026-1', mc: 'Station 10', line: 'Line 4', area: 'ENC H9', status: 'ปิดงาน', downtime: 90, timestamp: new Date(t0 + 20 * DAY).toISOString(), date: new Date(t0 + 20 * DAY).toISOString(), symptom: 'เซนเซอร์' },
  { mtJob: '01072026-1', mc: 'Station 10', line: 'Line 4', area: 'ENC H9', status: 'กำลังซ่อม', downtime: '', timestamp: new Date(t0 + 30 * DAY).toISOString(), date: new Date(t0 + 30 * DAY).toISOString(), symptom: 'โซ่ตกซ้ำ' },
  // Same station number on a different line — must not be mixed in.
  { mtJob: '05062026-9', mc: 'Station 10', line: 'Line 1', area: 'ENC H9', status: 'ปิดงาน', downtime: 999, timestamp: new Date(t0 + 4 * DAY).toISOString(), date: new Date(t0 + 4 * DAY).toISOString(), symptom: 'คนละไลน์' },
  { mtJob: 'AS-01062026-1', mc: 'Arc chute 06', line: 'Arc chute', area: 'Assembly M/C', status: 'ปิดงาน', downtime: 15, timestamp: new Date(t0).toISOString(), date: new Date(t0).toISOString(), symptom: 'ลมรั่ว' }
];
const REPAIRS = [
  { mtJob: '01062026-1', mainIssue: 'Mechanical', specificIssue: 'Chain', by: 'ช่างสมชาย' },
  { mtJob: '11062026-1', mainIssue: 'Mechanical', specificIssue: 'Chain', by: 'ช่างสมชาย' },
  { mtJob: '21062026-1', mainIssue: 'Electrical', specificIssue: 'Sensor', by: 'ช่างสมหมาย' }
];

eval(src
  .replace(/^function getSheet\(/m, 'function __x1(')
  .replace(/^function getSheetOrThrow\(/m, 'function __x2(')
  .replace(/^function ensureSheets\(/m, 'function __x3(')
  .replace(/^function apiGetBMJobs\(/m, 'function __unusedGetBMJobs(')
  .replace(/^function readRepairRowsFull\(/m, 'function __unusedReadRepairs('));

global.apiGetBMJobs = () => JOBS.map(j => Object.assign({}, j));
global.readRepairRowsFull = () => REPAIRS.map(r => Object.assign({}, r));
apiGetBMJobs = global.apiGetBMJobs;
readRepairRowsFull = global.readRepairRowsFull;

let fails = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; console.log('FAIL ' + label + '\n       got  ' + JSON.stringify(actual) + '\n       want ' + JSON.stringify(expected)); }
  else console.log('ok   ' + label);
}

const h = apiGetMachineHistory({ area: 'ENC H9', line: 'Line 4', mc: 'Station 10' });

eq(h.stats.totalJobs, 4, 'counts only this machine on this line');
eq(h.stats.openJobs, 1, 'still-open job counted separately');
eq(h.stats.totalDowntime, 180, 'downtime sums closed jobs only (30+60+90)');
eq(h.stats.mttr, 60, 'MTTR is the mean of closed downtimes');
eq(h.stats.mtbfDays, 10, 'MTBF is the mean gap between failures, in days');
eq(h.topIssues, [
  { key: 'Chain', value: 2 }, { key: 'Sensor', value: 1 }
], 'top issues ranked by frequency');
eq(h.jobs.length, 4, 'every job returned');
eq(h.jobs[0].mtJob, '01072026-1', 'newest job first');
eq(h.jobs[0].issue, '', 'an unclosed job has no diagnosis yet');
eq(h.jobs[3].issue, 'Chain', 'closed jobs carry their diagnosis through');
// Who did the work is the other half of a service record and was being
// dropped on the way out of the API even though the reader had it.
eq(h.jobs[3].by, 'ช่างสมชาย', 'the technician who repaired it comes through');
eq(h.jobs[1].by, 'ช่างสมหมาย', 'per job, not per machine');
eq(h.jobs[0].by, '', 'an unclosed job has nobody yet');
eq(h.truncated, false, 'not truncated at this size');

// Same station number, other line — the filter must actually separate them.
const other = apiGetMachineHistory({ area: 'ENC H9', line: 'Line 1', mc: 'Station 10' });
eq(other.stats.totalJobs, 1, 'Line 1 sees only its own Station 10');
eq(other.stats.totalDowntime, 999, "and its own downtime, not Line 4's");

// A machine with a single failure has no interval to report.
const once = apiGetMachineHistory({ area: 'Assembly M/C', line: 'Arc chute', mc: 'Arc chute 06' });
eq(once.stats.totalJobs, 1, 'Assembly machine found in its own area');
eq(once.stats.mtbfDays, 0, 'one failure yields no MTBF rather than a fake one');
eq(once.stats.mttr, 15, 'MTTR still works off a single closed job');

// Line/area left blank = every machine with that name, wherever it is.
const anywhere = apiGetMachineHistory({ mc: 'Station 10' });
eq(anywhere.stats.totalJobs, 5, 'unfiltered lookup spans lines');

let threw = false;
try { apiGetMachineHistory({}); } catch (e) { threw = /ไม่ระบุเครื่องจักร/.test(e.message); }
eq(threw, true, 'refuses to run without a machine');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
