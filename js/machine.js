/* machine.html — one machine's full service record.
 *
 * The Dashboard answers "which machines break most often". This answers the
 * follow-up a technician actually has in front of the machine: what keeps
 * going wrong with THIS one, how long does it take to fix, and is the gap
 * between failures getting shorter.
 *
 * Deep-linkable: machine.html?area=…&line=…&mc=… so a job card can hand off
 * straight to the right machine.
 *
 * Every level can be left on "ทุก…" — the same page then covers a whole
 * line, an area or the plant, and ranks the machines inside it.
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

  var ALL_AREAS = 'ทุกไลน์หลัก', ALL_LINES = 'ทุกไลน์', ALL_MC = 'ทุกเครื่อง';

  /** With no area picked, every line is on offer. */
  function linesForArea(area) {
    return area ? U.linesForArea(cfg, area) : (cfg.Line || []);
  }
  function machinesFor(area, line) {
    return U.machinesFor(cfg, area || (cfg.AreaOfLine || {})[line] || '', line);
  }

  function refreshPickers() {
    var area = document.getElementById('mArea').value;
    var lineSel = document.getElementById('mLine');
    var mcSel = document.getElementById('mMc');

    var lines = linesForArea(area);
    if (lines.indexOf(lineSel.value) < 0) fillSelect(lineSel, lines, '— ' + ALL_LINES + ' —');

    var machines = machinesFor(area, lineSel.value);
    if (machines.indexOf(mcSel.value) < 0) fillSelect(mcSel, machines, '— ' + ALL_MC + ' —');
  }

  function machineName(r) { return [r.line, r.mc].filter(Boolean).join(' / ') || '-'; }

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

  /** Over many machines the gap is between any two failures in the group —
   * true, but not the same claim as one machine's MTBF, so say so. */
  function mtbfSub(single) { return single ? 'MTBF' : 'ทั้งกลุ่มรวมกัน'; }

  /** PM is the half of the record an auditor asks about first, so it gets a
   * card of its own rather than living only in the table below. */
  function pmKpi(stats) {
    if (!stats.pmCount) return ['PM ที่ทำแล้ว', 'ยังไม่มี', 'ยังไม่เคยบันทึก PM เครื่องนี้'];
    var sub = 'ตรงเวลา ' + stats.pmCompliance + '%' + (stats.pmNg ? ' • NG ' + stats.pmNg + ' ครั้ง' : '');
    return ['PM ที่ทำแล้ว', stats.pmCount + ' ครั้ง', sub];
  }

  function kpiHtml(stats, single) {
    var cards = [
      ['เสียทั้งหมด', stats.totalJobs + ' ครั้ง', stats.openJobs ? ('ค้างอยู่ ' + stats.openJobs) : 'ปิดครบแล้ว'],
      ['ความถี่การเสีย', mtbfText(stats), mtbfSub(single)],
      ['เวลาซ่อมเฉลี่ย', stats.mttr + ' นาที', 'MTTR'],
      ['Downtime รวม', stats.totalDowntime + ' นาที', 'เฉพาะงานที่ปิดแล้ว'],
      pmKpi(stats)
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

  /** Over a line or the plant, the ranking IS the answer — which machine to
   * look at first. Each row drills down into that machine's own record. */
  function machinesHtml(list) {
    if (!list || !list.length) return '';
    var body = list.map(function (m) {
      return '<tr class="mh-mc-row" data-area="' + esc(m.area) + '" data-line="' + esc(m.line) + '" data-mc="' + esc(m.mc) + '">' +
        '<td><a class="mh-link" href="#">' + esc(machineName(m)) + '</a>' +
          (m.area ? '<div class="mh-sub">' + esc(m.area) + '</div>' : '') + '</td>' +
        '<td><b>' + m.count + '</b>' + (m.open ? ' <span class="mh-sub">(ค้าง ' + m.open + ')</span>' : '') + '</td>' +
        '<td>' + m.downtime + ' นาที</td>' +
        '<td>' + m.mttr + ' นาที</td>' +
        '<td>' + (m.lastFailure ? U.thaiDate(m.lastFailure) : '-') + '</td>' +
      '</tr>';
    }).join('');
    return '<div class="card"><div class="ch-title" style="margin-bottom:10px">เครื่องที่เสียบ่อย (' + list.length + ' เครื่อง)</div>' +
      '<div class="table-wrap"><table><thead><tr><th>เครื่อง</th><th>เสีย (ครั้ง)</th>' +
      '<th>Downtime รวม</th><th>MTTR</th><th>ล่าสุด</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div>' +
      '<div class="hint">กดชื่อเครื่องเพื่อดูประวัติของเครื่องนั้น</div></div>';
  }

  function wireMachineRows() {
    document.querySelectorAll('.mh-mc-row').forEach(function (tr) {
      tr.querySelector('a').onclick = function (e) {
        e.preventDefault();
        select(tr.getAttribute('data-area'), tr.getAttribute('data-line'), tr.getAttribute('data-mc'));
        load();
        window.scrollTo(0, 0);
      };
    });
  }

  /** BM and PM flattened into one shape and one order.
   *
   * They're different records — a breakdown has downtime and a diagnosis, a
   * PM has a criterion and a pass/fail — but the question in front of the
   * machine (and the one an auditor asks) is the same either way: what has
   * been done to this thing, and in what order. Interleaving them is what
   * makes "we PM'd it monthly and the failures stopped" visible at all. */
  function timelineRows(d) {
    var rows = [];

    (d.jobs || []).forEach(function (j) {
      var problem = [j.mainIssue, j.issue].filter(Boolean).join(' — ');
      var outcome = [];
      if (problem) outcome.push(esc(problem));
      if (j.status === 'ปิดงาน') outcome.push('<span class="mh-sub">Downtime ' + (j.downtime || 0) + ' นาที</span>');
      rows.push({
        kind: 'bm',
        ts: new Date(j.date || j.timestamp || 0).getTime(),
        date: j.date || j.timestamp,
        ref: esc(j.mtJob),
        mc: esc(machineName(j)),
        what: esc(j.symptom || '-'),
        outcome: outcome.join('<br>') || '-',
        who: esc(j.by || '-'),
        status: '<span class="badge ' + (STATUS_CLASS[j.status] || '') + '">' + esc(j.status) + '</span>'
      });
    });

    (d.pms || []).forEach(function (p) {
      var ng = String(p.result).toUpperCase() === 'NG';
      var outcome = [];
      if (ng) {
        if (p.ngDetail) outcome.push('พบ: ' + esc(p.ngDetail));
        if (p.actionTaken) outcome.push('แก้ไข: ' + esc(p.actionTaken));
        if (!outcome.length) outcome.push('NG');
      } else {
        outcome.push('ตรวจแล้วปกติ');
      }
      // The photo is the evidence an auditor actually opens.
      if (p.photoUrl) {
        outcome.push('<a class="mh-link" href="' + esc(p.photoUrl) + '" target="_blank" rel="noopener">📷 รูปหลักฐาน</a>');
      }
      var detail = [p.frequency, p.standard].filter(Boolean).map(esc).join(' • ');
      rows.push({
        kind: 'pm',
        ts: new Date(p.doneAt || 0).getTime(),
        date: p.doneAt,
        ref: esc(p.recordId || p.pmId),
        mc: esc(machineName({ line: p.line, mc: p.mcStation })),
        what: esc(p.pmItem || p.pmId) + (detail ? '<div class="mh-sub">' + detail + '</div>' : ''),
        outcome: outcome.join('<br>'),
        who: esc(p.technician || '-'),
        status: '<span class="badge ' + (ng ? 'st-new' : 'st-done') + '">' + (ng ? 'NG' : 'ผ่าน') + '</span>' +
          (p.status === 'Overdue' ? ' <span class="pill overdue">เลยกำหนด</span>' : '')
      });
    });

    rows.sort(function (a, b) { return b.ts - a.ts; });
    return rows;
  }

  var KIND_LABEL = { bm: 'แจ้งซ่อม', pm: 'PM' };

  function timelineHtml(d, single) {
    var rows = timelineRows(d);
    if (!rows.length) return '<div class="card"><div class="empty">ยังไม่มีประวัติ' + (single ? 'ของเครื่องนี้' : '') + '</div></div>';

    var nBm = rows.filter(function (r) { return r.kind === 'bm'; }).length;
    var nPm = rows.length - nBm;
    var body = rows.map(function (r) {
      return '<tr data-kind="' + r.kind + '">' +
        '<td>' + U.thaiDate(r.date) + '</td>' +
        '<td><span class="badge t-' + r.kind + '">' + KIND_LABEL[r.kind] + '</span></td>' +
        '<td>' + r.ref + '</td>' +
        (single ? '' : '<td>' + r.mc + '</td>') +
        '<td>' + r.what + '</td>' +
        '<td>' + r.outcome + '</td>' +
        '<td>' + r.who + '</td>' +
        '<td>' + r.status + '</td>' +
      '</tr>';
    }).join('');

    var truncated = d.truncated || d.pmTruncated;
    return '<div class="card">' +
      '<div class="ch-title" style="margin-bottom:10px">ประวัติการดูแล' + (single ? 'เครื่อง' : 'ทั้งหมด') + '</div>' +
      '<div class="tabs" id="mhFilter">' +
        '<button data-kind="all" class="active">ทั้งหมด (' + rows.length + ')</button>' +
        '<button data-kind="bm">แจ้งซ่อม (' + nBm + ')</button>' +
        '<button data-kind="pm">PM (' + nPm + ')</button>' +
      '</div>' +
      '<div class="table-wrap">' +
      '<table><thead><tr><th>วันที่</th><th>ประเภท</th><th>เลขที่</th>' +
      (single ? '' : '<th>เครื่อง</th>') + '<th>รายการ / อาการ</th>' +
      '<th>ผลการทำงาน</th><th>ผู้ทำ</th><th>สถานะ</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div>' +
      (truncated ? '<div class="hint">แสดงเฉพาะรายการล่าสุด — ดูทั้งหมดได้ในชีต</div>' : '') +
      '</div>';
  }

  /** Filter chips over the rows already on the page — no refetch, so an
   * auditor asking "PM only" gets it instantly. */
  function wireTimelineFilter() {
    var bar = document.getElementById('mhFilter');
    if (!bar) return;
    bar.querySelectorAll('button').forEach(function (b) {
      b.onclick = function () {
        bar.querySelectorAll('button').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        var want = b.getAttribute('data-kind');
        document.querySelectorAll('tr[data-kind]').forEach(function (tr) {
          tr.style.display = (want === 'all' || tr.getAttribute('data-kind') === want) ? '' : 'none';
        });
      };
    });
  }

  async function load() {
    var area = document.getElementById('mArea').value;
    var line = document.getElementById('mLine').value;
    var mc = document.getElementById('mMc').value;
    var single = !!mc;

    var body = document.getElementById('mBody');
    body.innerHTML = '<div class="empty">กำลังโหลด...</div>';

    // Reflect the selection in the URL so the view can be shared or bookmarked.
    var q = [['area', area], ['line', line], ['mc', mc]].filter(function (p) { return p[1]; })
      .map(function (p) { return p[0] + '=' + encodeURIComponent(p[1]); }).join('&');
    history.replaceState(null, '', 'machine.html' + (q ? '?' + q : ''));

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
    if (s.lastPM) since += ' • PM ล่าสุด ' + U.thaiDate(s.lastPM);

    var title = [area || ALL_AREAS, line || (mc ? '' : ALL_LINES), mc || ALL_MC].filter(Boolean).join(' / ');

    body.innerHTML =
      '<div class="card"><div class="card-head"><span class="ch-icon">⚙️</span><div>' +
        '<div class="ch-title">' + esc(title) + '</div>' +
        '<div class="ch-sub">' + esc(since) + '</div>' +
      '</div></div></div>' +
      kpiHtml(s, single) +
      (single ? '' : machinesHtml(d.byMachine)) +
      issuesHtml(d.topIssues) +
      timelineHtml(d, single);
    wireTimelineFilter();
    wireMachineRows();
  }

  async function init() {
    Auth.renderUserBadge('userBadge');
    try { cfg = await API.getConfig(); }
    catch (e) { U.toast('โหลดค่าตั้งต้นไม่สำเร็จ: ' + e.message, 'error'); return; }

    var areaSel = document.getElementById('mArea');
    var areas = cfg.Area || [];
    fillSelect(areaSel, areas, areas.length > 1 ? '— ' + ALL_AREAS + ' —' : '');
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
    document.getElementById('mMc').addEventListener('change', load);

    refreshPickers();

    // Deep link, or nothing at all = everything — either way the page opens
    // on something rather than an empty box waiting for a pick.
    var qArea = qp('area'), qLine = qp('line'), qMc = qp('mc');
    if (qArea || qLine || qMc) select(qArea, qLine, qMc);
    load();
  }

  /** Set the three pickers top-down, refreshing between levels so each
   * option exists before it's chosen. */
  function select(area, line, mc) {
    var areaSel = document.getElementById('mArea');
    if (area) areaSel.value = area;
    else if (line) areaSel.value = (cfg.AreaOfLine || {})[line] || areaSel.value;
    refreshPickers();
    document.getElementById('mLine').value = line || '';
    refreshPickers();
    document.getElementById('mMc').value = mc || '';
  }

  document.addEventListener('DOMContentLoaded', init);
})();
