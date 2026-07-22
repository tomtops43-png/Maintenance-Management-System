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
    // M/C / Station as a real dropdown (native picker — reliable on mobile)
    fillSelect(document.getElementById('mc'), cfg.Station, '— เลือก M/C No. / Station —');

    // Default priority = ปกติ if present
    var pr = document.getElementById('priority');
    for (var i = 0; i < pr.options.length; i++) { if (pr.options[i].value.indexOf('ปกติ') >= 0) pr.selectedIndex = i; }

    // Reporter: auto from the logged-in user (no typing needed). Falls back to
    // an editable field for anonymous floor reporting when not logged in.
    var u = Auth.get();
    var reporterEl = document.getElementById('reporter');
    var reporterHint = document.getElementById('reporterHint');
    if (u && u.name) {
      reporterEl.value = u.name;
      reporterEl.readOnly = true;
      reporterEl.style.background = 'var(--surface-2)';
      reporterHint.textContent = 'อัตโนมัติจากผู้ใช้ที่เข้าสู่ระบบ';
    } else {
      reporterHint.innerHTML = 'หรือ <a href="login.html?next=index.html">เข้าสู่ระบบ</a> เพื่อกรอกชื่ออัตโนมัติ';
    }

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

    // Shift comes from the logged-in user's assigned shift; falls back to
    // time-of-day only if the user has no shift set.
    var shift = (u && u.shift) || U.detectShift(new Date(), cfg);
    document.getElementById('shiftInfo').textContent =
      'วันที่ ' + U.thaiDate(new Date()) + ' • กะ ' + shift +
      ((u && u.shift) ? ' (จากผู้ใช้)' : ' (ตามเวลา)');

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

    // Fire-and-forget so it never slows down the report form itself.
    loadPendingJobs();
  }

  var OPEN_STATUSES = ['แจ้งซ่อม', 'รับงานแล้ว', 'กำลังซ่อม', 'รออะไหล่'];

  async function loadPendingJobs() {
    var card = document.getElementById('pendingJobsCard');
    var list = document.getElementById('pendingJobsList');
    try {
      var jobs = await API.call('getBMJobs', {});
      var open = jobs.filter(function (j) { return OPEN_STATUSES.indexOf(j.status) >= 0; });
      if (!open.length) { card.style.display = 'none'; return; }

      open.sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });
      var shown = open.slice(0, 6);

      list.innerHTML = shown.map(function (j) {
        return '<div class="pending-row">' +
          '<div class="pj-info">' +
            '<div class="pj-mtjob">' + U.escapeHtml(j.mtJob) + ' • ' + U.escapeHtml(j.line) + ' ' + U.escapeHtml(j.mc) + '</div>' +
            '<div class="pj-meta">' + U.escapeHtml((j.symptom || '').substring(0, 40)) + ' — รอมาแล้ว ' + U.elapsed(j.timestamp) + '</div>' +
          '</div>' +
          '<button class="btn small warning" data-close-mt="' + U.escapeHtml(j.mtJob) + '">ดึงมาปิดจ็อบ</button>' +
        '</div>';
      }).join('') + (open.length > shown.length ? '<div class="hint">และอีก ' + (open.length - shown.length) + ' งาน — ดูทั้งหมดที่บอร์ดงาน</div>' : '');

      list.querySelectorAll('[data-close-mt]').forEach(function (btn) {
        btn.onclick = function () {
          location.href = 'jobs.html?closeJob=' + encodeURIComponent(btn.getAttribute('data-close-mt'));
        };
      });

      card.style.display = 'block';
    } catch (e) {
      card.style.display = 'none'; // silent — this is a convenience widget, not core to reporting
    }
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
      shift: (Auth.get() && Auth.get().shift) || U.detectShift(new Date(), cfg),
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
