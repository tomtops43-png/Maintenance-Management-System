/* audit.html — the PM report that leaves the building.
 *
 * Everything else in this app is for the people doing the work. This page is
 * for the person auditing it: planned vs actual over a window, what was found
 * and what was done about it, and a signature block — on paper, because that
 * is still what an audit runs on. Print CSS lives under @media print in
 * style.css; the layout here is the same document on screen and on paper so
 * nobody is surprised by what comes out of the printer.
 */
(function () {
  var cfg = null;
  var report = null;   // last report built, kept for the CSV export

  function esc(s) { return U.escapeHtml(s); }

  // ---- filters -------------------------------------------------------------

  function fillSelect(el, items, placeholder) {
    var keep = el.value;
    el.innerHTML = '';
    if (placeholder) el.appendChild(new Option(placeholder, ''));
    (items || []).forEach(function (v) { el.appendChild(new Option(v, v)); });
    if (keep && items && items.indexOf(keep) >= 0) el.value = keep;
  }

  function refreshPickers() {
    if (!cfg) return;
    var areaSel = document.getElementById('fArea');
    var lineSel = document.getElementById('fLine');
    var mcSel = document.getElementById('fMc');

    var lines = areaSel.value ? U.linesForArea(cfg, areaSel.value) : (cfg.Line || []);
    if (lineSel.value && lines.indexOf(lineSel.value) < 0) lineSel.value = '';
    fillSelect(lineSel, lines, 'ทุกไลน์');

    var machines = lineSel.value
      ? U.machinesFor(cfg, areaSel.value || (cfg.AreaOfLine || {})[lineSel.value], lineSel.value)
      : [];
    if (mcSel.value && machines.indexOf(mcSel.value) < 0) mcSel.value = '';
    fillSelect(mcSel, machines, 'ทุกเครื่อง');
    mcSel.disabled = !machines.length;
  }

  /** The windows an audit actually gets asked for, so nobody has to work out
   * "first day of the quarter" by hand in front of the auditor. */
  function applyPeriod(key) {
    var now = new Date();
    var from, to;
    if (key === 'month') {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else if (key === 'lastmonth') {
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      to = new Date(now.getFullYear(), now.getMonth(), 0);
    } else if (key === 'quarter') {
      var q = Math.floor(now.getMonth() / 3) * 3;
      from = new Date(now.getFullYear(), q, 1);
      to = new Date(now.getFullYear(), q + 3, 0);
    } else if (key === 'year') {
      from = new Date(now.getFullYear(), 0, 1);
      to = new Date(now.getFullYear(), 11, 31);
    } else {
      return;
    }
    document.getElementById('fFrom').value = U.ymd(from);
    document.getElementById('fTo').value = U.ymd(to);
  }

  // ---- report --------------------------------------------------------------

  function scopeText(f) {
    var parts = [f.area, f.line, f.mc].filter(Boolean);
    return parts.length ? parts.join(' / ') : 'ทุกไลน์ / ทุกเครื่อง';
  }

  function kpi(label, value, sub, tone) {
    return '<div class="kpi' + (tone ? ' kpi-' + tone : '') + '">' +
      '<div class="kpi-label">' + esc(label) + '</div>' +
      '<div class="kpi-value">' + esc(value) + '</div>' +
      '<div class="kpi-sub">' + esc(sub || '') + '</div></div>';
  }

  function headerHtml(d) {
    var u = (window.Auth && Auth.get()) || {};
    return '<div class="card audit-head">' +
      '<div class="audit-title">รายงานการบำรุงรักษาเชิงป้องกัน (Preventive Maintenance Report)</div>' +
      '<div class="audit-meta">' +
        '<div><span>ช่วงเวลา</span><b>' + U.thaiDate(d.range.from) + ' — ' + U.thaiDate(d.range.to) + '</b></div>' +
        '<div><span>ขอบเขต</span><b>' + esc(scopeText(d.filter)) + '</b></div>' +
        '<div><span>ออกรายงานเมื่อ</span><b>' + U.thaiDateTime(d.generatedAt) + '</b></div>' +
        '<div><span>ผู้ออกรายงาน</span><b>' + esc(u.name || '-') + '</b></div>' +
      '</div>' +
    '</div>';
  }

  function summaryHtml(s) {
    return '<div class="kpi-grid audit-kpi">' +
      kpi('ต้องทำตามแผน', s.expected + ' ครั้ง', s.plans + ' แผน') +
      kpi('ทำจริง', s.done + ' ครั้ง', 'บันทึกในระบบ') +
      kpi('ตรงเวลา', s.onTime + ' ครั้ง', s.done ? (s.onTimeRate + '% ของที่ทำ') : '-') +
      kpi('ทำล่าช้า', s.late + ' ครั้ง', s.late ? 'เกินวันครบกำหนด' : 'ไม่มี') +
      kpi('ยังไม่ได้ทำ', s.missed + ' ครั้ง', s.missed ? 'ต้องชี้แจง' : 'ครบตามแผน', s.missed ? 'bad' : 'good') +
      kpi('PM Compliance', s.compliance + '%', 'ทำจริง ÷ ตามแผน', s.compliance >= 90 ? 'good' : 'bad') +
    '</div>';
  }

  function planTableHtml(d) {
    if (!d.plans.length) {
      return '<div class="card"><div class="empty">ไม่มีแผน PM ที่ถึงกำหนดหรือมีการบันทึกในช่วงเวลานี้</div></div>';
    }
    var rows = d.plans.map(function (p, i) {
      var gap = p.missed > 0;
      return '<tr' + (gap ? ' class="row-gap"' : '') + '>' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + esc(p.pmItem) + (p.active ? '' : ' <span class="pill">ปิดแผนแล้ว</span>') +
          (p.standard ? '<div class="mh-sub">เกณฑ์: ' + esc(p.standard) + '</div>' : '') + '</td>' +
        '<td>' + esc(p.line) + '</td>' +
        '<td>' + esc(p.mcStation) + '</td>' +
        '<td>' + esc(p.frequency) + '</td>' +
        '<td class="num">' + p.expected + '</td>' +
        '<td class="num">' + p.done + '</td>' +
        '<td class="num">' + p.onTime + '</td>' +
        '<td class="num">' + (p.late || '-') + '</td>' +
        '<td class="num' + (gap ? ' num-bad' : '') + '">' + (p.missed || '-') + '</td>' +
        '<td class="num">' + (p.ng || '-') + '</td>' +
        '<td>' + (p.lastDone ? U.thaiDate(p.lastDone) + '<div class="mh-sub">' + esc(p.lastBy || '') + '</div>' : '-') + '</td>' +
      '</tr>';
    }).join('');

    return '<div class="card audit-block">' +
      '<div class="ch-title audit-section">1. แผน PM เทียบกับการปฏิบัติจริง</div>' +
      '<div class="table-wrap"><table class="audit-table">' +
      '<thead><tr><th>#</th><th>รายการ PM</th><th>ไลน์</th><th>เครื่อง</th><th>ความถี่</th>' +
      '<th class="num">ตามแผน</th><th class="num">ทำจริง</th><th class="num">ตรงเวลา</th>' +
      '<th class="num">ล่าช้า</th><th class="num">ยังไม่ทำ</th><th class="num">NG</th><th>ทำล่าสุด</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
  }

  function ngTableHtml(d) {
    if (!d.ng.length) {
      return '<div class="card audit-block">' +
        '<div class="ch-title audit-section">2. รายการที่ตรวจพบผิดปกติ (NG) และการแก้ไข</div>' +
        '<div class="empty">ไม่พบรายการ NG ในช่วงเวลานี้</div></div>';
    }
    var rows = d.ng.map(function (r, i) {
      var follow = r.followUp
        ? esc(r.followUp.mtJob) + '<div class="mh-sub">' + esc(r.followUp.status) + '</div>'
        : '<span class="mh-sub">ไม่ได้เปิดงานซ่อม</span>';
      return '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + U.thaiDate(r.doneAt) + '</td>' +
        '<td>' + esc(r.pmItem || r.pmId) + '</td>' +
        '<td>' + esc(r.line) + ' / ' + esc(r.mcStation) + '</td>' +
        '<td>' + esc(r.ngDetail || '-') + '</td>' +
        '<td>' + esc(r.actionTaken || '-') + '</td>' +
        '<td>' + follow + '</td>' +
        '<td>' + esc(r.technician || '-') + '</td>' +
        '<td class="no-print">' + (r.photoUrl
          ? '<a class="mh-link" href="' + esc(r.photoUrl) + '" target="_blank" rel="noopener">📷 ดูรูป</a>'
          : '-') + '</td>' +
      '</tr>';
    }).join('');

    return '<div class="card audit-block">' +
      '<div class="ch-title audit-section">2. รายการที่ตรวจพบผิดปกติ (NG) และการแก้ไข</div>' +
      '<div class="table-wrap"><table class="audit-table">' +
      '<thead><tr><th>#</th><th>วันที่</th><th>รายการ PM</th><th>ไลน์ / เครื่อง</th>' +
      '<th>สิ่งที่ตรวจพบ</th><th>การแก้ไข</th><th>งานซ่อมที่ตามต่อ</th><th>ผู้ตรวจ</th>' +
      '<th class="no-print">หลักฐาน</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
  }

  /** How the numbers were arrived at. An auditor is entitled to check the
   * arithmetic, and the data-start caveat is a limit of the system that has
   * to be on the page rather than in someone's head. */
  function notesHtml(d) {
    var notes = [
      '“ตามแผน” คำนวณจากความถี่ของแต่ละแผน โดยไล่ย้อนจากวันครบกำหนดถัดไป (Next_Due) ' +
        'มาตลอดช่วงเวลาที่เลือก',
      '“ยังไม่ทำ” = ตามแผน − ทำจริง (ไม่ติดลบ) · PM Compliance = ทำจริง ÷ ตามแผน',
      'แผนที่ปิดไปแล้วจะนับเฉพาะงานที่ทำจริง ไม่ถูกนับเป็นงานค้าง'
    ];
    if (d.dataStart) {
      notes.push('ระบบเริ่มบันทึกผล PM เมื่อ ' + U.thaiDate(d.dataStart) +
        ' — ช่วงก่อนหน้านั้นไม่มีข้อมูลในระบบ จึงไม่ถูกนำมานับเป็นงานค้าง');
    } else {
      notes.push('ยังไม่มีการบันทึกผล PM ในระบบเลย รายงานนี้จึงยังตรวจสอบย้อนหลังไม่ได้');
    }
    return '<div class="card audit-block audit-notes">' +
      '<div class="ch-title audit-section">หมายเหตุวิธีคำนวณ</div><ul>' +
      notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') +
      '</ul></div>';
  }

  function signHtml() {
    var u = (window.Auth && Auth.get()) || {};
    var boxes = [
      ['ผู้จัดทำรายงาน', u.name || ''],
      ['หัวหน้าแผนกซ่อมบำรุง', ''],
      ['ผู้ตรวจสอบ / Auditor', '']
    ];
    return '<div class="card audit-block audit-sign">' +
      boxes.map(function (b) {
        return '<div class="sign-box">' +
          '<div class="sign-line"></div>' +
          '<div class="sign-role">' + esc(b[0]) + '</div>' +
          '<div class="sign-name">' + (b[1] ? '( ' + esc(b[1]) + ' )' : '(&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;)') + '</div>' +
          '<div class="sign-date">วันที่ ......../......../........</div>' +
        '</div>';
      }).join('') + '</div>';
  }

  function render(d) {
    document.getElementById('report').innerHTML =
      headerHtml(d) + summaryHtml(d.summary) + planTableHtml(d) +
      ngTableHtml(d) + notesHtml(d) + signHtml();
  }

  async function build() {
    var from = document.getElementById('fFrom').value;
    var to = document.getElementById('fTo').value;
    if (!from || !to) return U.toast('เลือกช่วงเวลาก่อน', 'error');
    if (from > to) return U.toast('วันที่เริ่มต้นอยู่หลังวันที่สิ้นสุด', 'error');

    var body = document.getElementById('report');
    body.innerHTML = '<div class="empty">กำลังรวบรวมข้อมูล...</div>';
    U.progress(true);
    setExportEnabled(false);
    try {
      report = await API.call('getPMAudit', {
        from: from, to: to,
        area: document.getElementById('fArea').value,
        line: document.getElementById('fLine').value,
        mc: document.getElementById('fMc').value
      });
      render(report);
      setExportEnabled(true);
    } catch (e) {
      report = null;
      body.innerHTML = '<div class="empty">สร้างรายงานไม่สำเร็จ: ' + esc(e.message) + '</div>';
    } finally { U.progress(false); }
  }

  function setExportEnabled(on) {
    document.getElementById('printBtn').disabled = !on;
    document.getElementById('csvBtn').disabled = !on;
  }

  // ---- CSV -----------------------------------------------------------------

  function csvCell(v) {
    var s = String(v === undefined || v === null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function downloadCsv() {
    if (!report) return;
    var lines = [];
    lines.push(['รายงาน PM', U.thaiDate(report.range.from) + ' - ' + U.thaiDate(report.range.to),
      scopeText(report.filter)].map(csvCell).join(','));
    lines.push('');
    lines.push(['รายการ PM', 'ไลน์', 'เครื่อง', 'ความถี่', 'ตามแผน', 'ทำจริง',
      'ตรงเวลา', 'ล่าช้า', 'ยังไม่ทำ', 'NG', 'ทำล่าสุด', 'ผู้ทำล่าสุด', 'เกณฑ์'].map(csvCell).join(','));
    report.plans.forEach(function (p) {
      lines.push([p.pmItem, p.line, p.mcStation, p.frequency, p.expected, p.done,
        p.onTime, p.late, p.missed, p.ng, p.lastDone ? U.thaiDate(p.lastDone) : '',
        p.lastBy, p.standard].map(csvCell).join(','));
    });
    if (report.ng.length) {
      lines.push('');
      lines.push(['รายการ NG', 'วันที่', 'ไลน์', 'เครื่อง', 'สิ่งที่ตรวจพบ',
        'การแก้ไข', 'งานซ่อมที่ตามต่อ', 'ผู้ตรวจ'].map(csvCell).join(','));
      report.ng.forEach(function (r) {
        lines.push([r.pmItem, U.thaiDate(r.doneAt), r.line, r.mcStation, r.ngDetail,
          r.actionTaken, r.followUp ? r.followUp.mtJob : '', r.technician].map(csvCell).join(','));
      });
    }

    // Excel reads a CSV as the system codepage unless the file starts with a
    // BOM — without it every Thai character opens as mojibake.
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'PM_Audit_' + U.ymd(report.range.from) + '_' + U.ymd(report.range.to) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ---- init ----------------------------------------------------------------

  async function init() {
    Auth.renderUserBadge('userBadge');
    applyPeriod('month');

    document.getElementById('fPeriod').addEventListener('change', function () {
      applyPeriod(this.value);
    });
    document.getElementById('goBtn').onclick = build;
    document.getElementById('printBtn').onclick = function () { window.print(); };
    document.getElementById('csvBtn').onclick = downloadCsv;

    try {
      cfg = await API.getConfig();
      var areaSel = document.getElementById('fArea');
      var areas = cfg.Area || [];
      fillSelect(areaSel, areas, 'ทุกไลน์หลัก');
      areaSel.style.display = areas.length > 1 ? '' : 'none';
      areaSel.addEventListener('change', refreshPickers);
      document.getElementById('fLine').addEventListener('change', refreshPickers);
      refreshPickers();
    } catch (e) {
      U.toast('โหลดตัวกรองไม่สำเร็จ: ' + e.message, 'error');
    }

    build();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
