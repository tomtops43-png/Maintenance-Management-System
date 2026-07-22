/* pm.html — PM due list, checklist, and NG -> BM handoff */
(function () {
  var pmPhoto = null;
  var currentPM = null;
  var result = 'OK';

  function pmCardHtml(p, showDue) {
    var overdue = p.overdue
      ? '<span class="pill overdue">เกิน ' + p.overdueDays + ' วัน</span>'
      : '<span class="pill">ถึงกำหนด</span>';
    return '<div class="card">' +
      '<div style="display:flex;justify-content:space-between;gap:8px">' +
        '<b>' + U.escapeHtml(p.pmItem || p.pmId) + '</b>' + (showDue ? overdue : (p.active ? '<span class="pill ok">Active</span>' : '<span class="pill">ปิด</span>')) +
      '</div>' +
      '<div class="meta">' + U.escapeHtml(p.line) + ' • ' + U.escapeHtml(p.mcStation) + ' • ' + U.escapeHtml(p.frequency) + '</div>' +
      (p.standard ? '<div class="hint">เกณฑ์: ' + U.escapeHtml(p.standard) + '</div>' : '') +
      '<div class="hint">ครบกำหนด: ' + U.thaiDate(p.nextDue) + (p.lastDone ? ' • ทำล่าสุด: ' + U.thaiDate(p.lastDone) : '') + '</div>' +
      '<div class="btn-group" style="margin-top:8px"><button class="btn small" data-pm="' + U.escapeHtml(p.pmId) + '">ทำ PM</button></div>' +
      '</div>';
  }

  async function loadDue() {
    var v = document.getElementById('dueView');
    v.innerHTML = U.skeletonCards(3);
    U.progress(true);
    try {
      var due = await API.call('getPMDue', {});
      if (!due.length) { v.innerHTML = '<div class="empty">🎉 ไม่มีรายการ PM ที่ถึงกำหนด</div>'; return; }
      window._pmDue = due;
      v.innerHTML = due.map(function (p) { return pmCardHtml(p, true); }).join('');
      wire(v, due);
    } catch (e) { v.innerHTML = '<div class="empty">โหลดไม่สำเร็จ: ' + U.escapeHtml(e.message) + '</div>'; }
    finally { U.progress(false); }
  }

  /** Schedule overview: one row per plan, one column per day of the current
   * month, with a dot marking the day each plan's next-due date falls on.
   * Click a row to open the same "ทำ PM" modal a due-list card would. */
  function pmGanttHtml(list) {
    var today = new Date();
    var y = today.getFullYear(), mo = today.getMonth(), todayDate = today.getDate();
    var daysInMonth = new Date(y, mo + 1, 0).getDate();
    var startOfToday = new Date(y, mo, todayDate);

    var dayHeaders = '';
    for (var d = 1; d <= daysInMonth; d++) {
      dayHeaders += '<th class="gantt-day' + (d === todayDate ? ' gantt-today' : '') + '">' + d + '</th>';
    }

    var rows = list.map(function (p) {
      var due = U.toDate(p.nextDue);
      var dueDay = (due && due.getFullYear() === y && due.getMonth() === mo) ? due.getDate() : null;
      var overdue = !!(due && due < startOfToday);
      var meta = [p.mcStation, p.frequency, p.assignedTo].filter(Boolean).join(' · ');
      var cells = '';
      for (var d2 = 1; d2 <= daysInMonth; d2++) {
        var marker = (d2 === dueDay) ? '<span class="gantt-dot' + (overdue ? ' overdue' : '') + '"></span>' : '';
        cells += '<td class="gantt-day' + (d2 === todayDate ? ' gantt-today' : '') + '">' + marker + '</td>';
      }
      return '<tr data-pm="' + U.escapeHtml(p.pmId) + '">' +
        '<td class="gantt-label"><b>' + U.escapeHtml(p.pmItem || p.pmId) + '</b>' +
        '<div class="meta">' + U.escapeHtml(meta) + '</div></td>' + cells + '</tr>';
    }).join('');

    return '<div class="card" style="padding:0;overflow:hidden">' +
      '<div class="pm-gantt-wrap"><table class="pm-gantt">' +
        '<thead>' +
          '<tr><th class="gantt-label"></th><th class="gantt-month" colspan="' + daysInMonth + '">' + U.monthsTh[mo] + ' ' + y + '</th></tr>' +
          '<tr><th class="gantt-label">แผน PM</th>' + dayHeaders + '</tr>' +
        '</thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="pm-gantt-legend">' +
        '<span><span class="gantt-dot"></span> ครบกำหนดในเดือนนี้</span>' +
        '<span><span class="gantt-dot overdue"></span> เลยกำหนดแล้ว</span>' +
      '</div></div>';
  }

  async function loadAll() {
    var v = document.getElementById('allView');
    v.innerHTML = U.skeletonCards(3);
    U.progress(true);
    try {
      var all = await API.call('getPMMaster', {});
      if (!all.length) { v.innerHTML = '<div class="empty">ยังไม่มีแผน PM (เพิ่มได้ที่หน้าตั้งค่า)</div>'; return; }
      window._pmAll = all;
      v.innerHTML = pmGanttHtml(all);
      wireGantt(v, all);
    } catch (e) { v.innerHTML = '<div class="empty">โหลดไม่สำเร็จ: ' + U.escapeHtml(e.message) + '</div>'; }
    finally { U.progress(false); }
  }

  function wire(container, list) {
    container.querySelectorAll('[data-pm]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-pm');
        var p = list.filter(function (x) { return x.pmId === id; })[0];
        openModal(p);
      };
    });
  }

  function wireGantt(container, list) {
    container.querySelectorAll('tr[data-pm]').forEach(function (row) {
      row.onclick = function () {
        var p = list.filter(function (x) { return x.pmId === row.getAttribute('data-pm'); })[0];
        if (p) openModal(p);
      };
    });
    // Bring today's column into view instead of starting scrolled all the way left.
    var wrap = container.querySelector('.pm-gantt-wrap');
    var todayTh = container.querySelector('.gantt-today');
    if (wrap && todayTh) {
      var offset = todayTh.getBoundingClientRect().left - wrap.getBoundingClientRect().left + wrap.scrollLeft;
      wrap.scrollLeft = Math.max(0, offset - 120);
    }
  }

  function openModal(p) {
    currentPM = p; pmPhoto = null; setResult('OK');
    document.getElementById('pmModalId').textContent = p.pmId;
    document.getElementById('pmModalItem').textContent = (p.pmItem || '') + ' — ' + (p.line || '') + ' ' + (p.mcStation || '');
    document.getElementById('pmNgDetail').value = '';
    document.getElementById('pmAction').value = '';
    document.getElementById('pmPhoto').value = '';
    document.getElementById('pmPhotoPreview').classList.remove('show');
    document.getElementById('pmModal').classList.add('show');
  }
  function closeModal() { document.getElementById('pmModal').classList.remove('show'); }

  function setResult(r) {
    result = r;
    document.getElementById('resOK').classList.toggle('active', r === 'OK');
    document.getElementById('resNG').classList.toggle('active', r === 'NG');
    document.getElementById('ngBox').style.display = (r === 'NG') ? 'block' : 'none';
  }

  async function submit() {
    var btn = document.getElementById('pmSubmitBtn');
    var payload = {
      pmId: currentPM.pmId,
      result: result,
      ngDetail: document.getElementById('pmNgDetail').value.trim(),
      actionTaken: document.getElementById('pmAction').value.trim(),
      photoBase64: pmPhoto
    };
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> กำลังบันทึก...';
    try {
      var res = await API.call('submitPM', payload);
      closeModal();
      if (result === 'NG') offerBM();
      else U.toast('บันทึก PM สำเร็จ • ครบกำหนดครั้งถัดไป ' + U.thaiDate(res.nextDue), 'success');
      loadDue();
    } catch (e) {
      U.toast('บันทึกไม่สำเร็จ: ' + e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'บันทึกผล PM';
    }
  }

  /** After an NG result, prefill a BM report from the PM context. */
  function offerBM() {
    if (!confirm('ผลตรวจเป็น NG — ต้องการแจ้งซ่อม (BM) จากผล PM นี้หรือไม่?')) return;
    var p = currentPM;
    sessionStorage.setItem('mms_bm_prefill', JSON.stringify({
      line: p.line || '', mc: p.mcStation || '',
      symptom: 'จากผล PM ' + p.pmId + ': ' + (document.getElementById('pmNgDetail').value.trim() || p.pmItem || '')
    }));
    location.href = 'index.html?from=pm';
  }

  function initTabs() {
    document.querySelectorAll('.tabs [data-tab]').forEach(function (b) {
      b.onclick = function () {
        document.querySelectorAll('.tabs [data-tab]').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        var t = b.getAttribute('data-tab');
        document.getElementById('dueView').style.display = (t === 'due') ? 'block' : 'none';
        document.getElementById('allView').style.display = (t === 'all') ? 'block' : 'none';
        if (t === 'all' && !window._pmAll) loadAll();
      };
    });
  }

  async function init() {
    Auth.renderUserBadge('userBadge');
    initTabs();
    document.getElementById('resOK').onclick = function () { setResult('OK'); };
    document.getElementById('resNG').onclick = function () { setResult('NG'); };
    document.getElementById('pmCancelBtn').onclick = closeModal;
    document.getElementById('pmModalXBtn').onclick = closeModal;
    document.getElementById('pmSubmitBtn').onclick = submit;
    document.getElementById('pmPhoto').addEventListener('change', async function (e) {
      var f = e.target.files[0]; if (!f) { pmPhoto = null; return; }
      pmPhoto = await U.compressImage(f, 1280);
      var img = document.getElementById('pmPhotoPreview'); img.src = pmPhoto; img.classList.add('show');
    });
    await loadDue();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
