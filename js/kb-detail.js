/* kb-detail.html?id=KB-0001 — read one article. View/helpful counters still
 * arrive later (kbView/kbHelpful, Step 8) — this step just adds the Edit link. */
(function () {
  var CAT_ICON = { Repair_Case: '🔧', PM_Tips: '🧠', Safety: '⚠️', Machine_Manual: '📖', Troubleshoot: '🔍' };
  function catIcon(c) { return CAT_ICON[c] || '📄'; }

  /** Solution is typed as free text, often already numbered by hand
   * ("1. ...\n2. ..."). Split into lines and let the <ol> do the numbering
   * instead of showing it twice. */
  function stepsHtml(text) {
    if (!text) return '';
    var lines = String(text).split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!lines.length) return '';
    return '<ol class="kb-steps">' + lines.map(function (line) {
      return '<li>' + U.escapeHtml(line.replace(/^\d+[\.\)]\s*/, '')) + '</li>';
    }).join('') + '</ol>';
  }

  function checklistHtml(text) {
    var items = String(text || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!items.length) return '';
    return '<div class="kb-checklist">' + items.map(function (it, i) {
      return '<label><input type="checkbox" id="kbChk' + i + '"> <span>' + U.escapeHtml(it) + '</span></label>';
    }).join('') + '</div>';
  }

  function photosHtml(urls) {
    var list = String(urls || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!list.length) return '';
    return '<div class="kb-photos">' + list.map(function (u) {
      return '<img src="' + U.escapeHtml(u) + '" loading="lazy" data-full="' + U.escapeHtml(u) + '">';
    }).join('') + '</div>';
  }

  function relatedHtml(related) {
    if (!related.length) return '';
    return '<div class="section-title">บทความที่เกี่ยวข้อง</div><div class="kb-grid">' +
      related.map(function (a) {
        return '<a class="kb-card" href="kb-detail.html?id=' + encodeURIComponent(a.kbId) + '">' +
          '<div class="kb-cat-icon">' + catIcon(a.category) + '</div>' +
          '<h4>' + U.escapeHtml(a.title) + '</h4>' +
          '<div class="kb-problem">' + U.escapeHtml(a.problem || '') + '</div></a>';
      }).join('') + '</div>';
  }

  function render(article, related) {
    var html = '<div class="card kb-article">' +
      '<div class="kb-badges">' +
        '<span class="pill">' + catIcon(article.category) + ' ' + U.escapeHtml(article.category) + '</span>' +
        (article.line ? '<span class="pill">' + U.escapeHtml(article.line) + '</span>' : '') +
        (article.station ? '<span class="pill">' + U.escapeHtml(article.station) + '</span>' : '') +
        (article.timeEst ? '<span class="pill">⏱️ ~' + U.escapeHtml(String(article.timeEst)) + ' นาที</span>' : '') +
      '</div>' +
      '<h1 class="kb-title">' + U.escapeHtml(article.title) + '</h1>';

    if (article.warning) {
      html += '<div class="kb-warning">⚠️ ข้อควรระวัง: ' + U.escapeHtml(article.warning) + '</div>';
    }
    if (article.problem)    html += '<h3>อาการที่เจอ</h3><p class="kb-text">' + U.escapeHtml(article.problem) + '</p>';
    if (article.rootCause)  html += '<h3>สาเหตุ</h3><p class="kb-text">' + U.escapeHtml(article.rootCause) + '</p>';

    var prep = checklistHtml([article.tools, article.spareParts].filter(Boolean).join(','));
    if (prep) html += '<h3>🔧 เตรียมของ</h3>' + prep;

    var steps = stepsHtml(article.solution);
    if (steps) html += '<h3>วิธีแก้</h3>' + steps;

    html += photosHtml(article.photoUrls);

    if (article.prevention) html += '<h3>การป้องกัน</h3><p class="kb-text">' + U.escapeHtml(article.prevention) + '</p>';

    var u = window.Auth && Auth.get();
    var canEdit = u && (Auth.myGroup() === 'admin' || u.name === article.author);
    html += '<div class="kb-footer">' +
      '<div class="hint">👁️ ' + article.views + ' ครั้ง • 👍 ' + article.helpfulCount + ' คนบอกว่าช่วยได้</div>' +
      (article.refMtJobNo ? '<div class="hint">อ้างอิงจากงานซ่อม: ' + U.escapeHtml(article.refMtJobNo) + '</div>' : '') +
      (canEdit ? '<div class="btn-group" style="margin-top:12px">' +
        '<a class="btn small ghost" href="kb-edit.html?id=' + encodeURIComponent(article.kbId) + '">แก้ไข</a>' +
        '<button type="button" class="btn small danger" id="kbDeleteBtn">ลบ</button>' +
        '</div>' : '') +
      '</div></div>' + relatedHtml(related);

    document.getElementById('kbDetailBody').innerHTML = html;

    document.querySelectorAll('.kb-photos img').forEach(function (img) {
      img.onclick = function () { openLightbox(img.getAttribute('data-full')); };
    });

    var delBtn = document.getElementById('kbDeleteBtn');
    if (delBtn) delBtn.onclick = function () { deleteArticle(article.kbId, delBtn); };
  }

  async function deleteArticle(kbId, btn) {
    if (!confirm('ลบบทความนี้? การลบไม่สามารถย้อนกลับได้')) return;
    btn.disabled = true;
    U.progress(true);
    try {
      await API.call('deleteKB', { kbId: kbId });
      sessionStorage.removeItem('mms_kb_list'); // kb.html's cached list must not still show the deleted article
      U.toast('ลบบทความสำเร็จ', 'success');
      location.href = 'kb.html';
    } catch (e) {
      U.toast('ลบไม่สำเร็จ: ' + e.message, 'error');
      btn.disabled = false;
    } finally {
      U.progress(false);
    }
  }

  function openLightbox(src) {
    document.getElementById('lightboxImg').src = src;
    document.getElementById('lightbox').classList.add('show');
  }

  async function load() {
    var id = new URLSearchParams(location.search).get('id');
    var body = document.getElementById('kbDetailBody');
    if (!id) { body.innerHTML = '<div class="empty">ไม่พบรหัสบทความ</div>'; return; }
    U.progress(true);
    try {
      var res = await API.call('getKBDetail', { kbId: id });
      render(res.article, res.related || []);
    } catch (e) {
      body.innerHTML = '<div class="empty">โหลดบทความไม่สำเร็จ: ' + U.escapeHtml(e.message) + '</div>';
    } finally {
      U.progress(false);
    }
  }

  async function init() {
    Auth.renderUserBadge('userBadge');
    document.getElementById('lightbox').onclick = function () { this.classList.remove('show'); };
    await load();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
