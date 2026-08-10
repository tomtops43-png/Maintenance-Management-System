/*
 * Minimal stand-ins for the Google Apps Script globals Code.gs reaches for.
 *
 * Apps Script can't run locally, so each test eval's gas/Code.gs in this
 * process. Anything the code under test touches has to exist here first —
 * these are deliberately dumb in-memory versions, not emulations: a test that
 * needs specific sheet behaviour builds its own sheet object and passes it in.
 */
const state = {
  properties: {},
  cache: {},
  uuidCounter: 0,
  logs: []
};

function install() {
  global.Logger = { log: (m) => state.logs.push(m) };

  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in state.properties ? state.properties[k] : null),
      setProperty: (k, v) => { state.properties[k] = String(v); },
      deleteProperty: (k) => { delete state.properties[k]; }
    })
  };

  global.CacheService = {
    getScriptCache: () => ({
      get: (k) => (k in state.cache ? state.cache[k] : null),
      put: (k, v) => { state.cache[k] = String(v); },
      remove: (k) => { delete state.cache[k]; }
    })
  };

  global.Utilities = {
    getUuid: () => 'tok-' + (++state.uuidCounter),
    base64Decode: (s) => Buffer.from(s, 'base64'),
    newBlob: (bytes, mime, name) => ({ bytes, mime, name })
  };

  // Overridden per test where the test actually cares about sheet contents.
  global.getSheet = () => null;
  global.getSheetOrThrow = (n) => { throw new Error('no sheet ' + n); };
  global.ensureSheets = () => {};
}

/** Load Code.gs with the named top-level functions neutered, so a test's own
 * global stub of the same name is what the code ends up calling. */
function loadCodeGs(replaceFunctions) {
  const fs = require('fs');
  const path = require('path');
  let src = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');
  (replaceFunctions || []).forEach((name, i) => {
    src = src.replace(new RegExp('^function ' + name + '\\(', 'm'), 'function __stubbed' + i + '(');
  });
  return src;
}

module.exports = { install, loadCodeGs, state };
