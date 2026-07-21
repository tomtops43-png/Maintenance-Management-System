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
    v.innerHTML = '<div class="empty">กำลังโหลด...</div>';
    try {
      var due = await API.call('getPMDue', {});
      if (!due.length) { v.innerHTML = '<div class="empty">🎉 ไม่มีรายการ PM ที่ถึงกำหนด</div>'; return; }
      window._pmDue = due;
      v.innerHTML = due.map(function (p) { return pmCardHtml(p, true); }).join('');
      wire(v, due);
    } catch (e) { v.innerHTML = '<div class="empty">โหลดไม่สำเร็จ: ' + U.escapeHtml(e.message) + '</div>'; }
  }

  async function loadAll() {
    var v = document.getElementById('allView');
    v.innerHTML = '<div class="empty">กำลังโหลด...</div>';
    try {
      var all = await API.call('getPMMaster', {});
      if (!all.length) { v.innerHTML = '<div class="empty">ยังไม่มีแผน PM (เพิ่มได้ที่หน้าตั้งค่า)</div>'; return; }
      window._pmAll = all;
      v.innerHTML = all.map(function (p) { return pmCardHtml(p, false); }).join('');
      wire(v, all);
    } catch (e) { v.innerHTML = '<div class="empty">โหลดไม่สำเร็จ: ' + U.escapeHtml(e.message) + '</div>'; }
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
