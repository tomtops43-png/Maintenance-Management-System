// Drive requireAdmin() the way an attacker would: this Web App is public and
// its URL ships in js/config.js, so the `user` object on a request is entirely
// under the caller's control. Every claim in it must be worthless on its own.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');

const stubs = require('./stubs');
stubs.install();
const cacheStore = stubs.state.cache; // token -> Emp_ID; poked at directly below

const DAY = 86400000;
let USERS = [
  ['Emp_ID', 'Name', 'Role', 'Line', 'PIN', 'Shift'],
  ['0001', 'ผู้ดูแลระบบ', 'Admin', '', '1234', 'A'],
  ['0002', 'ช่างสมชาย', 'Technician', 'Line 1', '1111', 'A']
];
let SESSIONS = [['Token', 'Emp_ID', 'Created', 'Expires']];

function sheetFor(rows) {
  return {
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
    getLastRow: () => rows.length,
    getLastColumn: () => Math.max.apply(null, rows.map(r => r.length)),
    appendRow: (r) => rows.push(r.slice()),
    deleteRow: (n) => rows.splice(n - 1, 1),
    getRange: (r, c, nr, nc) => ({
      getValue: () => rows[r - 1][c - 1],
      setValue: (v) => { rows[r - 1][c - 1] = v; },
      getValues: () => rows.slice(r - 1, r - 1 + (nr || 1)).map(x => x.slice(c - 1, c - 1 + (nc || 1))),
      setNumberFormat: () => {}
    }),
    setFrozenRows: () => {}
  };
}
global.getSheet = (n) => n === 'USERS' ? sheetFor(USERS) : (n === 'SESSIONS' ? sheetFor(SESSIONS) : null);
global.getSheetOrThrow = (n) => { const s = global.getSheet(n); if (!s) throw new Error('no sheet ' + n); return s; };
global.ensureSheets = () => {};

eval(src
  .replace(/^function getSheet\(/m, 'function __x1(')
  .replace(/^function getSheetOrThrow\(/m, 'function __x2(')
  .replace(/^function ensureSheets\(/m, 'function __x3('));

let fails = 0;
function check(label, fn, expect) {
  let got;
  try { got = { ok: true, value: fn() }; }
  catch (e) { got = { ok: false, error: e.message }; }
  const pass = expect(got);
  if (pass) console.log('ok   ' + label);
  else { fails++; console.log('FAIL ' + label + ' -> ' + JSON.stringify(got)); }
}
const denied = (g) => !g.ok && g.error.indexOf('ไม่มีสิทธิ์') >= 0;
const expired = (g) => !g.ok && g.error.indexOf('[SESSION_EXPIRED]') >= 0;

// --- the actual exploit ---------------------------------------------------
check('claiming role=Admin with no token is refused',
  () => requireAdmin({ empId: '0002', name: 'ใครก็ได้', role: 'Admin' }), expired);
check('claiming role=Admin with a made-up token is refused',
  () => requireAdmin({ role: 'Admin', token: 'ฉันขอเป็นแอดมิน' }), expired);
check('empty user object is refused',
  () => requireAdmin({}), expired);
check('no user at all is refused',
  () => requireAdmin(undefined), expired);

// --- a real technician cannot escalate ------------------------------------
const techToken = issueSession('0002');
check('technician with a valid token is denied admin',
  () => requireAdmin({ token: techToken }), denied);
check('technician cannot escalate by also claiming role=Admin',
  () => requireAdmin({ token: techToken, role: 'Admin', name: 'ผู้ดูแลระบบ' }), denied);

// --- a real admin still works --------------------------------------------
const adminToken = issueSession('0001');
check('admin with a valid token is allowed',
  () => requireAdmin({ token: adminToken }).empId, (g) => g.ok && g.value === '0001');
check('role comes from the sheet, not the request',
  () => requireAdmin({ token: adminToken, role: 'Technician', name: 'ปลอม' }).name,
  (g) => g.ok && g.value === 'ผู้ดูแลระบบ');

// --- demoting someone in the sheet takes effect on their next call --------
USERS[1][2] = 'Technician';           // admin demoted by hand in the sheet
delete cacheStore['sess_' + adminToken]; // (cache holds token->empId, not the role)
check('a demoted admin loses access without re-logging-in',
  () => requireAdmin({ token: adminToken }), denied);
USERS[1][2] = 'Admin';

// --- expiry and revocation ------------------------------------------------
SESSIONS.push(['tok-old', '0001', new Date(Date.now() - 40 * DAY), new Date(Date.now() - 10 * DAY)]);
check('an expired token is refused', () => requireAdmin({ token: 'tok-old' }), expired);
check('purge drops the expired row', () => purgeExpiredSessions(), (g) => g.ok && g.value === 1);

check('logout revokes the token', () => revokeSession(adminToken), (g) => g.ok && g.value === true);
check('the revoked token no longer authorises', () => requireAdmin({ token: adminToken }), expired);

// --- login hands back a usable token --------------------------------------
const session = apiLogin({ empId: '0001', pin: '1234' });
check('login issues a token', () => session.token, (g) => g.ok && !!g.value);
check('login never returns the PIN', () => session.pin, (g) => g.ok && g.value === undefined);
check('the freshly issued token authorises',
  () => requireAdmin({ token: session.token }).empId, (g) => g.ok && g.value === '0001');
check('a wrong PIN issues nothing',
  () => apiLogin({ empId: '0001', pin: '9999' }), (g) => !g.ok);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
