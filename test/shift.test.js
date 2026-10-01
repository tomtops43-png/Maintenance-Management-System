// PM rotates between shift A and B: whoever finishes a round hands the next
// one to the other shift. Pinned here: the shift that *did* the work decides
// (not the old owner), the hand-off survives both sign-off paths, and an old
// paper sheet entered late can't decide who owns a newer round.
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
eq(nextPMShiftOwner('A', 'B'), 'A', 'B covers A\'s job -> A next, not B twice');
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
eq(owner(0), 'A', 'no form value: the user\'s own shift decides');

reset(['A']);
apiSubmitPM({ pmId: 'PM-001', photoBase64: PHOTO, result: 'NG', shift: 'B' }, {});
eq(owner(0), 'A', 'NG still counts as this round done');

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
eq([owner(0), owner(1), owner(2)], ['B', 'B', 'A'],
  'bulk: the batch shift applies, a row can name its own, and the doer decides');
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
eq([0, 1, 2, 3, 4].map(owner), ['B', 'A', 'B', 'A', 'A'],
  'alternating, starting from the lighter shift');
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

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
