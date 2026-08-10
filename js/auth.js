/* Simple auth. Stored in localStorage so a login persists on the device
   across app/PWA restarts (log in once per phone, stays logged in). */
(function () {
  var KEY = 'mms_user';

  function get() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); }
    catch (e) { return null; }
  }
  function set(user) { localStorage.setItem(KEY, JSON.stringify(user)); }
  function clear() { localStorage.removeItem(KEY); }
  /** A stored login without a session token is one from before the server
   * started verifying identity — it can't authorise anything, so treat it as
   * signed out and get a real session instead of failing later mid-task. */
  function isLoggedIn() { var u = get(); return !!(u && u.name && u.token); }
  function hasRole(roles) { var u = get(); return u && roles.indexOf(u.role) >= 0; }

  /* ---- Role-based permissions ----------------------------------------
     Real roles in the sheet (Admin, Leader A/B, Leader Technician A/B,
     Technician) collapse into 3 functional groups:
       admin  — full access
       tech   — ผู้ซ่อม (fixers): board actions + PM
       leader — หัวหน้ากะ (reporters): report + view board only
     Order matters: "Leader Technician" is a fixer, so match Technician
     before Leader. Unknown roles default to the least-privileged group. */
  function roleGroup(role) {
    var r = String(role || '').toLowerCase();
    if (r.indexOf('admin') >= 0) return 'admin';
    if (r.indexOf('technician') >= 0 || r.indexOf('engineer') >= 0) return 'tech';
    if (r.indexOf('leader') >= 0 || r.indexOf('supervisor') >= 0 || r.indexOf('manager') >= 0) return 'leader';
    return 'leader';
  }
  function myGroup() { var u = get(); return u ? roleGroup(u.role) : null; }

  var PAGE_ACCESS = {
    admin:  ['index', 'jobs', 'pm', 'dashboard', 'admin', 'kb', 'machine'],
    tech:   ['index', 'jobs', 'pm', 'kb', 'machine'],
    // หัวหน้ากะ report and watch; a machine's own history is read-only, and
    // knowing what this machine keeps doing is exactly what they need to
    // decide whether to escalate.
    leader: ['index', 'jobs', 'kb', 'machine']
  };
  function canPage(pageId) {
    var g = myGroup();
    return !!(g && PAGE_ACCESS[g] && PAGE_ACCESS[g].indexOf(pageId) >= 0);
  }
  /** Can accept / start / close jobs on the board. */
  function canWorkJobs() { var g = myGroup(); return g === 'tech' || g === 'admin'; }
  /** Landing page after login, per group. */
  function homePage() {
    var g = myGroup();
    if (g === 'admin') return 'dashboard.html';
    if (g === 'tech') return 'jobs.html';
    return 'index.html';
  }

  async function login(payload) {
    var user = await window.API.call('login', payload);
    set(user); // includes the session token the server issued
    return user;
  }

  /** Revoke the session server-side too, so a token copied off a shared phone
   * stops working the moment someone logs out. Best-effort: a failed call
   * must never leave someone stuck logged in on the device in front of them. */
  async function logout() {
    try { await window.API.call('logout', {}); } catch (e) {}
    clear();
    location.href = 'login.html';
  }

  /** Redirect to login.html if not authenticated. */
  function requireLogin() {
    if (!isLoggedIn()) {
      var back = encodeURIComponent(location.pathname.split('/').pop() || 'index.html');
      location.href = 'login.html?next=' + back;
      return false;
    }
    return true;
  }

  function renderUserBadge(elId) {
    var el = document.getElementById(elId || 'userBadge');
    if (!el) return;
    var u = get();
    if (u && u.name) {
      el.innerHTML = '<span class="user-name">' + window.U.escapeHtml(u.name) +
        '</span><span class="user-role">' + window.U.escapeHtml(u.role || '') + '</span>' +
        '<button class="btn-link" id="logoutBtn">ออก</button>';
      var b = document.getElementById('logoutBtn');
      if (b) b.onclick = logout;
    } else {
      el.innerHTML = '<a class="btn-link" href="login.html">เข้าสู่ระบบ</a>';
    }
  }

  window.Auth = {
    get: get, set: set, clear: clear, isLoggedIn: isLoggedIn, hasRole: hasRole,
    login: login, logout: logout, requireLogin: requireLogin, renderUserBadge: renderUserBadge,
    roleGroup: roleGroup, myGroup: myGroup, canPage: canPage,
    canWorkJobs: canWorkJobs, homePage: homePage
  };
})();
