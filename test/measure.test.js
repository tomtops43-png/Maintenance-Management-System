// A PM plan can ask for a reading at sign-off (air pressure on an FRL
// check). The admin sets it on the plan; the sign-off refuses to go through
// without it; the record keeps the value with the spec it was taken against.
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


// The photo, the area and the plan's shift owner are someone else's test.
savePhoto = () => 'https://photo';
areaForLine = () => '';
bookForArea = () => 'ENC';

const MAST_HEAD = ['PM_ID', 'Line', 'MC_Station', 'PM_Item', 'Standard', 'Frequency',
  'Last_Done', 'Next_Due', 'Assigned_To', 'Active', 'Notes', 'Photo_URL'];
const t = new Date();
const due = new Date(t.getFullYear(), t.getMonth() + 1, 0);   // this month's round

function reset() {
  SHEETS.PM_MASTER = makeSheet([
    MAST_HEAD.slice(),
    ['PM-141', 'Lug&Screw', 'LS-04', 'ตรวจระบบจ่ายลม (FRL)', '', 'Monthly', '', due, '', true, '', ''],
    ['PM-001', 'Line 5', 'Station 5', 'ทำ 5ส', '', 'Monthly', '', due, '', true, '', '']
  ]);
  SHEETS.PM_RECORDS = makeSheet([PM_RECORD_HEADERS.slice()]);
}
function recCol(name) { return SHEETS.PM_RECORDS.rows[0].indexOf(name); }
function lastRec() { const r = SHEETS.PM_RECORDS.rows; return r[r.length - 1]; }
function throws(fn, re, label) {
  let msg = '';
  try { fn(); } catch (e) { msg = e.message; }
  eq(re.test(msg), true, label + (re.test(msg) ? '' : ' (got: ' + msg + ')'));
}

// --- the admin sets a reading on a plan ------------------------------------
reset();
crudPMMaster('update', { data: { pmId: 'PM-141', line: 'Lug&Screw', mcStation: 'LS-04',
  pmItem: 'ตรวจระบบจ่ายลม (FRL)', frequency: 'Monthly', active: true,
  measureName: 'แรงดันลม', measureUnit: 'MPa', measureMin: '0.4', measureMax: '0.6' } });
eq(SHEETS.PM_MASTER.rows[0].slice(-4), PM_MEASURE_HEADERS, 'the measure columns are added to PM_MASTER by name');
let p = readPMMaster().filter(x => x.pmId === 'PM-141')[0];
eq([p.measureName, p.measureUnit, p.measureMin, p.measureMax], ['แรงดันลม', 'MPa', 0.4, 0.6],
  'readPMMaster hands the spec to the form, limits as numbers');
eq(readPMMaster().filter(x => x.pmId === 'PM-001')[0].measureName, '', 'other plans ask for nothing');

crudPMMaster('update', { data: { pmId: 'PM-001', line: 'Line 5', mcStation: 'Station 5',
  pmItem: 'ทำ 5ส renamed', frequency: 'Monthly' } });
eq(readPMMaster().filter(x => x.pmId === 'PM-141')[0].measureName, 'แรงดันลม',
  'an update that does not send the block leaves it alone');

// --- sign-off ---------------------------------------------------------------
throws(() => apiSubmitPM({ pmId: 'PM-141', result: 'OK', photoBase64: 'x', shift: 'A' }, { name: 'ช่าง' }),
  /แรงดันลม/, 'a plan that asks for a reading refuses a sign-off without one');
eq(SHEETS.PM_RECORDS.rows.length, 1, 'and records nothing');
throws(() => apiSubmitPM({ pmId: 'PM-141', result: 'OK', photoBase64: 'x', shift: 'A', measureValue: 'abc' }, { name: 'ช่าง' }),
  /แรงดันลม/, 'nor with a reading that is not a number');

apiSubmitPM({ pmId: 'PM-141', result: 'OK', photoBase64: 'x', shift: 'A', measureValue: '0.55' }, { name: 'ช่าง' });
const r = lastRec();
eq([r[recCol('Measure_Name')], r[recCol('Measure_Value')], r[recCol('Measure_Unit')], r[recCol('Measure_Min')], r[recCol('Measure_Max')]],
  ['แรงดันลม', 0.55, 'MPa', 0.4, 0.6], 'the reading is recorded with the spec it was taken against');
const rec = readPMRecords()[0];
eq([rec.measureName, rec.measureValue, rec.measureUnit], ['แรงดันลม', 0.55, 'MPa'], 'and read back');

apiSubmitPM({ pmId: 'PM-001', result: 'OK', photoBase64: 'x', shift: 'A' }, { name: 'ช่าง' });
eq(lastRec()[recCol('Measure_Name')], '', 'a plan without a reading still signs off as before');

// --- clearing it -------------------------------------------------------------
crudPMMaster('update', { data: { pmId: 'PM-141', line: 'Lug&Screw', mcStation: 'LS-04',
  pmItem: 'ตรวจระบบจ่ายลม (FRL)', frequency: 'Monthly', measureName: '', measureUnit: 'MPa', measureMin: '1' } });
p = readPMMaster().filter(x => x.pmId === 'PM-141')[0];
eq([p.measureName, p.measureUnit, p.measureMin], ['', '', ''], 'a blank name clears the whole spec');

// --- bulk: optional ----------------------------------------------------------
reset();
crudPMMaster('update', { data: { pmId: 'PM-141', line: 'Lug&Screw', mcStation: 'LS-04',
  pmItem: 'FRL', frequency: 'Monthly', measureName: 'แรงดันลม', measureUnit: 'bar' } });
const ymd = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
const b = apiSubmitPMBulk({ doneDate: ymd, items: [{ pmId: 'PM-141', result: 'OK', measureValue: '5.5' },
  { pmId: 'PM-001', result: 'OK' }] }, { name: 'Admin' });
eq(b.saved, 2, 'bulk entry takes a reading but does not demand one');
eq(SHEETS.PM_RECORDS.rows[1][recCol('Measure_Value')], 5.5, 'and records it when given');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
