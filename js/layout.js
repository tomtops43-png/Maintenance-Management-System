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
    history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l3 2"/></svg>'
  };

  var NAV = [
    { id: 'index',     href: 'index.html',     label: 'แจ้งซ่อม',   icon: 'report' },
    { id: 'jobs',      href: 'jobs.html',      label: 'บอร์ดงาน',   icon: 'jobs' },
    { id: 'pm',        href: 'pm.html',        label: 'PM',         icon: 'pm' },
    { id: 'dashboard', href: 'dashboard.html', label: 'Dashboard',  icon: 'dashboard' },
    { id: 'history',   href: 'history.html',   label: 'ประวัติย้อนหลัง', icon: 'history' },
    { id: 'admin',     href: 'admin.html',     label: 'Settings',   icon: 'admin' }
  ];

  function build() {
    var active = document.body.getAttribute('data-page') || '';
    var title = document.body.getAttribute('data-title') || 'Maintenance System ENC H9';
    var u = (window.Auth && Auth.get()) || null;

    var navHtml = NAV.map(function (n) {
      return '<a href="' + n.href + '" class="side-link' + (n.id === active ? ' active' : '') + '">' +
        '<span class="side-ico">' + ICONS[n.icon] + '</span><span>' + n.label + '</span></a>';
    }).join('');

    var userHtml = u && u.name
      ? '<div class="side-user"><div class="su-avatar">' + esc(u.name.charAt(0)) + '</div>' +
          '<div class="su-info"><div class="su-name">' + esc(u.name) + '</div>' +
          '<div class="su-role">' + esc(u.role || 'ผู้ใช้งาน') + '</div></div>' +
          '<button class="su-logout" id="sideLogout" title="ออกจากระบบ">' + ICONS.logout + '</button></div>'
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

    // Bottom navigation (mobile only via CSS) — 4 primary destinations.
    var BOTTOM = [
      { id: 'index',     href: 'index.html',     label: 'แจ้งซ่อม', icon: 'report' },
      { id: 'jobs',      href: 'jobs.html',      label: 'งานซ่อม',  icon: 'jobs' },
      { id: 'pm',        href: 'pm.html',        label: 'PM',       icon: 'pm' },
      { id: 'dashboard', href: 'dashboard.html', label: 'สรุป',     icon: 'dashboard' }
    ];
    var bottom = document.createElement('nav');
    bottom.className = 'bottom-nav';
    bottom.innerHTML = BOTTOM.map(function (n) {
      return '<a href="' + n.href + '" class="' + (n.id === active ? 'active' : '') + '">' +
        '<span class="bn-ico">' + ICONS[n.icon] + '</span><span>' + n.label + '</span></a>';
    }).join('');
    document.body.appendChild(bottom);

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

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  document.addEventListener('DOMContentLoaded', build);
})();
