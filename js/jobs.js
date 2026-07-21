/* jobs.html — technician job board + status flow + close form */
(function () {
  var cfg = null;
  var closePhoto = null;
  var currentJob = null;

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
    var actions = '';
    if (j.status === 'แจ้งซ่อม') actions = '<button class="btn small" data-act="รับงานแล้ว">รับงาน</button>';
    else if (j.status === 'รับงานแล้ว') actions = '<button class="btn small warning" data-act="กำลังซ่อม">เริ่มซ่อม</button>';
    else if (j.status === 'กำลังซ่อม') actions =
      '<button class="btn small orange" data-act="รออะไหล่">รออะไหล่</button>' +
      '<button class="btn small success" data-act="close">ปิดงาน</button>';
    else if (j.status === 'รออะไหล่') actions =
      '<button class="btn small warning" data-act="กำลังซ่อม">กลับมาซ่อม</button>' +
      '<button class="btn small success" data-act="close">ปิดงาน</button>';

    var timeInfo = (j.status === 'ปิดงาน')
      ? ('Downtime: <b>' + (j.downtime || 0) + '</b> นาที')
      : ('รอมาแล้ว <span class="wait-time" data-ts="' + U.escapeHtml(j.timestamp) + '">' + U.elapsed(j.timestamp) + '</span>');

    return '<div class="job-card ' + cls + '">' +
      '<div class="jc-top"><span class="mtjob">' + U.escapeHtml(j.mtJob) + '</span>' + priorityBadge(j.priority) + '</div>' +
      '<div class="meta">' + U.escapeHtml(j.line) + ' • ' + U.escapeHtml(j.mc) + ' • กะ ' + U.escapeHtml(j.shift) + (j.machineStop ? ' • <b style="color:#dc2626">เครื่องหยุด</b>' : '') + '</div>' +
      '<div class="symptom">' + U.escapeHtml(j.symptom) + '</div>' +
      photo +
      '<div class="meta">ผู้แจ้ง: ' + U.escapeHtml(j.reporter || '-') + ' • ' + timeInfo + '</div>' +
      (actions ? '<div class="btn-group" data-mt="' + U.escapeHtml(j.mtJob) + '">' + actions + '</div>' : '') +
      '</div>';
  }

  function render(jobs) {
    var board = document.getElementById('board');
    board.innerHTML = '';
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
        return changeStatus(mt, act, btn);
      };
    });
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
    document.getElementById('cSpare').value = '';
    document.getElementById('cIssue').value = '';
    document.getElementById('cTime').value = '';
    document.getElementById('cPhoto').value = '';
    document.getElementById('cPhotoPreview').classList.remove('show');
    document.getElementById('closeModal').classList.add('show');
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
    var timeMin = document.getElementById('cTime').value;
    if (!mainIssue) return U.toast('กรุณาเลือกประเภทปัญหาหลัก', 'error');
    if (timeMin === '' || Number(timeMin) < 0) return U.toast('กรุณากรอกเวลาซ่อมจริง (นาที)', 'error');

    var payload = {
      mtJob: currentJob.mtJob,
      station: currentJob.mc,
      mainIssue: mainIssue,
      issue: document.getElementById('cIssue').value.trim(),
      detail: document.getElementById('cDetail').value.trim(),
      improvements: document.getElementById('cImprove').value.trim(),
      spareParts: document.getElementById('cSpare').value.trim(),
      by: document.getElementById('cBy').value,
      timeMin: Number(timeMin),
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

  async function load() {
    var overlay = document.getElementById('overlay');
    overlay.classList.add('show');
    try {
      var jobs = await API.call('getBMJobs', {
        line: document.getElementById('fLine').value,
        shift: document.getElementById('fShift').value,
        date: document.getElementById('fDate').value
      });
      render(jobs);
    } catch (e) {
      U.toast('โหลดงานไม่สำเร็จ: ' + e.message, 'error');
      document.getElementById('board').innerHTML = '<div class="empty">โหลดข้อมูลไม่สำเร็จ</div>';
    } finally {
      overlay.classList.remove('show');
    }
  }

  function tickWaitTimes() {
    document.querySelectorAll('.wait-time[data-ts]').forEach(function (el) {
      el.textContent = U.elapsed(el.getAttribute('data-ts'));
    });
  }

  async function init() {
    Auth.renderUserBadge('userBadge');
    try { cfg = await API.getConfig(); } catch (e) { U.toast(e.message, 'error'); return; }

    var fl = document.getElementById('fLine');
    (cfg.Line || []).forEach(function (v) { fl.appendChild(new Option(v, v)); });
    var mi = document.getElementById('cMainIssue');
    (cfg.Main_Issue || []).forEach(function (v) { mi.appendChild(new Option(v, v)); });
    var by = document.getElementById('cBy');
    (cfg.By || []).forEach(function (v) { by.appendChild(new Option(v, v)); });
    updateIssueList();

    mi.addEventListener('change', updateIssueList);
    document.getElementById('refreshBtn').onclick = load;
    ['fLine', 'fShift', 'fDate'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', load);
    });
    document.getElementById('cancelCloseBtn').onclick = closeModal;
    document.getElementById('confirmCloseBtn').onclick = confirmClose;
    document.getElementById('cPhoto').addEventListener('change', async function (e) {
      var f = e.target.files[0]; if (!f) { closePhoto = null; return; }
      closePhoto = await U.compressImage(f, 1280);
      var img = document.getElementById('cPhotoPreview'); img.src = closePhoto; img.classList.add('show');
    });

    await load();
    setInterval(tickWaitTimes, 30000);
    setInterval(load, 60000); // auto refresh every minute
  }

  document.addEventListener('DOMContentLoaded', init);
})();
