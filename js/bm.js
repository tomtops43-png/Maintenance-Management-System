/* index.html — BM report form */
(function () {
  var photoData = null;
  var cfg = null;

  function fillSelect(el, items, placeholder) {
    el.innerHTML = '';
    if (placeholder) el.appendChild(new Option(placeholder, ''));
    (items || []).forEach(function (v) { el.appendChild(new Option(v, v)); });
  }

  async function init() {
    Auth.renderUserBadge('userBadge');
    var overlay = document.getElementById('overlay');
    overlay.classList.add('show');
    try {
      cfg = await API.getConfig();
    } catch (e) {
      U.toast('โหลดค่าตั้งต้นไม่สำเร็จ: ' + e.message, 'error');
      overlay.classList.remove('show');
      return;
    }
    overlay.classList.remove('show');

    fillSelect(document.getElementById('line'), cfg.Line, '— เลือกไลน์ —');
    fillSelect(document.getElementById('priority'), cfg.Priority);
    // Station datalist
    var dl = document.getElementById('stationList');
    dl.innerHTML = '';
    (cfg.Station || []).forEach(function (s) { dl.appendChild(new Option(s, s)); });

    // Default priority = ปกติ if present
    var pr = document.getElementById('priority');
    for (var i = 0; i < pr.options.length; i++) { if (pr.options[i].value.indexOf('ปกติ') >= 0) pr.selectedIndex = i; }

    // Prefill reporter from session
    var u = Auth.get();
    if (u && u.name) document.getElementById('reporter').value = u.name;

    // Prefill from a PM NG handoff, if present
    try {
      var pre = JSON.parse(sessionStorage.getItem('mms_bm_prefill') || 'null');
      if (pre) {
        if (pre.line) document.getElementById('line').value = pre.line;
        if (pre.mc) document.getElementById('mc').value = pre.mc;
        if (pre.symptom) document.getElementById('symptom').value = pre.symptom;
        sessionStorage.removeItem('mms_bm_prefill');
      }
    } catch (e) {}

    // Shift info
    var shift = U.detectShift(new Date(), cfg);
    document.getElementById('shiftInfo').textContent =
      'วันที่ ' + U.thaiDate(new Date()) + ' • กะ ' + shift + ' (ระบบกำหนดอัตโนมัติ)';

    // Machine stop toggle label + priority linkage
    var ms = document.getElementById('machineStop');
    ms.addEventListener('change', function () {
      document.getElementById('machineStopLabel').textContent = ms.checked ? 'เครื่องหยุด' : 'เครื่องยังเดินได้';
      if (ms.checked) {
        for (var i = 0; i < pr.options.length; i++) { if (pr.options[i].value.indexOf('เครื่องหยุด') >= 0) pr.selectedIndex = i; }
      }
    });

    // Photo compress
    document.getElementById('photo').addEventListener('change', async function (e) {
      var file = e.target.files[0];
      if (!file) { photoData = null; return; }
      document.getElementById('photoHint').textContent = 'กำลังบีบอัดรูป...';
      try {
        photoData = await U.compressImage(file, 1280);
        var img = document.getElementById('photoPreview');
        img.src = photoData; img.classList.add('show');
        document.getElementById('photoHint').textContent = 'พร้อมส่งรูปแล้ว';
      } catch (err) {
        photoData = null;
        document.getElementById('photoHint').textContent = 'ไม่สามารถประมวลผลรูปนี้';
      }
    });

    document.getElementById('submitBtn').onclick = submit;
    document.getElementById('newBtn').onclick = function () {
      document.getElementById('confirmView').style.display = 'none';
      document.getElementById('formView').style.display = 'block';
      resetForm();
    };
  }

  function resetForm() {
    ['symptom', 'mc'].forEach(function (id) { document.getElementById(id).value = ''; });
    document.getElementById('machineStop').checked = false;
    document.getElementById('machineStopLabel').textContent = 'เครื่องยังเดินได้';
    document.getElementById('photo').value = '';
    document.getElementById('photoPreview').classList.remove('show');
    document.getElementById('photoHint').textContent = '';
    photoData = null;
  }

  async function submit() {
    var btn = document.getElementById('submitBtn');
    var line = document.getElementById('line').value;
    var mc = document.getElementById('mc').value.trim();
    var symptom = document.getElementById('symptom').value.trim();
    var reporter = document.getElementById('reporter').value.trim();
    if (!line) return U.toast('กรุณาเลือกไลน์', 'error');
    if (!mc) return U.toast('กรุณาระบุ M/C No. / Station', 'error');
    if (!symptom) return U.toast('กรุณากรอกอาการเสีย', 'error');
    if (!reporter) return U.toast('กรุณากรอกชื่อผู้แจ้ง', 'error');

    var payload = {
      line: line, mc: mc, symptom: symptom,
      priority: document.getElementById('priority').value,
      machineStop: document.getElementById('machineStop').checked,
      reporter: reporter,
      shift: U.detectShift(new Date(), cfg),
      photoBase64: photoData
    };

    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> กำลังส่ง...';
    try {
      var res = await API.call('createBM', payload);
      document.getElementById('confirmJobNo').textContent = res.mtJob;
      document.getElementById('formView').style.display = 'none';
      document.getElementById('confirmView').style.display = 'block';
      window.scrollTo(0, 0);
    } catch (e) {
      U.toast('ส่งไม่สำเร็จ: ' + e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'ส่งแจ้งซ่อม';
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
