// PM rotates between shift A and B machine by machine: each round a machine
// flips to the other shift, and each line's machines are split evenly.
// Pinned here: the *owner* flips (covering for the other shift doesn't move
// the schedule), the hand-off survives both sign-off paths, an old paper
// sheet entered late can't decide who owns a newer round, and lines stay
// balanced.
// A round is a calendar period and a sign-off is only accepted inside the
// plan's round, so "now" is pinned: 3 Oct 2026, midday.
const RealDate = Date;
const NOW = new RealDate(2026, 9, 3, 12, 0).getTime();
global.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(NOW); }
  static now() { return NOW; }
};
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
// No real sessions here: the doer's shift comes from the form or the clock.
global.resolveUser = () => null;
global.apiGetConfig = () => ({ Setting: {} });
// Drive is out of reach here; a sign-off just needs a photo to have been saved.
global.savePhoto = () => 'https://drive.google.com/thumbnail?id=x';
global.areaForLine = () => 'ENC H9';
global.bookForArea = () => ({});

eval(src
  .replace(/^function getSheet\(/m, 'function __x1(')
  .replace(/^function getSheetOrThrow\(/m, 'function __x2(')
  .replace(/^function ensureSheets\(/m, 'function __x3(')
  .replace(/^function resolveUser\(/m, 'function __x4(')
  .replace(/^function apiGetConfig\(/m, 'function __x5(')
  .replace(/^function savePhoto\(/m, 'function __x6(')
  .replace(/^function areaForLine\(/m, 'function __x7(')
  .replace(/^function bookForArea\(/m, 'function __x8('));
resolveUser = global.resolveUser;
apiGetConfig = global.apiGetConfig;
savePhoto = global.savePhoto;
areaForLine = global.areaForLine;
bookForArea = global.bookForArea;
const PHOTO = 'data:image/jpeg;base64,AAAA';

let fails = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; console.log('FAIL ' + label + '\n       got  ' + JSON.stringify(actual) + '\n       want ' + JSON.stringify(expected)); }
  else console.log('ok   ' + label);
}

// --- the rule itself -------------------------------------------------------
eq(normalizeShift('กะ A'), 'A', 'Thai label is understood');
eq(normalizeShift(' b '), 'B', 'case and spacing are ignored');
eq(normalizeShift('Shift B'), 'B', '"Shift B" is B, not the A inside SHIFT');
eq(normalizeShift(''), '', 'blank stays blank');
eq(normalizeShift('C'), '', 'anything else is not a shift');
eq(nextPMShiftOwner('A', 'A'), 'B', 'A owns it, A does it -> B next');
eq(nextPMShiftOwner('A', 'B'), 'B', 'B covers A\'s job -> still B next: the owner flips, so the line stays split evenly');
eq(nextPMShiftOwner('', 'B'), 'A', 'no owner -> the doer decides');
eq(nextPMShiftOwner('A', ''), 'B', 'doer unknown -> flip the owner');
eq(nextPMShiftOwner('', ''), '', 'nothing to go on -> leave it');

// --- sheets ----------------------------------------------------------------
const MAST_HEAD = ['PM_ID', 'Line', 'MC_Station', 'PM_Item', 'Standard', 'Frequency',
  'Last_Done', 'Next_Due', 'Assigned_To', 'Active', 'Notes', 'Photo_URL', 'Shift_Owner'];
const REC_HEAD = PM_RECORD_HEADERS.slice();
const SHIFT = 12;

function reset(owners) {
  SHEETS.PM_MASTER = makeSheet([MAST_HEAD].concat(owners.map((o, i) => [
    'PM-00' + (i + 1), 'Line 5', 'CWM-01', 'อัดจารบี ' + i, '', 'Monthly',
    new Date(2026, 6, 1), new Date(2026, 7, 31), '', true, '', '', o
  ])));
  SHEETS.PM_RECORDS = makeSheet([REC_HEAD.slice()]);
}
const owner = (i) => SHEETS.PM_MASTER.rows[i + 1][SHIFT];
const recShift = (i) => SHEETS.PM_RECORDS.rows[i + 1][REC_HEAD.indexOf('Shift')];

// --- single sign-off ---------------------------------------------------------
reset(['A']);
let r = apiSubmitPM({ pmId: 'PM-001', photoBase64: PHOTO, result: 'OK', shift: 'A' }, { name: 'ช่างเอ' });
eq(owner(0), 'B', 'CWM-01: A did it this round -> B owns the next');
eq(r.nextShiftOwner, 'B', 'and the caller is told so');
eq(recShift(0), 'A', 'the record keeps which shift did it');
SHEETS.PM_MASTER.rows[1][7] = new Date(2026, 9, 3);   // a round later: due again
r = apiSubmitPM({ pmId: 'PM-001', photoBase64: PHOTO, result: 'OK', shift: 'B' }, {});
eq(owner(0), 'A', 'B does it -> back to A');

reset(['A']);
apiSubmitPM({ pmId: 'PM-001', photoBase64: PHOTO, result: 'OK' }, { shift: 'B' });
eq(owner(0), 'B', 'no form value: the owner still flips');
eq(recShift(0), 'B', 'and the record keeps the user\'s own shift as the doer');

reset(['A']);
apiSubmitPM({ pmId: 'PM-001', photoBase64: PHOTO, result: 'NG', shift: 'B' }, {});
eq(owner(0), 'B', 'NG still counts as this round done');

// The photo is the proof the work was done — no photo, no sign-off.
reset(['A']);
let refused = '';
try { apiSubmitPM({ pmId: 'PM-001', result: 'OK', shift: 'A' }, {}); } catch (e) { refused = e.message; }
eq(/รูป/.test(refused), true, 'a sign-off without a photo is refused');
eq(SHEETS.PM_RECORDS.rows.length, 1, 'and nothing is recorded');
eq(owner(0), 'A', 'nor is the shift handed over');

// A sheet that hasn't had ensureSheets run: no column, no rotation, no crash.
SHEETS.PM_MASTER = makeSheet([MAST_HEAD.slice(0, 12),
  ['PM-001', 'Line 5', 'CWM-01', 'x', '', 'Monthly', '', new Date(2026, 8, 1), '', true, '', '']]);
SHEETS.PM_RECORDS = makeSheet([REC_HEAD.slice()]);
r = apiSubmitPM({ pmId: 'PM-001', photoBase64: PHOTO, result: 'OK', shift: 'A' }, {});
eq(r.nextShiftOwner, '', 'without Shift_Owner the sign-off still works');
eq(SHEETS.PM_MASTER.rows[1].length, 12, 'and no stray column is written');

// --- bulk ----------------------------------------------------------------------
reset(['A', 'B', 'A']);
apiSubmitPMBulk({ doneDate: '2026-08-28', shift: 'A', items: [
  { pmId: 'PM-001', result: 'OK' },
  { pmId: 'PM-002', result: 'OK' },
  { pmId: 'PM-003', result: 'OK', shift: 'B' }
] }, {});
// All three are on CWM-01: one machine, one round. The first sign-off
// decides who owns the next round and the rest of the machine follows,
// even the item B happened to cover.
eq([owner(0), owner(1), owner(2)], ['B', 'B', 'B'],
  'bulk: a machine\'s next round goes to one shift, decided by the first sign-off');
eq([recShift(0), recShift(1), recShift(2)], ['A', 'A', 'B'], 'records carry the shift');

reset(['A']);
apiSubmitPMBulk({ doneDate: '2026-08-28', items: [{ pmId: 'PM-001', result: 'OK' }] }, {});
eq(owner(0), 'B', 'bulk without a shift flips the owner');
eq(recShift(0), '', 'and does not invent one for the record');

reset(['A']);
apiSubmitPMBulk({ doneDate: '2026-08-28', shift: 'A', items: [{ pmId: 'PM-001', result: 'OK' }] }, {});
apiSubmitPMBulk({ doneDate: '2026-08-05', shift: 'A', items: [{ pmId: 'PM-001', result: 'OK' }] }, {});
eq(owner(0), 'B', 'an older sheet entered later does not flip the owner again');

// --- starting owners for existing plans --------------------------------------
reset(['', '', '', '', 'A']);
eq(assignPMShiftOwners(SHEETS.PM_MASTER), 4, 'only blank owners are filled');
eq([0, 1, 2, 3, 4].map(owner), ['A', 'A', 'A', 'A', 'A'],
  'blank items take the shift their machine already has');

// Machines with no owner yet alternate — machine by machine, not item by item.
SHEETS.PM_MASTER = makeSheet([MAST_HEAD].concat([
  ['PM-001', 'L', 'M1', 'a', '', 'Monthly', '', new Date(2026, 8, 1), '', true, '', '', ''],
  ['PM-002', 'L', 'M1', 'b', '', 'Monthly', '', new Date(2026, 8, 1), '', true, '', '', ''],
  ['PM-003', 'L', 'M2', 'a', '', 'Monthly', '', new Date(2026, 8, 1), '', true, '', '', ''],
  ['PM-004', 'L', 'M2', 'b', '', 'Monthly', '', new Date(2026, 8, 1), '', true, '', '', ''],
  ['PM-005', 'L', 'M3', 'a', '', 'Monthly', '', new Date(2026, 8, 1), '', true, '', '', '']
]));
eq(assignPMShiftOwners(SHEETS.PM_MASTER), 5, 'every blank plan gets an owner');
eq([0, 1, 2, 3, 4].map(owner), ['A', 'A', 'B', 'B', 'A'],
  'a machine\'s items share one shift, machines alternate');
eq(assignPMShiftOwners(SHEETS.PM_MASTER), 0, 're-running changes nothing');

// --- reads and new plans ------------------------------------------------------
reset(['A', 'b']);
eq(readPMMaster().map(p => p.shiftOwner), ['A', 'B'], 'readPMMaster exposes the owner');

reset(['A', 'A', 'B']);
let c = crudPMMaster('create', { data: { line: 'Line 5', mcStation: 'CWM-02', pmItem: 'x', frequency: 'Monthly' } });
eq(c.shiftOwner, 'B', 'a new plan goes to the lighter shift');
eq(owner(3), 'B', 'and lands in the Shift_Owner column');
c = crudPMMaster('create', { data: { line: 'Line 5', mcStation: 'CWM-03', pmItem: 'y', frequency: 'Monthly', shiftOwner: 'A' } });
eq(owner(4), 'A', 'unless the admin picked one');

crudPMMaster('update', { data: { pmId: 'PM-001', line: 'Line 5', mcStation: 'CWM-01', pmItem: 'renamed', frequency: 'Monthly' } });
eq(owner(0), 'A', 'editing a plan without picking a shift leaves the rotation alone');
crudPMMaster('update', { data: { pmId: 'PM-001', line: 'Line 5', mcStation: 'CWM-01', pmItem: 'renamed', frequency: 'Monthly', shiftOwner: 'B' } });
eq(owner(0), 'B', 'and an admin can set it by hand');

// --- calendar rounds -------------------------------------------------------
const day = (d) => d.getTime();
const D = (y, m, dd) => new Date(y, m - 1, dd);
eq([pmPeriodStart(D(2026, 10, 17), 'Monthly'), pmPeriodEnd(D(2026, 10, 17), 'Monthly')].map(day),
  [D(2026, 10, 1), D(2026, 10, 31)].map(day), 'Monthly: the calendar month');
eq([pmPeriodStart(D(2026, 11, 5), 'Quarterly'), pmPeriodEnd(D(2026, 11, 5), 'Quarterly')].map(day),
  [D(2026, 10, 1), D(2026, 12, 31)].map(day), 'Quarterly: Oct–Dec');
eq([pmPeriodStart(D(2027, 2, 1), 'HalfYear'), pmPeriodEnd(D(2027, 2, 1), 'HalfYear')].map(day),
  [D(2027, 1, 1), D(2027, 6, 30)].map(day), 'HalfYear: Jan–Jun');
eq([pmPeriodStart(D(2026, 10, 3), 'Weekly'), pmPeriodEnd(D(2026, 10, 3), 'Weekly')].map(day),
  [D(2026, 9, 28), D(2026, 10, 4)].map(day), 'Weekly: Monday to Sunday');
eq(day(pmPeriodEnd(D(2026, 12, 31), 'Yearly')), day(D(2026, 12, 31)), 'Yearly: the calendar year');

eq(day(nextDueOnSchedule(D(2026, 10, 31), D(2026, 10, 3), 'Monthly')), day(D(2026, 11, 30)),
  'October done on the 3rd: next round is November, due its last day');
eq(day(nextDueOnSchedule(D(2026, 10, 2), new Date(2026, 9, 31, 23), 'Monthly')), day(D(2026, 11, 30)),
  'done on the 31st, it is still October\'s round');
eq(day(nextDueOnSchedule(D(2026, 7, 31), D(2026, 10, 2), 'Monthly')), day(D(2026, 11, 30)),
  'several rounds behind: the sign-off closes the round it was done in, the missed ones are skipped');
eq(day(nextDueOnSchedule('', D(2026, 10, 2), 'Monthly')), day(D(2026, 11, 30)),
  'no due date to anchor on: the round after the one it was done in');
let walk = D(2026, 1, 31);
const ends = [];
for (let i = 0; i < 3; i++) { walk = nextDueOnSchedule(walk, walk, 'Monthly'); ends.push(walk.getDate()); }
eq(ends, [28, 31, 30], 'month ends follow the calendar (28 Feb, 31 Mar, 30 Apr) instead of sticking on the 28th');
eq(day(pmPlacedDue(D(2026, 9, 2), null, 'Monthly', D(2026, 10, 3))), day(D(2026, 10, 31)),
  'a round whose month ended unsigned moves to the current month');
eq(day(pmPlacedDue(D(2026, 11, 2), null, 'Monthly', D(2026, 10, 3))), day(D(2026, 11, 30)),
  'a due date inside a later month moves to that month\'s last day');
eq(day(pmPlacedDue(D(2026, 10, 30), D(2026, 10, 2), 'Monthly', D(2026, 10, 3))), day(D(2026, 11, 30)),
  'a sign-off in the due date\'s month means that round is done');

// --- a machine is one round -------------------------------------------------
// Two items on one machine, both A's this round. B covers the second one
// after A did the first: the machine's next round stays with one shift.
reset(['A', 'A']);
apiSubmitPM({ pmId: 'PM-001', photoBase64: PHOTO, result: 'OK', shift: 'A' }, {});
apiSubmitPM({ pmId: 'PM-002', photoBase64: PHOTO, result: 'OK', shift: 'B' }, {});
eq([owner(0), owner(1)], ['B', 'B'], 'single sign-offs: the second item follows the machine, not its doer');
eq(SHEETS.PM_MASTER.rows[1][7].getTime(), SHEETS.PM_MASTER.rows[2][7].getTime(),
  'and both items land on the same next due date');

// Arc chute 06: half the machine done this month (now on November, A's),
// the other half still open in October (B's), and one item that drifted out
// to December without being done.
function arc() {
  SHEETS.PM_MASTER = makeSheet([MAST_HEAD].concat([
    ['PM-070', 'Arc chute', 'Arc chute 06', 'x', '', 'Monthly', D(2026, 10, 1), D(2026, 11, 30), '', true, '', '', 'A'],
    ['PM-074', 'Arc chute', 'Arc chute 06', 'y', '', 'Monthly', D(2026, 10, 1), D(2026, 11, 30), '', true, '', '', 'A'],
    ['PM-090', 'Arc chute', 'Arc chute 06', 'z', '', 'Monthly', D(2026, 9, 2), D(2026, 10, 31), '', true, '', '', 'B'],
    ['PM-094', 'Arc chute', 'Arc chute 06', 'w', '', 'Monthly', D(2026, 9, 2), D(2026, 10, 31), '', true, '', '', 'B'],
    ['PM-098', 'Arc chute', 'Arc chute 06', 'v', '', 'Monthly', D(2026, 8, 2), D(2026, 12, 31), '', true, '', '', 'A'],
    ['PM-200', 'Arc chute', 'Arc chute 07', 'x', '', 'Monthly', '', D(2026, 10, 31), '', true, '', '', 'A']
  ]));
  SHEETS.PM_RECORDS = makeSheet([REC_HEAD.slice()]);
}
const due = (i) => SHEETS.PM_MASTER.rows[i + 1][7].getTime();
arc();
let al = alignPMRounds(SHEETS.PM_MASTER, { dryRun: true });
eq(al.plans, 1, 'dry run: only the item that drifted to December would move');
eq(due(4), day(D(2026, 12, 31)), 'and a dry run writes nothing');
al = alignPMRounds(SHEETS.PM_MASTER, {});
eq([0, 1, 2, 3, 4].map(due), [D(2026, 11, 30), D(2026, 11, 30), D(2026, 10, 31), D(2026, 10, 31), D(2026, 10, 31)].map(day),
  'align: the drifted item rejoins October; items already done in October stay on November, not back to redo');
eq([0, 1, 2, 3, 4].map(owner), ['A', 'A', 'B', 'B', 'B'], 'October stays B\'s, November A\'s');
eq(al.machines, 1, 'only the machine that had drifted is counted');
eq(due(5), day(D(2026, 10, 31)), 'a machine that was already whole is left alone');
['PM-090', 'PM-094', 'PM-098'].forEach(id => apiSubmitPM({ pmId: id, photoBase64: PHOTO, result: 'OK', shift: 'B' }, {}));
eq([0, 1, 2, 3, 4].map(due), [0, 1, 2, 3, 4].map(() => day(D(2026, 11, 30))),
  'once B finishes October, the whole machine is due together');
eq([0, 1, 2, 3, 4].map(owner), ['A', 'A', 'A', 'A', 'A'], 'and the whole machine is A\'s next');
// Arc chute 06 is on November (A's), 07 is still on October (A's) — so in
// November both would be... 06 A, 07 B: already split. Nothing moves.
al = alignPMRounds(SHEETS.PM_MASTER, {});
eq(al.plans, 0, 'machines on different rounds are compared on the same round: 06 (Nov, A) and 07 (Oct A -> Nov B) are split');

// Both on October and both A's: one of them is handed to B — the one
// nobody has started this round.
SHEETS.PM_MASTER = makeSheet([MAST_HEAD].concat([
  ['PM-1', 'Arc chute', 'Arc chute 06', 'x', '', 'Monthly', D(2026, 10, 2), D(2026, 11, 30), '', true, '', '', 'B'],
  ['PM-2', 'Arc chute', 'Arc chute 06', 'y', '', 'Monthly', D(2026, 9, 2), D(2026, 10, 31), '', true, '', '', 'A'],
  ['PM-3', 'Arc chute', 'Arc chute 07', 'x', '', 'Monthly', D(2026, 9, 2), D(2026, 10, 31), '', true, '', '', 'A']
]));
SHEETS.PM_RECORDS = makeSheet([REC_HEAD.slice()]);
al = alignPMRounds(SHEETS.PM_MASTER, {});
eq([owner(0), owner(1), owner(2)], ['B', 'A', 'B'], 'align rebalances the line: 1 machine each, moving the unstarted one');
eq(alignPMRounds(SHEETS.PM_MASTER, {}).plans, 0, 're-running align on a balanced line changes nothing');

// Six machines on one line, four of them A's: align makes it 3 and 3.
SHEETS.PM_MASTER = makeSheet([MAST_HEAD].concat([1, 2, 3, 4, 5, 6].map(n =>
  ['PM-' + n, 'Line 4', 'Station ' + n, 'x', '', 'Monthly', '', D(2026, 10, 31), '', true, '', '',
   n <= 4 ? 'A' : 'B'])));
alignPMRounds(SHEETS.PM_MASTER, {});
const six = [0, 1, 2, 3, 4, 5].map(owner);
eq([six.filter(o => o === 'A').length, six.filter(o => o === 'B').length], [3, 3], 'six machines split 3 A / 3 B');
eq(six.slice(0, 3), ['A', 'A', 'A'], 'machines that were already A\'s keep it; only the surplus moves');

// A new item on an existing machine joins its round; on a new machine it
// starts next month rather than in one that's half over.
arc();
c = crudPMMaster('create', { data: { line: 'Arc chute', mcStation: 'Arc chute 07', pmItem: 'new', frequency: 'Monthly' } });
eq(c.shiftOwner, 'A', 'a new item takes its machine\'s shift');
eq(due(6), day(D(2026, 10, 31)), 'and its machine\'s round');
crudPMMaster('create', { data: { line: 'Arc chute', mcStation: 'Arc chute 09', pmItem: 'new', frequency: 'Monthly' } });
eq(due(7), day(D(2026, 11, 30)), 'a new machine starts next month');

// ST.11 as reported: all four items signed off on 2 Oct, but two of them
// still read Next_Due 30 Sep (an admin edit form opened before the sign-off
// wrote the old dates back). The records prove October was done.
function st11() {
  const done = new Date(2026, 9, 2, 13, 30);
  SHEETS.PM_MASTER = makeSheet([MAST_HEAD].concat([
    ['PM-020', 'Line 4', 'ST.11', 'ลม', '', 'Monthly', D(2026, 8, 30), D(2026, 9, 30), '', true, '', '', 'B'],
    ['PM-024', 'Line 4', 'ST.11', 'servo', '', 'Monthly', D(2026, 8, 30), D(2026, 9, 30), '', true, '', '', 'B'],
    ['PM-027', 'Line 4', 'ST.11', 'มอเตอร์', '', 'Monthly', new Date(2026, 9, 2, 8, 31), D(2026, 10, 30), '', true, '', '', 'B'],
    ['PM-017', 'Line 4', 'ST.11', '5ส', '', 'Monthly', new Date(2026, 9, 2, 8, 40), D(2026, 10, 30), '', true, '', '', 'B']
  ]));
  SHEETS.PM_RECORDS = makeSheet([REC_HEAD.slice()]);
  ['PM-020', 'PM-024', 'PM-027', 'PM-017'].forEach((id, i) => {
    SHEETS.PM_RECORDS.rows.push(pmRecordRow(SHEETS.PM_RECORDS, {
      Record_ID: 'PM20261002-' + (i + 1), PM_ID: id, Done_DateTime: done, Result: 'OK',
      Line: 'Line 4', MC_Station: 'ST.11', PM_Item: 'x', Frequency: 'Monthly', Shift: 'B'
    }));
  });
}
st11();
al = alignPMRounds(SHEETS.PM_MASTER, {});
eq([0, 1, 2, 3].map(due), [0, 1, 2, 3].map(() => day(D(2026, 11, 30))),
  'align: every plan signed off in October moves on to November');
eq(SHEETS.PM_MASTER.rows[1][6].getTime(), new Date(2026, 9, 2, 13, 30).getTime(),
  'and its Last_Done is put back to the recorded sign-off');
eq(al.changes.filter(c => c.pmId === 'PM-020')[0].fromDue, D(2026, 9, 30).toISOString(),
  'the preview shows the stale date it moved from');
eq(alignPMRounds(SHEETS.PM_MASTER, {}).plans, 0, 'running it again changes nothing');

// A record from a reused PM_ID on another machine doesn't count.
st11();
SHEETS.PM_RECORDS = makeSheet([REC_HEAD.slice()]);
SHEETS.PM_RECORDS.rows.push(pmRecordRow(SHEETS.PM_RECORDS, {
  Record_ID: 'PM20261002-1', PM_ID: 'PM-020', Done_DateTime: new Date(2026, 9, 2, 9), Result: 'OK',
  Line: 'Line 4', MC_Station: 'ST.12', PM_Item: 'x', Frequency: 'Monthly', Shift: 'B'
}));
alignPMRounds(SHEETS.PM_MASTER, {});
eq(due(0), day(D(2026, 10, 31)), 'a sign-off on another machine with the same PM_ID leaves this plan due (September missed, October open)');

// Editing a plan keeps the schedule the sign-offs wrote, unless the admin
// changed the due date on purpose.
st11();
crudPMMaster('update', { data: { pmId: 'PM-027', line: 'Line 4', mcStation: 'ST.11', pmItem: 'มอเตอร์ ใหม่',
  frequency: 'Monthly', lastDone: '2026-08-30', nextDue: '2026-09-30', active: true } });
eq([SHEETS.PM_MASTER.rows[3][6].getTime(), due(2)], [new Date(2026, 9, 2, 8, 31).getTime(), day(D(2026, 10, 30))],
  'an edit from a stale form doesn\'t roll Last_Done / Next_Due back');
eq(SHEETS.PM_MASTER.rows[3][3], 'มอเตอร์ ใหม่', 'but the edit itself is saved');
crudPMMaster('update', { data: { pmId: 'PM-027', line: 'Line 4', mcStation: 'ST.11', pmItem: 'มอเตอร์',
  frequency: 'Monthly', nextDue: '2026-10-15', nextDueChanged: true, active: true } });
eq(due(2), day(D(2026, 10, 15)), 'a due date the admin changed is written');

// --- signing off inside the round (today is pinned to 3 Oct) ----------------
function plan(due, extra) {
  SHEETS.PM_MASTER = makeSheet([MAST_HEAD].concat([
    ['PM-001', 'Line 4', 'ST.11', 'a', '', 'Monthly', '', due, '', true, '', '', 'A'],
    ['PM-002', 'Line 4', 'ST.11', 'b', '', 'Monthly', '', due, '', true, '', '', 'A']
  ].concat(extra || [])));
  SHEETS.PM_RECORDS = makeSheet([REC_HEAD.slice()]);
}
plan(D(2026, 10, 31));
r = apiSubmitPM({ pmId: 'PM-001', photoBase64: PHOTO, result: 'OK', shift: 'A' }, {});
eq([r.status, r.nextDue], ['OnTime', D(2026, 11, 30).toISOString()], 'October\'s round on 3 Oct: on time, next is November');
plan(D(2026, 11, 30));
refused = '';
try { apiSubmitPM({ pmId: 'PM-001', photoBase64: PHOTO, result: 'OK', shift: 'A' }, {}); } catch (e) { refused = e.message; }
eq(refused.indexOf('01/11/2026') >= 0, true, 'a plan already on November is refused, saying when its round opens');
eq(SHEETS.PM_RECORDS.rows.length, 1, 'and nothing is recorded');
plan(D(2026, 9, 30));
r = apiSubmitPM({ pmId: 'PM-001', photoBase64: PHOTO, result: 'OK', shift: 'A' }, {});
eq([r.status, r.nextDue], ['OnTime', D(2026, 11, 30).toISOString()],
  'a plan still on September (not rolled yet): the sign-off is October\'s round');

// Rounds whose month ended unsigned move on by themselves.
plan(D(2026, 9, 20), [
  ['PM-003', 'Line 4', 'ST.12', 'c', '', 'Monthly', '', D(2026, 7, 1), '', true, '', '', 'B'],
  ['PM-004', 'Line 4', 'ST.13', 'd', '', 'Monthly', '', D(2026, 10, 31), '', true, '', '', 'B'],
  ['PM-005', 'Line 4', 'ST.14', 'e', '', 'Monthly', '', D(2026, 7, 1), '', false, '', '', 'B'],
  ['PM-006', 'Line 4', 'ST.15', 'f', '', 'Monthly', '', D(2026, 10, 15), '', true, '', '', 'B']
]);
eq(rollExpiredPMRounds(), 4, 'three missed rounds closed, one mid-month date set to its month end');
eq([0, 1, 2, 3, 4, 5].map(due), [D(2026, 10, 31), D(2026, 10, 31), D(2026, 10, 31), D(2026, 10, 31),
  D(2026, 7, 1), D(2026, 10, 31)].map(day),
  'all on October; an inactive plan stays put');
eq([0, 1].map(owner), ['A', 'A'], 'a missed round doesn\'t flip the shift');
eq(rollExpiredPMRounds(), 0, 'and running it again changes nothing');

// The due list is every plan whose round is open today.
plan(D(2026, 10, 31), [
  ['PM-003', 'Line 4', 'ST.12', 'c', '', 'Monthly', '', D(2026, 11, 30), '', true, '', '', 'B'],
  ['PM-004', 'Line 4', 'ST.10', 'd', '', 'Monthly', '', D(2026, 10, 31), '', true, '', '', 'B'],
  ['PM-005', 'Line 4', 'ST.16', 'e', '', 'Weekly', '', D(2026, 10, 4), '', true, '', '', 'B']
]);
let dueNow = apiGetPMDue({});
eq(dueNow.map(p => p.pmId), ['PM-005', 'PM-004', 'PM-001', 'PM-002'],
  'October\'s and this week\'s rounds (not November\'s), the one closing soonest first');
eq([dueNow[0].daysLeft, dueNow[0].urgent, dueNow[1].daysLeft, dueNow[1].urgent], [1, true, 28, false],
  'with how many days the round has left');
eq([dueNow[1].windowOpen, dueNow[1].windowClose], [D(2026, 10, 1).toISOString(), D(2026, 10, 31).toISOString()],
  'and the round it is in');

// The ST.11 case again, with no admin involved: reading the plans is enough
// for a plan whose sign-off is on record to move on — and nobody's shift moves.
st11();
eq(rollExpiredPMRounds(), 4, 'all four plans signed off in October are synced on read');
eq([0, 1, 2, 3].map(due), [0, 1, 2, 3].map(() => day(D(2026, 11, 30))), 'all four now due 30 Nov');
eq([0, 1, 2, 3].map(owner), ['B', 'B', 'B', 'B'], 'and every shift owner is left exactly as it was');
eq(SHEETS.PM_MASTER.rows[1][6].getTime(), new Date(2026, 9, 2, 13, 30).getTime(), 'Last_Done follows the record');
eq(apiGetPMDue({}).length, 0, 'so ST.11 is off the due list');

// --- the one-time move onto calendar rounds -------------------------------
// Arc chute 07 as it was on 30 Oct: half done by A on 5 Oct (on November,
// B's next), half last done 2 Sep and pushed to November by the old ±7-day
// window — on a calendar month that half is still October's to finish.
SHEETS.PM_MASTER = makeSheet([MAST_HEAD].concat([
  ['PM-071', 'Arc chute', 'Arc chute 07', 'a', '', 'Monthly', D(2026, 10, 5), D(2026, 11, 1), '', true, '', '', 'B'],
  ['PM-075', 'Arc chute', 'Arc chute 07', 'b', '', 'Monthly', D(2026, 10, 5), D(2026, 11, 1), '', true, '', '', 'B'],
  ['PM-091', 'Arc chute', 'Arc chute 07', 'c', '', 'Monthly', D(2026, 9, 2), D(2026, 11, 1), '', true, '', '', 'B'],
  ['PM-095', 'Arc chute', 'Arc chute 07', 'd', '', 'Monthly', D(2026, 9, 2), D(2026, 11, 1), '', true, '', '', 'B'],
  ['PM-070', 'Arc chute', 'Arc chute 06', 'a', '', 'Monthly', D(2026, 10, 1), D(2026, 11, 2), '', true, '', '', 'A'],
  ['PM-139', 'Arc chute', 'Arc chute 06', 'new', '', 'Monthly', '', D(2026, 11, 2), '', true, '', '', 'B']
]));
SHEETS.PM_RECORDS = makeSheet([REC_HEAD.slice()]);
[['PM-071', D(2026, 10, 5), 'Arc chute 07', 'A'], ['PM-075', D(2026, 10, 5), 'Arc chute 07', 'A'],
 ['PM-091', D(2026, 9, 2), 'Arc chute 07', ''], ['PM-095', D(2026, 9, 2), 'Arc chute 07', ''],
 ['PM-070', D(2026, 10, 1), 'Arc chute 06', 'B']].forEach(([id, at, mc, sh], i) => {
  SHEETS.PM_RECORDS.rows.push(pmRecordRow(SHEETS.PM_RECORDS, {
    Record_ID: 'R' + i, PM_ID: id, Done_DateTime: at, Result: 'OK',
    Line: 'Arc chute', MC_Station: mc, PM_Item: 'x', Frequency: 'Monthly', Shift: sh
  }));
});
const mig = migratePMToCalendarRounds();
eq(mig.pulledBack, 2, 'the two items not done since September come back to October');
eq([0, 1, 2, 3].map(due), [D(2026, 11, 30), D(2026, 11, 30), D(2026, 10, 31), D(2026, 10, 31)].map(day),
  'October\'s leftovers are due 31 Oct; what A already did stays on November');
eq([0, 1, 2, 3].map(owner), ['B', 'B', 'A', 'A'],
  'A started 07 in October, so A finishes October and B has November');
eq([due(4), due(5)], [D(2026, 11, 30), D(2026, 11, 30)].map(day),
  'a brand-new item with no history isn\'t pulled into October');
eq([owner(4), owner(5)], ['A', 'A'], 'B did 06 in October, so 06 is A\'s in November — the whole machine');
eq(migratePMToCalendarRounds().pulledBack, 0, 'running it again pulls nothing more');

// --- doing next month's round early (PM_EarlyDays, default 7) --------------
let so = pmSignOff(D(2026, 11, 30), new Date(2026, 9, 31, 9), 'Monthly');
eq([so.tooEarly, so.early, so.status, day(so.slot), day(so.nextDue)],
  [false, true, 'OnTime', day(D(2026, 11, 30)), day(D(2026, 12, 31))],
  'done 31 Oct, a plan already on November closes November early; next is December');
eq(pmSignOff(D(2026, 11, 30), D(2026, 10, 25), 'Monthly').early, true, '25 Oct is the first early day');
so = pmSignOff(D(2026, 11, 30), D(2026, 10, 24), 'Monthly');
eq([so.tooEarly, day(so.opensOn)], [true, day(D(2026, 10, 25))], '24 Oct is too early, and says early sign-off opens 25 Oct');
eq(pmSignOff(D(2026, 12, 31), D(2026, 10, 31), 'Monthly').tooEarly, true, 'only the next round can be done early, never two ahead');
so = pmSignOff(D(2026, 10, 31), D(2026, 10, 31), 'Monthly');
eq([!!so.early, day(so.slot)], [false, day(D(2026, 10, 31))], 'October still open: a sign-off on 31 Oct closes October, not November');
eq([pmEarlyDays('Weekly'), pmEarlyDays('Monthly')], [3, 7], 'weekly gets at most 3 early days');

// The record keeps the round it closed, and the sync on read believes it.
function earlyCase(nextDue) {
  SHEETS.PM_MASTER = makeSheet([MAST_HEAD].concat([
    ['PM-001', 'Line 4', 'ST.10', 'a', '', 'Monthly', new Date(2026, 9, 31, 9), nextDue, '', true, '', '', 'B'],
    ['PM-002', 'Line 4', 'ST.10', 'b', '', 'Monthly', D(2026, 10, 2), D(2026, 11, 30), '', true, '', '', 'A']
  ]));
  SHEETS.PM_RECORDS = makeSheet([REC_HEAD.slice()]);
  SHEETS.PM_RECORDS.rows.push(pmRecordRow(SHEETS.PM_RECORDS, {
    Record_ID: 'R1', PM_ID: 'PM-001', Done_DateTime: new Date(2026, 9, 31, 9), Result: 'OK', Status: 'OnTime',
    Line: 'Line 4', MC_Station: 'ST.10', PM_Item: 'a', Frequency: 'Monthly', Shift: 'A', Round: D(2026, 11, 30)
  }));
}
earlyCase(D(2026, 12, 31));
eq(rollExpiredPMRounds(), 0, 'an early sign-off already on December is left alone on read');
earlyCase(D(2026, 11, 30));
rollExpiredPMRounds();
eq(due(0), day(D(2026, 12, 31)), 'and one an edit rolled back to November moves on to December — the record says November was done');
earlyCase(D(2026, 12, 31));
alignPMRounds(SHEETS.PM_MASTER, {});
eq([due(0), due(1)], [D(2026, 12, 31), D(2026, 11, 30)].map(day),
  'align doesn\'t pull an early-done item back into November to redo it');
earlyCase(D(2026, 12, 31));
const audNov = apiGetPMAudit({ from: '2026-11-01', to: '2026-11-30', line: 'Line 4', mc: 'ST.10' });
const audOct = apiGetPMAudit({ from: '2026-10-01', to: '2026-10-31', line: 'Line 4', mc: 'ST.10' });
eq([audNov.plans.filter(p => p.pmId === 'PM-001').map(p => p.done)[0], audOct.plans.filter(p => p.pmId === 'PM-001').length],
  [1, 0], 'the audit files it under November, not under the day it was done');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
