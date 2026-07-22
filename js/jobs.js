/* jobs.html — technician job board + status flow + close form */
(function () {
  var cfg = null;
  var closePhoto = null;
  var currentJob = null;
  var lastJobs = [];
  var kbRelatedByJob = {}; // mtJob -> matched KB articles, recomputed each render()

  var GROUPS = [
    { key: 'แจ้งซ่อม',   title: 'รอรับงาน',   cls: 's-new',    dot: 'dot-new' },
    { key: 'รับงานแล้ว', title: 'รับงานแล้ว', cls: 's-repair', dot: 'dot-repair' },
    { key: 'กำลังซ่อม',  title: 'กำลังซ่อม',  cls: 's-repair', dot: 'dot-repair' },
    { key: 'รออะไหล่',   title: 'รออะไหล่',   cls: 's-wait',   dot: 'dot-wait' },
    { key: 'ปิดงาน',     title: 'ปิดแล้ววันนี้', cls: 's-done', dot: 'dot-done' }
  ];

  function priorityBadge(p) {
    if (!p) return '';
    if (p.indexOf('ด่วนมาก') >= 0 || p.indexOf('เครื่องหยุด') >= 0) return '<span class="badge p-urgent">' + U.escapeHtml(p) + '</span>';
    if (p.indexOf('ด่วน') >= 0) return '<span class="badge p-high">' + U.escapeHtml(p) + '</span>';
    return '<span class="badge p-normal">' + U.escapeHtml(p) + '</span>';
  }

  function cardHtml(j, cls) {
    var photo = j.photoBefore ? '<img class="jc-photo" src="' + U.escapeHtml(j.photoBefore) + '" loading="lazy" alt="">' : '';
    // Only technicians/admins get the action buttons; หัวหน้ากะ views only.
    var actions = '';
    if (window.Auth && Auth.canWorkJobs()) {
      if (j.status === 'แจ้งซ่อม') actions = '<button class="btn small" data-act="รับงานแล้ว">รับงาน</button>';
      else if (j.status === 'รับงานแล้ว') actions = '<button class="btn small warning" data-act="กำลังซ่อม">เริ่มซ่อม</button>';
      else if (j.status === 'กำลังซ่อม') actions =
        '<button class="btn small orange" data-act="รออะไหล่">รออะไหล่</button>' +
        '<button class="btn small success" data-act="close">ปิดงาน</button>';
      else if (j.status === 'รออะไหล่') actions =
        '<button class="btn small warning" data-act="กำลังซ่อม">กลับมาซ่อม</button>' +
        '<button class="btn small success" data-act="close">ปิดงาน</button>';
      else if (j.status === 'ปิดงาน') actions =
        '<button class="btn small ghost" data-act="saveKB">บันทึกเป็นเคสตัวอย่าง</button>';
    }

    var timeInfo = (j.status === 'ปิดงาน')
      ? ('Downtime: <b>' + (j.downtime || 0) + '</b> นาที')
      : ('รอมาแล้ว <span class="wait-time" data-ts="' + U.escapeHtml(j.timestamp) + '">' + U.elapsed(j.timestamp) + '</span>');

    var related = kbRelatedByJob[j.mtJob];
    var kbBanner = (related && related.length)
      ? '<div class="kb-hint" data-kb-hint data-mt="' + U.escapeHtml(j.mtJob) + '">' +
          '<span>💡 เคยเจอเคสนี้ ' + related.length + ' บทความ</span><span class="kb-hint-link">ดูวิธีแก้ ›</span></div>'
      : '';

    return '<div class="job-card ' + cls + '">' +
      '<div class="jc-top"><span class="mtjob">' + U.escapeHtml(j.mtJob) + '</span>' + priorityBadge(j.priority) + '</div>' +
      '<div class="meta">' + U.escapeHtml(j.line) + ' • ' + U.escapeHtml(j.mc) + ' • กะ ' + U.escapeHtml(j.shift) + (j.machineStop ? ' • <b style="color:#dc2626">เครื่องหยุด</b>' : '') + '</div>' +
      '<div class="symptom">' + U.escapeHtml(j.symptom) + '</div>' +
      photo +
      '<div class="meta">ผู้แจ้ง: ' + U.escapeHtml(j.reporter || '-') + ' • ' + timeInfo + '</div>' +
      kbBanner +
      (actions ? '<div class="btn-group" data-mt="' + U.escapeHtml(j.mtJob) + '">' + actions + '</div>' : '') +
      '</div>';
  }

  /** Suggest KB articles for a job that's actively being worked (รับงานแล้ว/
   * กำลังซ่อม) by matching Station + Line + Symptom_Keywords found in the
   * job's reported symptom text. Runs entirely client-side against the same
   * cached getKBList result kb.html's search uses — no network call per
   * card. Threshold of 3 requires at least an exact station match (or a
   * weaker line+keyword combo) before suggesting anything. */
  function findRelatedKB(job, articles) {
    var symptom = (job.symptom || '').toLowerCase();
    var scored = articles.map(function (a) {
      var score = 0;
      if (a.station && a.station === job.mc) score += 3;
      else if (a.station === 'ทุก Station') score += 1;
      if (a.line && a.line === job.line) score += 2;
      else if (a.line === 'ทุกไลน์') score += 1;
      (a.symptomKeywords || '').split(',').forEach(function (kw) {
        kw = kw.trim().toLowerCase();
        if (kw && symptom.indexOf(kw) >= 0) score += 2;
      });
      return { article: a, score: score };
    }).filter(function (x) { return x.score >= 3; });
    scored.sort(function (x, y) { return y.score - x.score; });
    return scored.map(function (x) { return x.article; });
  }

  /** sessionStorage cache shared with kb.js (same key) so a technician
   * bouncing between the job board and the KB doesn't refetch the list. */
  async function getKBListCached() {
    try {
      var cached = JSON.parse(sessionStorage.getItem('mms_kb_list') || 'null');
      if (cached && (Date.now() - cached.t) < 10 * 60000) return cached.data;
    } catch (e) {}
    try {
      var data = await API.call('getKBList', {});
      sessionStorage.setItem('mms_kb_list', JSON.stringify({ t: Date.now(), data: data }));
      return data;
    } catch (e) {
      return []; // best-effort: a KB fetch failure shouldn't break the job board
    }
  }

  function openKBRelatedModal(mtJob) {
    var related = kbRelatedByJob[mtJob] || [];
    document.getElementById('kbRelatedList').innerHTML = related.map(function (a) {
      return '<a class="kb-card" style="display:block;margin-bottom:12px" href="kb-detail.html?id=' + encodeURIComponent(a.kbId) + '">' +
        '<h4>' + U.escapeHtml(a.title) + '</h4>' +
        '<div class="kb-problem">' + U.escapeHtml(a.problem || '') + '</div></a>';
    }).join('');
    document.getElementById('kbRelatedModal').classList.add('show');
  }

  function render(jobs, kbArticles) {
    var board = document.getElementById('board');
    board.innerHTML = '';

    kbRelatedByJob = {};
    if (kbArticles && kbArticles.length) {
      jobs.forEach(function (j) {
        if (j.status !== 'รับงานแล้ว' && j.status !== 'กำลังซ่อม') return;
        var related = findRelatedKB(j, kbArticles);
        if (related.length) kbRelatedByJob[j.mtJob] = related;
      });
    }

    var byStatus = {};
    jobs.forEach(function (j) { (byStatus[j.status] = byStatus[j.status] || []).push(j); });

    var any = false;
    GROUPS.forEach(function (g) {
      var list = byStatus[g.key] || [];
      if (g.key === 'ปิดงาน') {
        var today = U.ymd(new Date());
        list = list.filter(function (j) { return (j.finishDt || '').substring(0, 10) === today; });
      }
      if (!list.length) return;
      any = true;
      // Sort: urgent first, then oldest first
      list.sort(function (a, b) {
        var pa = (a.priority || '').indexOf('ด่วนมาก') >= 0 ? 0 : (a.priority || '').indexOf('ด่วน') >= 0 ? 1 : 2;
        var pb = (b.priority || '').indexOf('ด่วนมาก') >= 0 ? 0 : (b.priority || '').indexOf('ด่วน') >= 0 ? 1 : 2;
        if (pa !== pb) return pa - pb;
        return new Date(a.timestamp) - new Date(b.timestamp);
      });
      var html = '<div class="status-group"><h3><span class="status-dot ' + g.dot + '"></span>' +
        g.title + ' (' + list.length + ')</h3>';
      list.forEach(function (j) { html += cardHtml(j, g.cls); });
      html += '</div>';
      board.insertAdjacentHTML('beforeend', html);
    });

    if (!any) board.innerHTML = '<div class="empty">ไม่มีงานตามเงื่อนไขที่เลือก</div>';
    wireCardActions(jobs);
  }

  function wireCardActions(jobs) {
    document.querySelectorAll('[data-mt] [data-act]').forEach(function (btn) {
      btn.onclick = function () {
        var mt = btn.closest('[data-mt]').getAttribute('data-mt');
        var act = btn.getAttribute('data-act');
        var job = jobs.filter(function (j) { return j.mtJob === mt; })[0];
        if (act === 'close') return openCloseModal(job);
        if (act === 'saveKB') return saveAsKBCase(job, btn);
        return changeStatus(mt, act, btn);
      };
    });
    document.querySelectorAll('[data-kb-hint]').forEach(function (el) {
      el.onclick = function () { openKBRelatedModal(el.getAttribute('data-mt')); };
    });
  }

  /** "บันทึกเป็นเคสตัวอย่าง" — pull the full repair detail (Record ซ่อม only
   * has these fields, not the job list already loaded here) and hand off to
   * kb-edit.html via sessionStorage, same pattern as the PM->BM prefill. */
  async function saveAsKBCase(job, btn) {
    btn.disabled = true;
    var original = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      var rep = await API.call('getRepairDetail', { mtJob: job.mtJob });
      var title = [rep.station || job.mc, rep.issue].filter(Boolean).join(' - ') || job.mtJob;
      sessionStorage.setItem('mms_kb_prefill', JSON.stringify({
        title: title,
        category: 'Repair_Case',
        mainIssue: rep.mainIssue || '',
        line: rep.line || job.line || '',
        station: rep.station || job.mc || '',
        problem: rep.detail || '',
        solution: rep.improvements || '',
        spareParts: rep.spareParts || '',
        timeEst: rep.timeMin || '',
        photoUrl: rep.photoAfterUrl || '',
        refMtJobNo: job.mtJob
      }));
      location.href = 'kb-edit.html?prefill=1';
    } catch (e) {
      U.toast('ดึงข้อมูลงานซ่อมไม่สำเร็จ: ' + e.message, 'error');
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  async function changeStatus(mt, status, btn) {
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try {
      await API.call('updateBMStatus', { mtJob: mt, status: status });
      await load();
    } catch (e) {
      U.toast('อัปเดตไม่สำเร็จ: ' + e.message, 'error');
      btn.disabled = false;
    }
  }

  function openCloseModal(job) {
    currentJob = job;
    closePhoto = null;
    document.getElementById('closeMtJob').textContent = job.mtJob;
    document.getElementById('cDetail').value = '';
    document.getElementById('cImprove').value = '';
    document.getElementById('cIssue').value = '';
    document.getElementById('cPhoto').value = '';
    document.getElementById('cPhotoPreview').classList.remove('show');
    document.getElementById('closeModal').classList.add('show');
    updateTimeInfo();
  }

  /** Live preview of the auto-calculated repair time (report -> now). The
   * server recomputes this authoritatively at close time; this is just so
   * the technician can see roughly what will be recorded. */
  function updateTimeInfo() {
    if (!currentJob || !document.getElementById('closeModal').classList.contains('show')) return;
    document.getElementById('cTimeInfo').textContent =
      'เวลาที่ใช้ซ่อม (โดยประมาณ): ' + U.elapsed(currentJob.timestamp) + ' — ระบบคำนวณจริงตอนบันทึก';
  }

  function closeModal() { document.getElementById('closeModal').classList.remove('show'); }

  function updateIssueList() {
    var mi = document.getElementById('cMainIssue').value;
    var dl = document.getElementById('cIssueList');
    dl.innerHTML = '';
    (cfg.Issue || []).filter(function (it) { return !mi || it.parent === mi; })
      .forEach(function (it) { dl.appendChild(new Option(it.value, it.value)); });
  }

  async function confirmClose() {
    var btn = document.getElementById('confirmCloseBtn');
    var mainIssue = document.getElementById('cMainIssue').value;
    if (!mainIssue) return U.toast('กรุณาเลือกประเภทปัญหาหลัก', 'error');

    var payload = {
      mtJob: currentJob.mtJob,
      station: currentJob.mc,
      mainIssue: mainIssue,
      issue: document.getElementById('cIssue').value.trim(),
      detail: document.getElementById('cDetail').value.trim(),
      improvements: document.getElementById('cImprove').value.trim(),
      by: document.getElementById('cBy').value,
      photoBase64: closePhoto
    };
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> กำลังบันทึก...';
    try {
      var res = await API.call('closeBM', payload);
      U.toast('ปิดงานสำเร็จ (Downtime ' + res.downtime + ' นาที)', 'success');
      closeModal();
      await load();
    } catch (e) {
      U.toast('ปิดงานไม่สำเร็จ: ' + e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'บันทึกปิดงาน';
    }
  }

  async function load(silent) {
    var board = document.getElementById('board');
    var isFirstLoad = board.dataset.loaded !== '1';
    if (!silent) {
      U.progress(true);
      if (isFirstLoad) board.innerHTML = U.skeletonCards(4);
    }
    try {
      var jobs = await API.call('getBMJobs', {
        line: document.getElementById('fLine').value,
        shift: document.getElementById('fShift').value,
        date: document.getElementById('fDate').value
      });
      var kbArticles = await getKBListCached();
      lastJobs = jobs;
      render(jobs, kbArticles);
      board.dataset.loaded = '1';
    } catch (e) {
      if (!silent) {
        U.toast('โหลดงานไม่สำเร็จ: ' + e.message, 'error');
        if (isFirstLoad) board.innerHTML = '<div class="empty">โหลดข้อมูลไม่สำเร็จ</div>';
      }
    } finally {
      if (!silent) U.progress(false);
    }
  }

  /** Background refresh: skip entirely while the close-job modal is open,
   * and always silent (no progress bar/skeleton), so it doesn't interrupt
   * a technician mid-form. */
  function backgroundRefresh() {
    if (document.getElementById('closeModal').classList.contains('show')) return;
    load(true);
  }

  function tickWaitTimes() {
    document.querySelectorAll('.wait-time[data-ts]').forEach(function (el) {
      el.textContent = U.elapsed(el.getAttribute('data-ts'));
    });
    updateTimeInfo();
  }

  async function init() {
    Auth.renderUserBadge('userBadge');
    try { cfg = await API.getConfig(); } catch (e) { U.toast(e.message, 'error'); return; }

    var fl = document.getElementById('fLine');
    (cfg.Line || []).forEach(function (v) { fl.appendChild(new Option(v, v)); });
    var mi = document.getElementById('cMainIssue');
    (cfg.Main_Issue || []).forEach(function (v) { mi.appendChild(new Option(v, v)); });
    // ผู้ซ่อม (By): auto from the logged-in technician, not a pick-list.
    var byEl = document.getElementById('cBy');
    var u = Auth.get();
    byEl.value = (u && u.name) || '';
    byEl.readOnly = true;
    updateIssueList();

    mi.addEventListener('change', updateIssueList);
    document.getElementById('refreshBtn').onclick = function () { load(); };
    ['fLine', 'fShift', 'fDate'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', function () { load(); });
    });
    document.getElementById('cancelCloseBtn').onclick = closeModal;
    document.getElementById('closeModalXBtn').onclick = closeModal;
    document.getElementById('confirmCloseBtn').onclick = confirmClose;
    document.getElementById('kbRelatedXBtn').onclick = function () {
      document.getElementById('kbRelatedModal').classList.remove('show');
    };
    document.getElementById('cPhoto').addEventListener('change', async function (e) {
      var f = e.target.files[0]; if (!f) { closePhoto = null; return; }
      closePhoto = await U.compressImage(f, 1280);
      var img = document.getElementById('cPhotoPreview'); img.src = closePhoto; img.classList.add('show');
    });

    await load();
    openFromQueryParam();
    setInterval(tickWaitTimes, 30000);
    setInterval(backgroundRefresh, 60000); // silent auto refresh every minute
  }

  /** Support "jobs.html?closeJob=<mtJob>" links (e.g. the "pull to close"
   * shortcut on the report form) by opening that job's close modal directly. */
  function openFromQueryParam() {
    var mt = new URLSearchParams(location.search).get('closeJob');
    if (!mt) return;
    var job = lastJobs.filter(function (j) { return j.mtJob === mt; })[0];
    if (job) {
      openCloseModal(job);
    } else {
      U.toast('ไม่พบงาน ' + mt + ' (อาจถูกปิดไปแล้ว)', 'error');
    }
    // Clean the URL so a page refresh doesn't reopen the modal.
    history.replaceState(null, '', location.pathname);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
