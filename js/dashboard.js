/* dashboard.html — Overview (period KPIs + charts) + all-time History, one page */
(function () {
  var charts = {};
  var PALETTE = ['#2563eb', '#dc2626', '#d97706', '#16a34a', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#0d9488'];
  var TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  var historyLoaded = false;

  function monthLabel(key) { // 'YYYY-MM' -> 'ก.ค. 26'
    var p = String(key).split('-');
    var mo = parseInt(p[1], 10) - 1;
    return (TH_MONTHS[mo] || p[1]) + ' ' + String(p[0]).slice(2);
  }

  /** Animates a KPI's number from 0 to its final value; falls back to
   * setting it immediately for non-numeric values (e.g. station names). */
  function countUp(el, value) {
    var target = parseFloat(value);
    if (isNaN(target)) { el.textContent = value; return; }
    var isInt = Number.isInteger(target);
    var start = performance.now(), dur = 700;
    function tick(now) {
      var t = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - t, 3);
      var cur = target * eased;
      el.textContent = isInt ? Math.round(cur) : cur.toFixed(1);
      if (t < 1) requestAnimationFrame(tick);
      else el.textContent = value;
    }
    requestAnimationFrame(tick);
  }

  function kpiCard(icon, accent, label, value, unit) {
    return '<div class="kpi acc-' + accent + '">' +
      '<div class="kpi-icon">' + icon + '</div>' +
      '<div class="kpi-label">' + label + '</div>' +
      '<div class="kpi-value"><span data-count="' + U.escapeHtml(String(value)) + '">0</span> <span class="kpi-unit">' + (unit || '') + '</span></div>' +
      '</div>';
  }

  /** Kick off the count-up animation for every KPI value inside a container,
   * right after its HTML has been injected. */
  function animateKpis(container) {
    container.querySelectorAll('[data-count]').forEach(function (el) {
      countUp(el, el.getAttribute('data-count'));
    });
  }

  function draw(id, type, labels, data, opts) {
    opts = opts || {};
    if (charts[id]) charts[id].destroy();
    var ctx = document.getElementById(id).getContext('2d');
    var colors = opts.multi ? labels.map(function (_, i) { return PALETTE[i % PALETTE.length]; }) : PALETTE[0];
    charts[id] = new Chart(ctx, {
      type: type,
      data: { labels: labels, datasets: [{
        label: opts.label || '', data: data,
        backgroundColor: (type === 'doughnut' || opts.multi) ? colors : (type === 'line' ? 'rgba(37,99,235,.12)' : PALETTE[0]),
        borderColor: type === 'line' ? PALETTE[0] : (type === 'doughnut' ? '#fff' : colors),
        borderWidth: type === 'line' ? 2.5 : (type === 'doughnut' ? 2 : 0),
        fill: type === 'line', tension: 0.3, pointRadius: 3, pointBackgroundColor: PALETTE[0]
      }]},
      options: {
        responsive: true, maintainAspectRatio: false,
        indexAxis: opts.horizontal ? 'y' : 'x',
        plugins: { legend: { display: type === 'doughnut', position: 'bottom' } },
        scales: (type === 'doughnut') ? {} : { x: { beginAtZero: true }, y: { beginAtZero: true } }
      }
    });
  }
  function k(x) { return x.key; }
  function v(x) { return x.value; }

  function statusBadge(s) {
    if (s === 'ปิดงาน') return '<span class="pill ok">ปิดงาน</span>';
    if (s === 'แจ้งซ่อม') return '<span class="pill overdue">แจ้งซ่อม</span>';
    return '<span class="pill">' + U.escapeHtml(s) + '</span>';
  }

  // ---------------------------------------------------------------------
  // Overview tab (period-filterable operational KPIs)
  // ---------------------------------------------------------------------

  function renderKPIs(kd) {
    var el = document.getElementById('kpis');
    el.innerHTML =
      kpiCard('⏱️', 'red',    'Downtime รวม', kd.totalDowntime, 'นาที') +
      kpiCard('📉', 'orange', 'Downtime %', kd.downtimePct, '%') +
      kpiCard('🛠️', 'blue',   'จำนวนงาน BM', kd.bmCount, 'งาน') +
      kpiCard('⚡', 'purple', 'MTTR เฉลี่ย', kd.mttr, 'นาที') +
      kpiCard('🕗', 'amber',  'งานค้าง', kd.openJobs, 'งาน') +
      kpiCard('✅', 'green',  'PM Compliance', kd.pmCompliance, '%');
    animateKpis(el);
  }

  function renderCharts(d) {
    draw('paretoChart', 'bar', d.pareto.map(k), d.pareto.map(v), { multi: true, label: 'จำนวนครั้ง' });
    draw('dailyChart', 'line', d.daily.map(function (x) { return U.thaiDate(x.key); }), d.daily.map(v), { label: 'Downtime (นาที)' });
    draw('stationChart', 'bar', d.topStations.map(k), d.topStations.map(v), { multi: true, label: 'จำนวนครั้ง' });
    draw('mttrChart', 'bar', d.mttrByIssue.map(k), d.mttrByIssue.map(v), { multi: true, label: 'MTTR (นาที)' });
    draw('lineChart', 'bar', d.byLine.map(k), d.byLine.map(v), { multi: true, label: 'Downtime (นาที)' });
  }

  function renderRecent(rows) {
    var tb = document.querySelector('#recentTable tbody');
    if (!rows.length) { tb.innerHTML = '<tr><td colspan="7" class="empty">ไม่มีข้อมูล</td></tr>'; return; }
    tb.innerHTML = rows.map(function (j) {
      return '<tr><td>' + U.escapeHtml(j.mtJob) + '</td><td>' + U.thaiDate(j.date) + '</td>' +
        '<td>' + U.escapeHtml(j.line) + '</td><td>' + U.escapeHtml(j.mc) + '</td>' +
        '<td>' + U.escapeHtml((j.symptom || '').substring(0, 30)) + '</td>' +
        '<td>' + statusBadge(j.status) + '</td>' +
        '<td class="right">' + (j.downtime || 0) + '</td></tr>';
    }).join('');
  }

  async function loadOverview() {
    var kpisEl = document.getElementById('kpis');
    var isFirstLoad = kpisEl.dataset.loaded !== '1';
    U.progress(true);
    if (isFirstLoad) kpisEl.innerHTML = U.skeletonKpis(6);

    var period = document.getElementById('period').value;
    var payload = { period: period, line: document.getElementById('fLine').value };
    if (period === 'custom') {
      payload.from = document.getElementById('fromDate').value;
      payload.to = document.getElementById('toDate').value;
      if (!payload.from || !payload.to) { U.progress(false); return U.toast('เลือกช่วงวันที่ให้ครบ', 'error'); }
    }
    try {
      var d = await API.call('getDashboard', payload);
      renderKPIs(d.kpi);
      renderCharts(d);
      renderRecent(d.recent || []);
      kpisEl.dataset.loaded = '1';
    } catch (e) {
      U.toast('โหลดแดชบอร์ดไม่สำเร็จ: ' + e.message, 'error');
    } finally {
      U.progress(false);
    }
  }

  // ---------------------------------------------------------------------
  // History tab (all-time retrospective analytics)
  // ---------------------------------------------------------------------

  function renderHistoryKPIs(s) {
    var el = document.getElementById('hKpis');
    el.innerHTML =
      kpiCard('📋', 'blue',   'งานแจ้งซ่อมรวม', s.totalBM, 'งาน') +
      kpiCard('📊', 'purple', 'เฉลี่ยต่อเดือน', s.avgPerMonth, 'งาน') +
      kpiCard('📅', 'red',    'เดือนที่เสียมากสุด', monthLabel(s.busiestMonth.key), '(' + s.busiestMonth.value + ')') +
      kpiCard('🏭', 'orange', 'Station เสียบ่อยสุด', U.escapeHtml(s.worstStation.key), '(' + s.worstStation.value + ')') +
      kpiCard('🏗️', 'amber',  'ไลน์ที่เสียมากสุด', U.escapeHtml(s.worstLine.key), '(' + s.worstLine.value + ')') +
      kpiCard('🗓️', 'teal',   'ช่วงข้อมูล', s.months, 'เดือน');
    animateKpis(el);
    document.getElementById('hRangeSub').textContent =
      'ข้อมูลจริง ' + U.thaiDate(s.firstDate) + ' – ' + U.thaiDate(s.lastDate) +
      ' • ' + s.totalBM + ' งานแจ้งซ่อม • ' + s.repairRecords + ' บันทึกการซ่อม';
  }

  function renderMonthTable(months) {
    var tb = document.querySelector('#hMonthTable tbody');
    if (!months.length) { tb.innerHTML = '<tr><td colspan="3" class="empty">ไม่มีข้อมูล</td></tr>'; return; }
    var max = Math.max.apply(null, months.map(v));
    tb.innerHTML = months.map(function (m) {
      var pct = Math.round((m.value / max) * 100);
      return '<tr><td>' + monthLabel(m.key) + '</td><td class="right">' + m.value + '</td>' +
        '<td><div style="background:var(--primary);height:8px;border-radius:4px;width:' + pct + '%;min-width:4px"></div></td></tr>';
    }).join('');
  }

  async function loadHistory() {
    var overlay = document.getElementById('overlay');
    overlay.classList.add('show');
    try {
      var d = await API.call('getHistory', {});
      renderHistoryKPIs(d.summary);
      draw('hMonthChart', 'line', d.byMonth.map(function (m) { return monthLabel(m.key); }), d.byMonth.map(v), { label: 'จำนวนงาน' });
      draw('hIssueChart', 'bar', d.byMainIssue.map(k), d.byMainIssue.map(v), { multi: true, label: 'จำนวนครั้ง' });
      draw('hStationChart', 'bar', d.byStation.map(k), d.byStation.map(v), { multi: true, horizontal: true, label: 'จำนวนครั้ง' });
      draw('hLineChart', 'doughnut', d.byLine.map(k), d.byLine.map(v), { multi: true });
      draw('hShiftChart', 'doughnut', d.byShift.map(function (x) { return 'กะ ' + x.key; }), d.byShift.map(v), { multi: true });
      draw('hTopIssueChart', 'bar', d.topIssues.map(k), d.topIssues.map(v), { multi: true, horizontal: true, label: 'จำนวนครั้ง' });
      renderMonthTable(d.byMonth);
      historyLoaded = true;
    } catch (e) {
      U.toast('โหลดประวัติไม่สำเร็จ: ' + e.message, 'error');
    } finally {
      overlay.classList.remove('show');
    }
  }

  // ---------------------------------------------------------------------
  // Tabs + init
  // ---------------------------------------------------------------------

  function initTabs() {
    document.querySelectorAll('.tabs [data-tab]').forEach(function (b) {
      b.onclick = function () {
        document.querySelectorAll('.tabs [data-tab]').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        var t = b.getAttribute('data-tab');
        document.getElementById('overviewView').style.display = (t === 'overview') ? 'block' : 'none';
        document.getElementById('historyView').style.display = (t === 'history') ? 'block' : 'none';
        if (t === 'history' && !historyLoaded) loadHistory();
      };
    });
  }

  async function init() {
    Auth.renderUserBadge('userBadge');
    document.getElementById('heroDate').textContent = U.thaiDate(new Date());
    initTabs();
    try {
      var cfg = await API.getConfig();
      var fl = document.getElementById('fLine');
      (cfg.Line || []).forEach(function (x) { fl.appendChild(new Option(x, x)); });
    } catch (e) {}

    document.getElementById('period').addEventListener('change', function () {
      var custom = this.value === 'custom';
      document.getElementById('fromDate').style.display = custom ? 'block' : 'none';
      document.getElementById('toDate').style.display = custom ? 'block' : 'none';
    });
    document.getElementById('applyBtn').onclick = loadOverview;
    document.getElementById('fLine').addEventListener('change', loadOverview);
    await loadOverview();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
