/* Simple session auth stored in sessionStorage. */
(function () {
  var KEY = 'mms_user';

  function get() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); }
    catch (e) { return null; }
  }
  function set(user) { sessionStorage.setItem(KEY, JSON.stringify(user)); }
  function clear() { sessionStorage.removeItem(KEY); }
  function isLoggedIn() { var u = get(); return !!(u && u.name); }
  function hasRole(roles) { var u = get(); return u && roles.indexOf(u.role) >= 0; }

  async function login(payload) {
    var user = await window.API.call('login', payload);
    set(user);
    return user;
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
      if (b) b.onclick = function () { clear(); location.href = 'login.html'; };
    } else {
      el.innerHTML = '<a class="btn-link" href="login.html">เข้าสู่ระบบ</a>';
    }
  }

  window.Auth = {
    get: get, set: set, clear: clear, isLoggedIn: isLoggedIn, hasRole: hasRole,
    login: login, requireLogin: requireLogin, renderUserBadge: renderUserBadge
  };
})();
