/* kb.html — Knowledge Base browse (Step 2: read-only; search/filter chips come later) */
(function () {
  var CACHE_KEY = 'mms_kb_list';
  var CACHE_MIN = 10;
  var CAT_ICON = { Repair_Case: '🔧', PM_Tips: '🧠', Safety: '⚠️', Machine_Manual: '📖', Troubleshoot: '🔍' };

  function catIcon(c) { return CAT_ICON[c] || '📄'; }

  function badges(a) {
    var out = '<span class="pill">' + U.escapeHtml(a.line) + '</span>';
    if (a.station && a.station !== 'ทุก Station') out += '<span class="pill">' + U.escapeHtml(a.station) + '</span>';
    return out;
  }

  function cardHtml(a) {
    return '<a class="kb-card" href="kb-detail.html?id=' + encodeURIComponent(a.kbId) + '">' +
      '<div class="kb-cat-icon">' + catIcon(a.category) + '</div>' +
      '<h4>' + U.escapeHtml(a.title) + '</h4>' +
      '<div class="kb-badges">' + badges(a) + '</div>' +
      '<div class="kb-problem">' + U.escapeHtml(a.problem || '') + '</div>' +
      '<div class="kb-views">👁️ ' + a.views + ' ครั้ง</div>' +
      '</a>';
  }

  function section(id, icon, title, list) {
    var el = document.getElementById(id);
    if (!list.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="kb-section"><div class="kb-section-title">' + icon + ' ' + title + '</div>' +
      '<div class="kb-row">' + list.map(cardHtml).join('') + '</div></div>';
  }

  /** sessionStorage cache so repeat visits (and switching back from an
   * article) don't re-fetch the whole list every time. */
  async function getList() {
    try {
      var cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      if (cached && (Date.now() - cached.t) < CACHE_MIN * 60000) return cached.data;
    } catch (e) {}
    var data = await API.call('getKBList', {});
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), data: data }));
    return data;
  }

  async function load() {
    U.progress(true);
    try {
      var all = await getList();
      var byViews = all.slice().sort(function (a, b) { return b.views - a.views; }).slice(0, 5);
      var byHelpful = all.slice().sort(function (a, b) { return b.helpfulCount - a.helpfulCount; }).slice(0, 5);
      var byNew = all.slice().sort(function (a, b) { return new Date(b.createdDate) - new Date(a.createdDate); }).slice(0, 5);

      section('kbHot', '🔥', 'ดูบ่อยที่สุด', byViews);
      section('kbHelpful', '⭐', 'ช่วยได้จริง', byHelpful);
      section('kbNew', '🆕', 'เพิ่มล่าสุด', byNew);

      var allEl = document.getElementById('kbAll');
      allEl.innerHTML = all.length ? all.map(cardHtml).join('') : '<div class="empty">ยังไม่มีบทความในคลังความรู้</div>';
    } catch (e) {
      U.toast('โหลดคลังความรู้ไม่สำเร็จ: ' + e.message, 'error');
    } finally {
      U.progress(false);
    }
  }

  async function init() {
    Auth.renderUserBadge('userBadge');
    await load();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
