/* machine.html — one machine's full service record.
 *
 * The Dashboard answers "which machines break most often". This answers the
 * follow-up a technician actually has in front of the machine: what keeps
 * going wrong with THIS one, how long does it take to fix, and is the gap
 * between failures getting shorter.
 *
 * Deep-linkable: machine.html?area=…&line=…&mc=… so a job card can hand off
 * straight to the right machine.
 */
(function () {
  var cfg = null;

  function esc(s) { return U.escapeHtml(s); }
  function qp(k) { return new URLSearchParams(location.search).get(k) || ''; }

  function fillSelect(el, items, placeholder) {
    el.innerHTML = '';
    if (placeholder) el.appendChild(new Option(placeholder, ''));
    (items || []).forEach(function (v) { el.appendChild(new Option(v, v)); });
  }

  // Same three-level rule the report form uses (js/bm.js machinesFor):
  // a line's own machines if it declares any, else the shared pool for the
  // default area, else the line standing in for itself.
  function linesForArea(area) { return (cfg.LinesByArea && cfg.LinesByArea[area]) || []; }
  function machinesFor(area, line) {
    if (!line) return [];
    var own = (cfg.StationsByLine && cfg.StationsByLine[line]) || [];
    if (own.length) return own;
    if (area === cfg.DefaultArea) return cfg.SharedStations || cfg.Station || [];
    return [line];
  }

  function refreshPickers() {
    var area = document.getElementById('mArea').value;
    var lineSel = document.getElementById('mLine');
    var mcSel = document.getElementById('mMc');

    var lines = linesForArea(area);
    if (lines.indexOf(lineSel.value) < 0) fillSelect(lineSel, lines, '— เลือกไลน์ —');

    var machines = machinesFor(area, lineSel.value);
    if (machines.indexOf(mcSel.value) < 0) fillSelect(mcSel, machines, '— เลือกเครื่อง —');
  }

  var STATUS_CLASS = {
    'แจ้งซ่อม': 'st-new', 'รับงานแล้ว': 'st-repair', 'กำลังซ่อม': 'st-repair',
    'รออะไหล่': 'st-wait', 'ปิดงาน': 'st-done'
  };

  /** "ทุก 12.5 วัน" reads better on the floor than a bare MTBF number, and
   * an interval only exists once a machine has failed twice. */
  function mtbfText(stats) {
    if (stats.totalJobs < 2) return 'ยังคำนวณไม่ได้ (ต้องมีอย่างน้อย 2 ครั้ง)';
    return 'ทุก ~' + stats.mtbfDays + ' วัน';
  }

  function kpiHtml(stats) {
    var cards = [
      ['เสียทั้งหมด', stats.totalJobs + ' ครั้ง', stats.openJobs ? ('ค้างอยู่ ' + stats.openJobs) : 'ปิดครบแล้ว'],
      ['ความถี่การเสีย', mtbfText(stats), 'MTBF'],
      ['เวลาซ่อมเฉลี่ย', stats.mttr + ' นาที', 'MTTR'],
      ['Downtime รวม', stats.totalDowntime + ' นาที', 'เฉพาะงานที่ปิดแล้ว']
    ];
    return '<div class="kpi-grid">' + cards.map(function (c) {
      return '<div class="kpi"><div class="kpi-label">' + esc(c[0]) + '</div>' +
        '<div class="kpi-value">' + esc(c[1]) + '</div>' +
        '<div class="kpi-sub">' + esc(c[2]) + '</div></div>';
    }).join('') + '</div>';
  }

  function issuesHtml(topIssues) {
    if (!topIssues || !topIssues.length) {
      return '<div class="card"><div class="ch-title">อาการที่พบบ่อย</div>' +
        '<div class="empty">ยังไม่มีข้อมูล — จะขึ้นเมื่อมีการปิดงานพร้อมระบุอาการ</div></div>';
    }
    var max = topIssues[0].value || 1;
    return '<div class="card"><div class="ch-title" style="margin-bottom:10px">อาการที่พบบ่อย</div>' +
      topIssues.map(function (i) {
        var pct = Math.round((i.value / max) * 100);
        return '<div class="mh-issue">' +
          '<div class="mh-issue-top"><span>' + esc(i.key) + '</span><b>' + i.value + ' ครั้ง</b></div>' +
          '<div class="mh-bar"><div class="mh-bar-fill" style="width:' + pct + '%"></div></div>' +
        '</div>';
      }).join('') + '</div>';
  }

  function jobsHtml(jobs, truncated) {
    if (!jobs.length) return '<div class="card"><div class="empty">ยังไม่มีประวัติการซ่อมของเครื่องนี้</div></div>';
    var rows = jobs.map(function (j) {
      var problem = [j.mainIssue, j.issue].filter(Boolean).join(' — ');
      return '<tr>' +
        '<td>' + U.thaiDate(j.date || j.timestamp) + '</td>' +
        '<td>' + esc(j.mtJob) + '</td>' +
        '<td>' + esc(j.symptom || '-') + '</td>' +
        '<td>' + esc(problem || '-') + '</td>' +
        '<td>' + (j.status === 'ปิดงาน' ? (j.downtime || 0) + ' น.' : '-') + '</td>' +
        '<td><span class="badge ' + (STATUS_CLASS[j.status] || '') + '">' + esc(j.status) + '</span></td>' +
      '</tr>';
    }).join('');
    return '<div class="card table-wrap">' +
      '<div class="ch-title" style="margin-bottom:10px">ประวัติการแจ้งซ่อม</div>' +
      '<table><thead><tr><th>วันที่</th><th>เลขงาน</th><th>อาการที่แจ้ง</th><th>ปัญหาที่เจอ</th><th>Downtime</th><th>สถานะ</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      (truncated ? '<div class="hint">แสดง ' + jobs.length + ' รายการล่าสุด — ดูทั้งหมดได้ในชีต</div>' : '') +
      '</div>';
  }

  async function load() {
    var area = document.getElementById('mArea').value;
    var line = document.getElementById('mLine').value;
    var mc = document.getElementById('mMc').value;
    if (!mc) return U.toast('กรุณาเลือกเครื่องจักร', 'error');

    var body = document.getElementById('mBody');
    body.innerHTML = '<div class="empty">กำลังโหลด...</div>';

    // Reflect the selection in the URL so the view can be shared or bookmarked.
    history.replaceState(null, '', 'machine.html?area=' + encodeURIComponent(area) +
      '&line=' + encodeURIComponent(line) + '&mc=' + encodeURIComponent(mc));

    var d;
    try {
      d = await API.call('getMachineHistory', { area: area, line: line, mc: mc });
    } catch (e) {
      body.innerHTML = '<div class="empty">โหลดไม่สำเร็จ: ' + esc(e.message) + '</div>';
      return;
    }

    var s = d.stats;
    var since = s.firstFailure
      ? ('บันทึกตั้งแต่ ' + U.thaiDate(s.firstFailure) + ' • ล่าสุด ' + U.thaiDate(s.lastFailure))
      : 'ยังไม่มีประวัติ';

    body.innerHTML =
      '<div class="card"><div class="card-head"><span class="ch-icon">⚙️</span><div>' +
        '<div class="ch-title">' + esc([area, line, mc].filter(Boolean).join(' / ')) + '</div>' +
        '<div class="ch-sub">' + esc(since) + '</div>' +
      '</div></div></div>' +
      kpiHtml(s) +
      issuesHtml(d.topIssues) +
      jobsHtml(d.jobs, d.truncated);
  }

  async function init() {
    Auth.renderUserBadge('userBadge');
    try { cfg = await API.getConfig(); }
    catch (e) { U.toast('โหลดค่าตั้งต้นไม่สำเร็จ: ' + e.message, 'error'); return; }

    var areaSel = document.getElementById('mArea');
    var areas = cfg.Area || [];
    fillSelect(areaSel, areas, areas.length > 1 ? '— เลือกไลน์หลัก —' : '');
    if (areas.length === 1) areaSel.value = areas[0];

    areaSel.addEventListener('change', function () {
      document.getElementById('mLine').value = '';
      document.getElementById('mMc').value = '';
      refreshPickers();
    });
    document.getElementById('mLine').addEventListener('change', function () {
      document.getElementById('mMc').value = '';
      refreshPickers();
    });
    document.getElementById('mGo').onclick = load;
    document.getElementById('mMc').addEventListener('change', function () { if (this.value) load(); });

    refreshPickers();

    // Deep link: fill top-down, refreshing between levels so each option exists.
    var qArea = qp('area'), qLine = qp('line'), qMc = qp('mc');
    if (qMc) {
      if (qArea) areaSel.value = qArea;
      else if (qLine) areaSel.value = (cfg.AreaOfLine || {})[qLine] || areaSel.value;
      refreshPickers();
      if (qLine) document.getElementById('mLine').value = qLine;
      refreshPickers();
      document.getElementById('mMc').value = qMc;
      load();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
