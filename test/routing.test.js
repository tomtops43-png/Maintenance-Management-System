// Exercise the pure area/book routing helpers out of Code.gs with the Google
// services stubbed, so a wrong prefix, parent or fallback shows up here
// rather than on the shop floor.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');

global.Logger = { log: () => {} };

// CONFIG as it looks AFTER ensureAreaConfig() has migrated a live sheet:
// H9-prefixed line names undone, every line adopted into an area.
let CONFIG_ROWS = [
  ['Type', 'Value', 'Parent', 'Active'],
  ['Line', 'Line 1', 'ENC H9', true],
  ['Line', 'Line 4', 'ENC H9', true],
  ['Line', 'Line 5', 'ENC H9', true],
  ['Station', 'Station 1', '', true],
  ['Station', 'Station 10', '', true],
  ['Station', 'อื่นๆ', '', true],
  ['Area', 'ENC H9', '', true],
  ['Area', 'Assembly M/C', 'ASSY', true],
  ['Line', 'Arc chute', 'Assembly M/C', true],
  ['Line', 'GV.2', 'Assembly M/C', true],
  ['Station', 'Arc chute 06', 'Arc chute', true],
  ['Station', 'Arc chute 07', 'Arc chute', true],
  ['Priority', 'ปกติ', '', true],
  ['Setting', '8', 'ShiftA_StartHour', true]
];
global.getSheet = (name) => name === 'CONFIG'
  ? { getDataRange: () => ({ getValues: () => CONFIG_ROWS }) }
  : null;
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

// --- area -> book ---------------------------------------------------------
eq(bookForArea('Assembly M/C').key, 'ASSY', 'Assembly area routes to ASSY book');
eq(bookForArea('ENC H9').key, 'ENC', 'ENC area routes to ENC book');
eq(bookForArea('').key, 'ENC', 'blank area falls back to default book');
eq(bookForArea('โรงใหม่').key, 'ENC', 'unknown area falls back to default book');
eq(bookForArea('Assembly M/C').req, 'Record แจ้งซ่อม ASSY', 'ASSY writes to its own request sheet');
eq(defaultAreaName(), 'ENC H9', 'default area resolves from CONFIG');

// --- line -> area (for records that only carry a line) ---------------------
eq(areaForLine('Line 4'), 'ENC H9', 'ENC line maps back to its area');
eq(areaForLine('Arc chute'), 'Assembly M/C', 'Assembly machine maps back to its area');
eq(areaForLine('ไม่รู้จัก'), 'ENC H9', 'unknown line falls back to the default area');

// --- MT Job No ------------------------------------------------------------
eq(bookForMTJob('AS-06082026-3').key, 'ASSY', 'AS- prefixed job resolves to ASSY');
eq(bookForMTJob('06082026-3').key, 'ENC', 'bare job resolves to ENC');
eq(isValidMTJob('06082026-1'), true, 'legacy number is valid');
eq(isValidMTJob('AS-06082026-12'), true, 'prefixed number is valid');
eq(isValidMTJob('รวม'), false, 'junk row rejected');
eq(mtJobRe(BOOKS.ENC).test('AS-06082026-1'), false, 'ENC regex does not swallow ASSY jobs');
eq(mtJobRe(BOOKS.ASSY).test('06082026-1'), false, 'ASSY regex does not swallow ENC jobs');

const encSheet = { getLastRow: () => 3, getRange: () => ({ getValues: () => [['06082026-1'], ['06082026-2']] }) };
eq(generateMTJobNo(encSheet, new Date(2026, 7, 6), BOOKS.ENC), '06082026-3', 'ENC continues its own sequence');
const assySheet = { getLastRow: () => 2, getRange: () => ({ getValues: () => [['AS-06082026-4']] }) };
eq(generateMTJobNo(assySheet, new Date(2026, 7, 6), BOOKS.ASSY), 'AS-06082026-5', 'ASSY numbers independently');

Object.keys(BOOKS).forEach(function (k) {
  if (k === DEFAULT_BOOK) return;
  eq(!!BOOKS[k].prefix, true, k + ' has a non-empty MT prefix');
});

// --- config shaping -------------------------------------------------------
const cfg = apiGetConfig();
eq(cfg.Area, ['ENC H9', 'Assembly M/C'], 'ไลน์หลัก list');
eq(cfg.LinesByArea['ENC H9'], ['Line 1', 'Line 4', 'Line 5'], 'ENC H9 keeps its three lines');
eq(cfg.LinesByArea['Assembly M/C'], ['Arc chute', 'GV.2'], 'Assembly M/C lists its main machines');
eq(cfg.StationsByLine['Arc chute'], ['Arc chute 06', 'Arc chute 07'], 'sub-machines hang off their main machine');
eq(cfg.StationsByLine['Line 4'], undefined, 'ENC lines declare no machines of their own');
eq(cfg.SharedStations, ['Station 1', 'Station 10', 'อื่นๆ'], 'blank-parent stations are the shared pool');
eq(cfg.DefaultArea, 'ENC H9', 'DefaultArea exposed to the client');
eq(cfg.AreaOfLine['Arc chute'], 'Assembly M/C', 'AreaOfLine lets a PM handoff find its area');
eq(cfg.Line, ['Line 1', 'Line 4', 'Line 5', 'Arc chute', 'GV.2'], 'flat Line list still covers everything');
eq(cfg.AllMachines, ['Station 1', 'Station 10', 'อื่นๆ', 'Arc chute 06', 'Arc chute 07'], 'AllMachines covers both shapes');

// --- the picker rule the BM form implements -------------------------------
// Mirrors machinesFor() in js/bm.js; kept here so a change to the rule on
// either side shows up as a disagreement.
function machinesFor(area, line) {
  if (!line) return [];
  const own = cfg.StationsByLine[line] || [];
  if (own.length) return own;
  if (area === cfg.DefaultArea) return cfg.SharedStations;
  return [line];
}
eq(machinesFor('ENC H9', 'Line 4'), ['Station 1', 'Station 10', 'อื่นๆ'], 'ENC line still sees every shared station');
eq(machinesFor('Assembly M/C', 'Arc chute'), ['Arc chute 06', 'Arc chute 07'], 'Arc chute sees only its own machines');
eq(machinesFor('Assembly M/C', 'GV.2'), ['GV.2'], 'a machine-less line stands in for itself, not ENC stations');
eq(machinesFor('ENC H9', ''), [], 'nothing offered before a line is picked');

// --- LINE alert label -----------------------------------------------------
eq(machineLabel({ area: 'ENC H9', line: 'Line 4', mc: 'Station 10' }), 'ENC H9 / Line 4 / Station 10', 'full path in the alert');
eq(machineLabel({ area: '', line: 'Line 4', mc: 'Station 10' }), 'Line 4 / Station 10', 'legacy row with no area still reads fine');
eq(machineLabel({ area: 'Assembly M/C', line: 'GV.2', mc: 'GV.2' }), 'Assembly M/C / GV.2', 'repeated level is not printed twice');
eq(machineLabel({}), '-', 'empty job degrades to a dash');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall ' + '' + 'passed');
process.exit(fails ? 1 : 0);
