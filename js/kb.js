/* kb.html — Knowledge Base browse + search + filter chips (Step 3) */
(function () {
  var CACHE_KEY = 'mms_kb_list';
  var CACHE_MIN = 10;
  var CAT_ICON = { Repair_Case: '🔧', PM_Tips: '🧠', Safety: '⚠️', Machine_Manual: '📖', Troubleshoot: '🔍' };
  var CHIPS = [
    { key: 'all', label: 'ทั้งหมด' },
    { key: 'Mechanical', label: 'Mechanical', mainIssue: 'Mechanical' },
    { key: 'Electrical', label: 'Electrical', mainIssue: 'Electrical' },
    { key: 'Software', label: 'Software', mainIssue: 'Software' },
    { key: 'Camera&Vision', label: 'Camera&Vision', mainIssue: 'Camera&Vision' },
    { key: 'PM_Tips', label: 'ทริค PM', category: 'PM_Tips' },
    { key: 'Safety', label: 'ความปลอดภัย', category: 'Safety' }
  ];

  var allArticles = [];
  var activeChip = 'all';

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

  function matchesChip(a, chipKey) {
    if (chipKey === 'all') return true;
    var chip = CHIPS.filter(function (c) { return c.key === chipKey; })[0];
    if (!chip) return true;
    if (chip.mainIssue) return a.mainIssue === chip.mainIssue;
    if (chip.category) return a.category === chip.category;
    return true;
  }

  /** Title match = 3pts, Symptom_Keywords = 2pts, Problem = 1pt — same
   * scoring apiSearchKB uses server-side (gas/Code.gs). Done client-side
   * here against the already-cached list so results feel instant while
   * typing instead of waiting on a round-trip per keystroke. */
  function scoreArticle(a, q) {
    var score = 0;
    if (a.title.toLowerCase().indexOf(q) >= 0) score += 3;
    if ((a.symptomKeywords || '').toLowerCase().indexOf(q) >= 0) score += 2;
    if ((a.problem || '').toLowerCase().indexOf(q) >= 0) score += 1;
    return score;
  }

  function renderChips() {
    document.getElementById('kbChips').innerHTML = CHIPS.map(function (c) {
      return '<button type="button" class="kb-chip' + (c.key === activeChip ? ' active' : '') + '" data-chip="' + c.key + '">' +
        U.escapeHtml(c.label) + '</button>';
    }).join('');
    document.querySelectorAll('.kb-chip').forEach(function (b) {
      b.onclick = function () { activeChip = b.getAttribute('data-chip'); renderChips(); renderList(); };
    });
  }

  function renderList() {
    var q = document.getElementById('kbSearch').value.trim().toLowerCase();
    var searching = q.length >= 2;
    var byChip = allArticles.filter(function (a) { return matchesChip(a, activeChip); });

    // Recommended sections only make sense on the unfiltered, unsearched view.
    document.getElementById('kbRecommend').style.display = (searching || activeChip !== 'all') ? 'none' : '';
    if (!searching && activeChip === 'all') {
      var byViews = allArticles.slice().sort(function (a, b) { return b.views - a.views; }).slice(0, 5);
      var byHelpful = allArticles.slice().sort(function (a, b) { return b.helpfulCount - a.helpfulCount; }).slice(0, 5);
      var byNew = allArticles.slice().sort(function (a, b) { return new Date(b.createdDate) - new Date(a.createdDate); }).slice(0, 5);
      section('kbHot', '🔥', 'ดูบ่อยที่สุด', byViews);
      section('kbHelpful', '⭐', 'ช่วยได้จริง', byHelpful);
      section('kbNew', '🆕', 'เพิ่มล่าสุด', byNew);
    }

    var titleEl = document.getElementById('kbListTitle');
    var allEl = document.getElementById('kbAll');
    var list;
    if (searching) {
      list = byChip.map(function (a) { return { a: a, score: scoreArticle(a, q) }; })
        .filter(function (x) { return x.score > 0; })
        .sort(function (x, y) { return y.score - x.score; })
        .map(function (x) { return x.a; });
      titleEl.textContent = 'ผลการค้นหา (' + list.length + ')';
    } else {
      list = byChip;
      var chipDef = CHIPS.filter(function (c) { return c.key === activeChip; })[0];
      titleEl.textContent = (activeChip === 'all' || !chipDef) ? 'บทความทั้งหมด' : 'หมวด ' + chipDef.label;
    }
    allEl.innerHTML = list.length ? list.map(cardHtml).join('') :
      '<div class="empty">' + (searching ? 'ไม่พบบทความที่ตรงกับคำค้นหา' : 'ยังไม่มีบทความในหมวดนี้') + '</div>';
  }

  var searchTimer;
  function onSearchInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderList, 300);
  }

  async function load() {
    U.progress(true);
    try {
      allArticles = await getList();
      renderChips();
      renderList();
    } catch (e) {
      U.toast('โหลดคลังความรู้ไม่สำเร็จ: ' + e.message, 'error');
    } finally {
      U.progress(false);
    }
  }

  async function init() {
    Auth.renderUserBadge('userBadge');
    document.getElementById('kbSearch').addEventListener('input', onSearchInput);
    await load();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
