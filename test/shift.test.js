// PM rotates between shift A and B machine by machine: each round a machine
// flips to the other shift, and each line's machines are split evenly.
// Pinned here: the *owner* flips (covering for the other shift doesn't move
// the schedule), the hand-off survives both sign-off paths, an old paper
// sheet entered late can't decide who owns a newer round, and lines stay
// balanced.
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
    new Date(2026, 7, 1), new Date(2026, 8, 1), '', true, '', '', o
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

// --- a machine is one round -------------------------------------------------
const day = (d) => d.getTime();
eq(day(nextDueOnSchedule(new Date(2026, 9, 1), new Date(2026, 9, 3, 15), 'Monthly')), day(new Date(2026, 10, 1)),
  'done two days late: the next round is still the 1st, not the 3rd');
eq(day(nextDueOnSchedule(new Date(2026, 6, 1), new Date(2026, 9, 2), 'Monthly')), day(new Date(2026, 10, 1)),
  'several rounds behind: skip to the first slot after today, not one in the past');
eq(day(nextDueOnSchedule(new Date(2026, 0, 31), new Date(2026, 0, 31), 'Monthly')), day(new Date(2026, 1, 28)),
  'the 31st clamps to the end of a short month');
eq(day(nextDueOnSchedule('', new Date(2026, 9, 2), 'Monthly')), day(new Date(2026, 10, 2)),
  'no due date to anchor on: count from the done date, as before');

// Two items on one machine, both A's this round. B covers the second one
// after A did the first: the machine's next round stays with one shift.
reset(['A', 'A']);
apiSubmitPM({ pmId: 'PM-001', photoBase64: PHOTO, result: 'OK', shift: 'A' }, {});
apiSubmitPM({ pmId: 'PM-002', photoBase64: PHOTO, result: 'OK', shift: 'B' }, {});
eq([owner(0), owner(1)], ['B', 'B'], 'single sign-offs: the second item follows the machine, not its doer');
eq(SHEETS.PM_MASTER.rows[1][7].getTime(), SHEETS.PM_MASTER.rows[2][7].getTime(),
  'and both items land on the same next due date');

// Arc chute 06 as it was: half the machine done on the 1st (moved to 1 Nov,
// now A's), the other half still due on the 2nd and B's.
function arc() {
  SHEETS.PM_MASTER = makeSheet([MAST_HEAD].concat([
    ['PM-070', 'Arc chute', 'Arc chute 06', 'x', '', 'Monthly', new Date(2026, 9, 1), new Date(2026, 10, 1), '', true, '', '', 'A'],
    ['PM-074', 'Arc chute', 'Arc chute 06', 'y', '', 'Monthly', new Date(2026, 9, 1), new Date(2026, 10, 1), '', true, '', '', 'A'],
    ['PM-090', 'Arc chute', 'Arc chute 06', 'z', '', 'Monthly', new Date(2026, 8, 2), new Date(2026, 9, 2), '', true, '', '', 'B'],
    ['PM-094', 'Arc chute', 'Arc chute 06', 'w', '', 'Monthly', new Date(2026, 8, 2), new Date(2026, 9, 2), '', true, '', '', 'B'],
    ['PM-200', 'Arc chute', 'Arc chute 07', 'x', '', 'Monthly', '', new Date(2026, 9, 5), '', true, '', '', 'A']
  ]));
  SHEETS.PM_RECORDS = makeSheet([REC_HEAD.slice()]);
}
const due = (i) => SHEETS.PM_MASTER.rows[i + 1][7].getTime();
arc();
let al = alignPMRounds(SHEETS.PM_MASTER, { dryRun: true });
eq(al.plans, 2, 'dry run: the two items done this round would move');
eq(due(0), day(new Date(2026, 10, 1)), 'and a dry run writes nothing');
al = alignPMRounds(SHEETS.PM_MASTER, {});
eq([0, 1, 2, 3].map(due), [new Date(2026, 10, 2), new Date(2026, 10, 2), new Date(2026, 9, 2), new Date(2026, 9, 2)].map(day),
  'align: items still open stay on the round (2 Oct); items already done this round go to the next one (2 Nov), not back to redo');
eq([0, 1, 2, 3].map(owner), ['A', 'A', 'B', 'B'], 'the round stays B\'s, the next one A\'s');
eq(al.machines, 1, 'only the machine that had drifted is counted');
eq(due(4), day(new Date(2026, 9, 5)), 'a machine that was already whole is left alone');
apiSubmitPM({ pmId: 'PM-090', photoBase64: PHOTO, result: 'OK', shift: 'B' }, {});
apiSubmitPM({ pmId: 'PM-094', photoBase64: PHOTO, result: 'OK', shift: 'B' }, {});
eq([0, 1, 2, 3].map(due), [0, 1, 2, 3].map(() => day(new Date(2026, 10, 2))),
  'once B finishes the round, the whole machine is due together');
