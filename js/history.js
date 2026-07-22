/* history.html — all-time retrospective analytics (frequency-based) */
(function () {
  var charts = {};
  var PALETTE = ['#2563eb', '#dc2626', '#d97706', '#16a34a', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#0d9488'];

  var TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  function monthLabel(key) { // 'YYYY-MM' -> 'ก.ค. 26'
    var p = String(key).split('-');
    var m = parseInt(p[1], 10) - 1;
    return (TH_MONTHS[m] || p[1]) + ' ' + String(p[0]).slice(2);
  }

  function kpiCard(label, value, unit) {
    return '<div class="kpi"><div class="kpi-label">' + label + '</div>' +
      '<div class="kpi-value">' + value + ' <span class="kpi-unit">' + (unit || '') + '</span></div></div>';
  }

  function renderKPIs(s) {
    document.getElementById('kpis').innerHTML =
      kpiCard('งานแจ้งซ่อมรวม', s.totalBM, 'งาน') +
      kpiCard('เฉลี่ยต่อเดือน', s.avgPerMonth, 'งาน') +
      kpiCard('เดือนที่เสียมากสุด', monthLabel(s.busiestMonth.key), '(' + s.busiestMonth.value + ')') +
      kpiCard('Station เสียบ่อยสุด', U.escapeHtml(s.worstStation.key), '(' + s.worstStation.value + ')') +
      kpiCard('ไลน์ที่เสียมากสุด', U.escapeHtml(s.worstLine.key), '(' + s.worstLine.value + ')') +
      kpiCard('ช่วงข้อมูล', s.months, 'เดือน');
    document.getElementById('rangeSub').textContent =
      'ข้อมูลจริง ' + U.thaiDate(s.firstDate) + ' – ' + U.thaiDate(s.lastDate) +
      ' • ' + s.totalBM + ' งานแจ้งซ่อม • ' + s.repairRecords + ' บันทึกการซ่อม';
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
  function k(x) { return x.key; } function v(x) { return x.value; }

  function renderMonthTable(months, total) {
    var tb = document.querySelector('#monthTable tbody');
    if (!months.length) { tb.innerHTML = '<tr><td colspan="3" class="empty">ไม่มีข้อมูล</td></tr>'; return; }
    var max = Math.max.apply(null, months.map(v));
    tb.innerHTML = months.map(function (m) {
      var pct = Math.round((m.value / max) * 100);
      return '<tr><td>' + monthLabel(m.key) + '</td><td class="right">' + m.value + '</td>' +
        '<td><div style="background:var(--primary);height:8px;border-radius:4px;width:' + pct + '%;min-width:4px"></div></td></tr>';
    }).join('');
  }

  async function load() {
    var overlay = document.getElementById('overlay');
    overlay.classList.add('show');
    try {
      var d = await API.call('getHistory', {});
      renderKPIs(d.summary);
      draw('monthChart', 'line', d.byMonth.map(function (m) { return monthLabel(m.key); }), d.byMonth.map(v), { label: 'จำนวนงาน' });
      draw('issueChart', 'bar', d.byMainIssue.map(k), d.byMainIssue.map(v), { multi: true, label: 'จำนวนครั้ง' });
      draw('stationChart', 'bar', d.byStation.map(k), d.byStation.map(v), { multi: true, horizontal: true, label: 'จำนวนครั้ง' });
      draw('lineChart', 'doughnut', d.byLine.map(k), d.byLine.map(v), { multi: true });
      draw('shiftChart', 'doughnut', d.byShift.map(function (x) { return 'กะ ' + x.key; }), d.byShift.map(v), { multi: true });
      draw('topIssueChart', 'bar', d.topIssues.map(k), d.topIssues.map(v), { multi: true, horizontal: true, label: 'จำนวนครั้ง' });
      renderMonthTable(d.byMonth, d.summary.totalBM);
    } catch (e) {
      U.toast('โหลดประวัติไม่สำเร็จ: ' + e.message, 'error');
    } finally {
      overlay.classList.remove('show');
    }
  }

  document.addEventListener('DOMContentLoaded', load);
})();
