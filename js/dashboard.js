/* dashboard.html — KPIs + charts (Chart.js) */
(function () {
  var charts = {};
  var PALETTE = ['#2563eb', '#dc2626', '#d97706', '#16a34a', '#7c3aed', '#0891b2', '#db2777'];

  function kpiCard(label, value, unit) {
    return '<div class="kpi"><div class="kpi-label">' + label + '</div>' +
      '<div class="kpi-value">' + value + ' <span class="kpi-unit">' + (unit || '') + '</span></div></div>';
  }

  function renderKPIs(k) {
    document.getElementById('kpis').innerHTML =
      kpiCard('Downtime รวม', k.totalDowntime, 'นาที') +
      kpiCard('Downtime %', k.downtimePct, '%') +
      kpiCard('จำนวนงาน BM', k.bmCount, 'งาน') +
      kpiCard('MTTR เฉลี่ย', k.mttr, 'นาที') +
      kpiCard('งานค้าง', k.openJobs, 'งาน') +
      kpiCard('PM Compliance', k.pmCompliance, '%');
  }

  function draw(id, type, labels, data, label, colorAll) {
    if (charts[id]) charts[id].destroy();
    var ctx = document.getElementById(id).getContext('2d');
    var colors = colorAll ? labels.map(function (_, i) { return PALETTE[i % PALETTE.length]; }) : PALETTE[0];
    charts[id] = new Chart(ctx, {
      type: type,
      data: {
        labels: labels,
        datasets: [{
          label: label, data: data,
          backgroundColor: colors,
          borderColor: type === 'line' ? PALETTE[0] : colors,
          borderWidth: type === 'line' ? 2 : 0,
          fill: type === 'line' ? false : true,
          tension: 0.3, pointRadius: 3
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    });
  }

  function renderCharts(d) {
    draw('paretoChart', 'bar', d.pareto.map(k), d.pareto.map(v), 'จำนวนครั้ง', true);
    draw('dailyChart', 'line', d.daily.map(function (x) { return U.thaiDate(x.key); }), d.daily.map(v), 'Downtime (นาที)');
    draw('stationChart', 'bar', d.topStations.map(k), d.topStations.map(v), 'จำนวนครั้ง', true);
    draw('mttrChart', 'bar', d.mttrByIssue.map(k), d.mttrByIssue.map(v), 'MTTR (นาที)', true);
    draw('lineChart', 'bar', d.byLine.map(k), d.byLine.map(v), 'Downtime (นาที)', true);
  }
  function k(x) { return x.key; }
  function v(x) { return x.value; }

  function statusBadge(s) {
    if (s === 'ปิดงาน') return '<span class="pill ok">ปิดงาน</span>';
    if (s === 'แจ้งซ่อม') return '<span class="pill overdue">แจ้งซ่อม</span>';
    return '<span class="pill">' + U.escapeHtml(s) + '</span>';
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

  async function load() {
    var overlay = document.getElementById('overlay');
    overlay.classList.add('show');
    var period = document.getElementById('period').value;
    var payload = { period: period, line: document.getElementById('fLine').value };
    if (period === 'custom') {
      payload.from = document.getElementById('fromDate').value;
      payload.to = document.getElementById('toDate').value;
      if (!payload.from || !payload.to) { overlay.classList.remove('show'); return U.toast('เลือกช่วงวันที่ให้ครบ', 'error'); }
    }
    try {
      var d = await API.call('getDashboard', payload);
      renderKPIs(d.kpi);
      renderCharts(d);
      renderRecent(d.recent || []);
    } catch (e) {
      U.toast('โหลดแดชบอร์ดไม่สำเร็จ: ' + e.message, 'error');
    } finally {
      overlay.classList.remove('show');
    }
  }

  async function init() {
    Auth.renderUserBadge('userBadge');
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
    document.getElementById('applyBtn').onclick = load;
    document.getElementById('fLine').addEventListener('change', load);
    await load();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