eq([0, 1, 2, 3].map(owner), ['A', 'A', 'A', 'A'], 'and the whole machine is A\'s next');
// Arc chute 06 and 07 are now both A's: one line, two machines, so align
// hands one to B — the one nobody has started this round (07).
al = alignPMRounds(SHEETS.PM_MASTER, {});
eq([al.plans, owner(4)], [1, 'B'], 'align rebalances the line: 1 machine each, moving the unstarted one');
eq(alignPMRounds(SHEETS.PM_MASTER, {}).plans, 0, 're-running align on a balanced line changes nothing');

// Six machines on one line, four of them A's: align makes it 3 and 3.
SHEETS.PM_MASTER = makeSheet([MAST_HEAD].concat([1, 2, 3, 4, 5, 6].map(n =>
  ['PM-' + n, 'Line 4', 'Station ' + n, 'x', '', 'Monthly', '', new Date(2026, 9, 10), '', true, '', '',
   n <= 4 ? 'A' : 'B'])));
alignPMRounds(SHEETS.PM_MASTER, {});
const six = [0, 1, 2, 3, 4, 5].map(owner);
eq([six.filter(o => o === 'A').length, six.filter(o => o === 'B').length], [3, 3], 'six machines split 3 A / 3 B');
eq(six.slice(0, 3), ['A', 'A', 'A'], 'machines that were already A\'s keep it; only the surplus moves');

// A new item on an existing machine joins its round.
arc();
c = crudPMMaster('create', { data: { line: 'Arc chute', mcStation: 'Arc chute 07', pmItem: 'new', frequency: 'Monthly' } });
eq(c.shiftOwner, 'A', 'a new item takes its machine\'s shift');
eq(due(5), day(new Date(2026, 9, 5)), 'and its machine\'s due date');

// ST.11 as reported: all four items signed off on 2 Oct, but two of them
// still read Next_Due 30 Sep (an admin edit form opened before the sign-off
// wrote the old dates back). The records prove they were done.
function st11() {
  const done = new Date(2026, 9, 2, 13, 30);
  SHEETS.PM_MASTER = makeSheet([MAST_HEAD].concat([
    ['PM-020', 'Line 4', 'ST.11', 'ลม', '', 'Monthly', new Date(2026, 7, 30), new Date(2026, 8, 30), '', true, '', '', 'B'],
    ['PM-024', 'Line 4', 'ST.11', 'servo', '', 'Monthly', new Date(2026, 7, 30), new Date(2026, 8, 30), '', true, '', '', 'B'],
    ['PM-027', 'Line 4', 'ST.11', 'มอเตอร์', '', 'Monthly', new Date(2026, 9, 2, 8, 31), new Date(2026, 9, 30), '', true, '', '', 'B'],
    ['PM-017', 'Line 4', 'ST.11', '5ส', '', 'Monthly', new Date(2026, 9, 2, 8, 40), new Date(2026, 9, 30), '', true, '', '', 'B']
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
eq([0, 1, 2, 3].map(due), [0, 1, 2, 3].map(() => day(new Date(2026, 9, 30))),
  'align: a plan whose record is newer than its Next_Due moves on to the next round (30 Oct)');
eq(SHEETS.PM_MASTER.rows[1][6].getTime(), new Date(2026, 9, 2, 13, 30).getTime(),
  'and its Last_Done is put back to the recorded sign-off');
eq(al.changes.filter(c => c.pmId === 'PM-020')[0].fromDue, new Date(2026, 8, 30).toISOString(),
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
eq(due(0), day(new Date(2026, 8, 30)), 'a sign-off on another machine with the same PM_ID leaves this plan due');

// Editing a plan keeps the schedule the sign-offs wrote, unless the admin
// changed the due date on purpose.
st11();
crudPMMaster('update', { data: { pmId: 'PM-027', line: 'Line 4', mcStation: 'ST.11', pmItem: 'มอเตอร์ ใหม่',
  frequency: 'Monthly', lastDone: '2026-08-30', nextDue: '2026-09-30', active: true } });
eq([SHEETS.PM_MASTER.rows[3][6].getTime(), due(2)], [new Date(2026, 9, 2, 8, 31).getTime(), day(new Date(2026, 9, 30))],
  'an edit from a stale form doesn\'t roll Last_Done / Next_Due back');
eq(SHEETS.PM_MASTER.rows[3][3], 'มอเตอร์ ใหม่', 'but the edit itself is saved');
crudPMMaster('update', { data: { pmId: 'PM-027', line: 'Line 4', mcStation: 'ST.11', pmItem: 'มอเตอร์',
  frequency: 'Monthly', nextDue: '2026-10-15', nextDueChanged: true, active: true } });
eq(due(2), day(new Date(2026, 9, 15)), 'a due date the admin changed is written');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
