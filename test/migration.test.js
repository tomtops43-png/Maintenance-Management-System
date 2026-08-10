// ensureAreaConfig() rewrites rows in the owner's live CONFIG sheet, so drive
// it against a fake sheet that mirrors the real one's current state: line
// names hand-renamed to "H9 Line N", plus the MainMC/SubMC/LineBook rows the
// previous deploy seeded.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');

require('./stubs').install();

function makeSheet(rows) {
  const data = rows.map(r => r.slice());
  return {
    rows: data,
    getDataRange: () => ({ getValues: () => data.map(r => r.slice()) }),
    getLastRow: () => data.length,
    deleteRow: (n) => { data.splice(n - 1, 1); },
    getRange: (r, c, nr, nc) => ({
      setValue: (v) => { data[r - 1][c - 1] = v; },
      setValues: (vals) => {
        vals.forEach((row, i) => {
          while (data.length < r - 1 + i + 1) data.push(['', '', '', '']);
          row.forEach((v, j) => { data[r - 1 + i][c - 1 + j] = v; });
        });
      },
      getValues: () => data.slice(r - 1, r - 1 + (nr || 1)).map(x => x.slice(c - 1, c - 1 + (nc || 1)))
    })
  };
}

// The owner's sheet as it stands right now.
const sheet = makeSheet([
  ['Type', 'Value', 'Parent', 'Active'],
  ['Line', 'H9 Line 1', '', true],      // hand-renamed in Sheets
  ['Line', 'H9 Line 4', '', true],
  ['Line', 'H9 Line 5', '', true],
  ['Station', 'Station 1', '', true],
  ['Station', 'Station 21', '', true],  // added by hand
  ['Priority', 'ปกติ', '', true],
  ['Line', 'Assembly M/C', '', true],   // seeded by the superseded deploy
  ['LineBook', 'Assembly M/C', 'ASSY', true],
  ['MainMC', 'Arc chute', 'Assembly M/C', true],
  ['MainMC', 'GV.2', 'Assembly M/C', true],
  ['SubMC', 'Arc chute 06', 'Arc chute', true],
  ['SubMC', 'Arc chute 07', 'Arc chute', true],
  ['SubMC', 'Arc chute 08', 'Arc chute', true]
]);

global.getSheet = (name) => name === 'CONFIG' ? sheet : null;
global.ensureSheets = () => {};
global.getSheetOrThrow = (n) => global.getSheet(n);

eval(src
  .replace(/^function getSheet\(/m, 'function __unusedGetSheet(')
  .replace(/^function getSheetOrThrow\(/m, 'function __unusedGetSheetOrThrow(')
  .replace(/^function ensureSheets\(/m, 'function __unusedEnsureSheets('));

let fails = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; console.log('FAIL ' + label + '\n       got  ' + JSON.stringify(actual) + '\n       want ' + JSON.stringify(expected)); }
  else console.log('ok   ' + label);
}
const rowsOf = (type) => sheet.rows.filter(r => r[0] === type).map(r => [r[1], r[2]]);

eq(ensureAreaConfig(), true, 'migration reports that it changed something');

eq(rowsOf('Line'), [
  ['Line 1', 'ENC H9'], ['Line 4', 'ENC H9'], ['Line 5', 'ENC H9'],
  ['Arc chute', 'Assembly M/C'], ['GV.2', 'Assembly M/C']
], 'H9 prefix undone, ENC lines adopted, Assembly machines added as lines');

eq(rowsOf('Area'), [['ENC H9', ''], ['Assembly M/C', 'ASSY']], 'both ไลน์หลัก present');
eq(rowsOf('LineBook'), [], 'obsolete LineBook rows gone');
eq(rowsOf('MainMC'), [], 'obsolete MainMC rows gone');
eq(rowsOf('SubMC'), [], 'obsolete SubMC rows gone');
eq(rowsOf('Station'), [
  ['Station 1', ''], ['Station 21', ''],
  ['Arc chute 06', 'Arc chute'], ['Arc chute 07', 'Arc chute'], ['Arc chute 08', 'Arc chute']
], 'hand-added stations untouched, sub-machines re-parented');
eq(rowsOf('Priority'), [['ปกติ', '']], 'unrelated rows never touched');

// Idempotence: running setup twice must not duplicate or re-mangle anything.
const after = JSON.stringify(sheet.rows);
eq(ensureAreaConfig(), false, 'second run reports no change');
eq(JSON.stringify(sheet.rows), after, 'second run leaves the sheet byte-identical');

// And the resulting config is what the BM form needs.
_areaBookCache = null; _lineAreaCache = null;
const cfg = apiGetConfig();
eq(cfg.Area, ['ENC H9', 'Assembly M/C'], 'ไลน์หลัก dropdown');
eq(cfg.LinesByArea['ENC H9'], ['Line 1', 'Line 4', 'Line 5'], 'ENC H9 lines are back to their historical names');
eq(cfg.LinesByArea['Assembly M/C'], ['Arc chute', 'GV.2'], 'Assembly M/C machines');
eq(cfg.StationsByLine['Arc chute'], ['Arc chute 06', 'Arc chute 07', 'Arc chute 08'], 'Arc chute sub-machines');
eq(cfg.SharedStations, ['Station 1', 'Station 21'], 'ENC stations stay shared across its lines');
eq(bookForArea('Assembly M/C').req, 'Record แจ้งซ่อม ASSY', 'routing still lands on the ASSY sheet');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
