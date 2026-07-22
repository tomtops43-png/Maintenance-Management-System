/* Shared app shell: builds the sidebar + topbar for every page from one place.
 * Each page sets  <body data-page="jobs" data-title="บอร์ดงานซ่อม">  and this
 * script injects the chrome and moves the page's .container into the content
 * area. Login page opts out by not including this file. */
(function () {
  var ICONS = {
    report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    jobs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="6" height="16" rx="1"/><rect x="14" y="4" width="6" height="9" rx="1"/></svg>',
    pm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M9 15l2 2 4-4"/></svg>',
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="6"/><rect x="12" y="7" width="3" height="10"/><rect x="17" y="13" width="3" height="4"/></svg>',
    admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h18M3 6h18M3 18h18"/></svg>',
    kb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>'
  };

  var NAV = [
    { id: 'index',     href: 'index.html',     label: 'แจ้งซ่อม',   icon: 'report' },
    { id: 'jobs',      href: 'jobs.html',      label: 'บอร์ดงาน',   icon: 'jobs' },
    { id: 'pm',        href: 'pm.html',        label: 'PM',         icon: 'pm' },
    { id: 'kb',        href: 'kb.html',        label: 'คลังความรู้', icon: 'kb' },
    { id: 'dashboard', href: 'dashboard.html', label: 'Dashboard',  icon: 'dashboard' },
    { id: 'admin',     href: 'admin.html',     label: 'Settings',   icon: 'admin' }
  ];

  // Real "still open" statuses a job can hold on the board (js/jobs.js
  // GROUPS) — anything else (blank, stray legacy values) isn't a job a
  // technician can act on, so it shouldn't count as "pending" here either.
  var OPEN_JOB_STATUSES = ['แจ้งซ่อม', 'รับงานแล้ว', 'กำลังซ่อม', 'รออะไหล่'];

  // Nav ids that can carry an overdue-count badge, and how to compute each
  // count from its API payload. Kept data-driven so adding another alert
  // later is a one-line addition, not new plumbing.
  var NAV_ALERTS = {
    jobs: { action: 'getBMJobs', payload: {}, count: function (jobs) {
      return jobs.filter(function (j) { return OPEN_JOB_STATUSES.indexOf(j.status) >= 0; }).length;
    } },
    pm: { action: 'getPMDue', payload: {}, count: function (due) {
      return due.filter(function (p) { return p.overdue; }).length;
    } }
  };

  function build() {
    // Gate 1: every page that uses the app shell requires login. If there's
    // no session, bounce to the login screen (login.html doesn't include
    // this script, so there's no redirect loop).
    if (window.Auth && !Auth.isLoggedIn()) {
      var here = location.pathname.split('/').pop() || 'index.html';
      location.replace('login.html?next=' + encodeURIComponent(here));
      return;
    }

    var active = document.body.getAttribute('data-page') || '';

    // Gate 2: role-based page access. If this role can't see this page,
    // send it to that role's home page (which it always can see).
    if (window.Auth && active && !Auth.canPage(active)) {
      location.replace(Auth.homePage());
      return;
    }

    var title = document.body.getAttribute('data-title') || 'Maintenance System ENC H9';
    var u = (window.Auth && Auth.get()) || null;

    var allowedNav = NAV.filter(function (n) { return !window.Auth || Auth.canPage(n.id); });
    var navHtml = allowedNav.map(function (n) {
      return '<a href="' + n.href + '" class="side-link' + (n.id === active ? ' active' : '') + '">' +
        '<span class="side-ico">' + ICONS[n.icon] + '</span><span>' + n.label + '</span>' +
        (NAV_ALERTS[n.id] ? '<span class="side-badge" data-nav-badge="' + n.id + '"></span>' : '') +
        '</a>';
    }).join('');

    var userHtml = u && u.name
      ? '<div class="side-user"><div class="su-avatar">' + esc(u.name.charAt(0)) + '</div>' +
          '<div class="su-info"><div class="su-name">' + esc(u.name) + '</div>' +
          '<div class="su-role">' + esc(u.role || 'ผู้ใช้งาน') + '</div></div></div>' +
          '<button class="side-logout-btn" id="sideLogout"><span class="side-ico">' + ICONS.logout + '</span><span>ออกจากระบบ</span></button>'
      : '<a class="side-login" href="login.html"><span class="side-ico">' + ICONS.logout + '</span><span>เข้าสู่ระบบ</span></a>';

    var todayTh = (window.U ? U.thaiDate(new Date()) : '');

    var shell = document.createElement('div');
    shell.className = 'app-shell';
    shell.innerHTML =
      '<aside class="sidebar" id="sidebar">' +
        '<div class="brand"><span class="brand-mark">🛠️</span><span class="brand-text">ENC H9<small>Maintenance System</small></span></div>' +
        '<nav class="side-nav">' + navHtml + '</nav>' +
        '<div class="side-foot">' + userHtml + '</div>' +
      '</aside>' +
      '<div class="scrim" id="scrim"></div>' +
      '<div class="main">' +
        '<header class="topbar">' +
          '<button class="icon-btn menu-toggle" id="menuToggle" aria-label="เมนู">' + ICONS.menu + '</button>' +
          '<h1 class="page-title">' + esc(title) + '</h1>' +
          '<div class="topbar-spacer"></div>' +
          '<div class="top-date">' + esc(todayTh) + '</div>' +
        '</header>' +
        '<main class="content" id="contentArea"></main>' +
      '</div>';

    var progressBar = document.createElement('div');
    progressBar.id = 'topProgress';
    document.body.insertBefore(progressBar, document.body.firstChild);
    document.body.insertBefore(shell, document.body.firstChild);

    // Bottom navigation (mobile only via CSS) — 5 primary destinations.
    var BOTTOM = [
      { id: 'index',     href: 'index.html',     label: 'แจ้งซ่อม', icon: 'report' },
      { id: 'jobs',      href: 'jobs.html',      label: 'งานซ่อม',  icon: 'jobs' },
      { id: 'pm',        href: 'pm.html',        label: 'PM',       icon: 'pm' },
      { id: 'kb',        href: 'kb.html',        label: 'KB',       icon: 'kb' },
      { id: 'dashboard', href: 'dashboard.html', label: 'สรุป',     icon: 'dashboard' }
    ];
    var allowedBottom = BOTTOM.filter(function (n) { return !window.Auth || Auth.canPage(n.id); });
    var bottom = document.createElement('nav');
    bottom.className = 'bottom-nav';
    bottom.innerHTML = allowedBottom.map(function (n) {
      return '<a href="' + n.href + '" class="' + (n.id === active ? 'active' : '') + '">' +
        '<span class="bn-ico">' + ICONS[n.icon] +
        (NAV_ALERTS[n.id] ? '<span class="bn-badge" data-nav-badge-bn="' + n.id + '"></span>' : '') +
        '</span><span>' + n.label + '</span></a>';
    }).join('');
    document.body.appendChild(bottom);

    loadAlertBadges(allowedNav, allowedBottom);

    // Move existing page containers into the content area.
    var content = shell.querySelector('#contentArea');
    var containers = [];
    document.querySelectorAll('body > .container').forEach(function (c) { containers.push(c); });
    containers.forEach(function (c) { content.appendChild(c); });

    // Mobile drawer wiring
    var sidebar = shell.querySelector('#sidebar');
    var scrim = shell.querySelector('#scrim');
    function openNav() { sidebar.classList.add('open'); scrim.classList.add('show'); }
    function closeNav() { sidebar.classList.remove('open'); scrim.classList.remove('show'); }
    shell.querySelector('#menuToggle').onclick = openNav;
    scrim.onclick = closeNav;
    sidebar.querySelectorAll('.side-link').forEach(function (a) { a.addEventListener('click', closeNav); });

    var logout = shell.querySelector('#sideLogout');
    if (logout) logout.onclick = function () {
      if (window.Auth) Auth.clear();
      location.href = 'login.html';
    };
  }

  /** Fetch overdue counts (per NAV_ALERTS) and fill in the badges for
   * whichever alert-bearing nav items are actually visible to this user.
   * Best-effort: a failed count just leaves that badge hidden. */
  function loadAlertBadges(allowedNav, allowedBottom) {
    if (!window.API) return;
    var ids = Object.keys(NAV_ALERTS).filter(function (id) {
      return allowedNav.some(function (n) { return n.id === id; }) ||
        allowedBottom.some(function (n) { return n.id === id; });
    });
    ids.forEach(function (id) {
      var alert = NAV_ALERTS[id];
      window.API.call(alert.action, alert.payload).then(function (data) {
        var n = alert.count(data) || 0;
        document.querySelectorAll('[data-nav-badge="' + id + '"]').forEach(function (el) {
          el.textContent = n > 99 ? '99+' : String(n);
          el.classList.toggle('show', n > 0);
        });
        document.querySelectorAll('[data-nav-badge-bn="' + id + '"]').forEach(function (el) {
          el.textContent = n > 9 ? '9+' : String(n);
          el.classList.toggle('show', n > 0);
        });
      }).catch(function () { /* leave badge hidden */ });
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  document.addEventListener('DOMContentLoaded', build);
})();
