// ensureSheetWithHeaders() exists because of a real failure: creating the
// SESSIONS sheet timed out *between* insertSheet() and the header write,
// leaving an empty sheet that every later run skipped as "already there".
const stubs = require('./stubs');
stubs.install();
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');

let SHEETS = {};

function makeSheet(rows) {
  const data = rows.map(r => r.slice());
  return {
    rows: data,
    frozen: 0,
    getLastRow: () => data.length,
    getLastColumn: () => Math.max(1, ...data.map(r => r.length)),
    setFrozenRows: function (n) { this.frozen = n; },
    getRange: (r, c, nr, nc) => ({
      getValue: () => (data[r - 1] || [])[c - 1],
      setValue: (v) => { while (data.length < r) data.push([]); data[r - 1][c - 1] = v; },
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

const ss = {
  inserted: [],
  insertSheet: function (name) {
    this.inserted.push(name);
    SHEETS[name] = makeSheet([]);       // brand new sheet: no rows at all
    return SHEETS[name];
  }
};

global.getSheet = (name) => SHEETS[name] || null;

eval(src
  .replace(/^function getSheet\(/m, 'function __x1(')
  .replace(/^function getSheetOrThrow\(/m, 'function __x2('));

let fails = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; console.log('FAIL ' + label + '\n       got  ' + JSON.stringify(actual) + '\n       want ' + JSON.stringify(expected)); }
  else console.log('ok   ' + label);
}

const HEAD = ['Token', 'Emp_ID', 'Created', 'Expires'];

// 1. Missing sheet: created and headed.
eq(ensureSheetWithHeaders(ss, 'SESSIONS', HEAD), true, 'missing sheet is created');
eq(SHEETS.SESSIONS.rows[0], HEAD, 'headers written on create');
eq(SHEETS.SESSIONS.frozen, 1, 'header row frozen');

// 2. Re-running changes nothing.
eq(ensureSheetWithHeaders(ss, 'SESSIONS', HEAD), false, 'second run is a no-op');
eq(ss.inserted.length, 1, 'no duplicate sheet inserted');

// 3. The actual bug: sheet exists but the header write never landed.
SHEETS.SESSIONS = makeSheet([]);
eq(ensureSheetWithHeaders(ss, 'SESSIONS', HEAD), true, 'an empty leftover sheet is repaired, not skipped');
eq(SHEETS.SESSIONS.rows[0], HEAD, 'headers filled in on repair');
eq(ss.inserted.length, 1, 'repair reuses the existing sheet');

// 4. A sheet with real data is never touched.
SHEETS.SESSIONS = makeSheet([HEAD, ['tok-1', '0001', 'x', 'y']]);
eq(ensureSheetWithHeaders(ss, 'SESSIONS', HEAD), false, 'populated sheet left alone');
eq(SHEETS.SESSIONS.rows.length, 2, 'its data survives');

// 5. Headers present but blank-ish A1 (a hand-cleared cell) still repairs.
SHEETS.SESSIONS = makeSheet([['   ', 'Emp_ID', 'Created', 'Expires']]);
eq(ensureSheetWithHeaders(ss, 'SESSIONS', HEAD), true, 'whitespace-only A1 counts as missing');
eq(SHEETS.SESSIONS.rows[0], HEAD, 'header row rewritten');

// 6. The setup stamp only lands after a full successful pass.
const props = PropertiesService.getScriptProperties();
props.deleteProperty(SETUP_PROP);
eq(props.getProperty(SETUP_PROP), null, 'no stamp before setup runs');
eq(typeof SETUP_VERSION, 'string', 'a setup version is defined to stamp with');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
