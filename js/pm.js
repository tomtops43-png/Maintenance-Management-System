/* pm.html — PM due list, checklist, and NG -> BM handoff */
(function () {
  var pmPhoto = null;
  var pmPhotoBusy = false;   // a picked photo is still being compressed
  var currentPM = null;
  var result = 'OK';
  var cfg = null;
  var dueList = [];   // every due plan, unfiltered, as the API returned it
  var allList = [];   // every plan, unfiltered
  var records = null; // every PM sign-off, newest first — loaded on demand
  var recByPlan = {}; // pmId -> its records, newest first
  var ganttOffset = 0; // months away from the current one the calendar shows

  // Which line a technician looks after doesn't change day to day, so the
  // picker remembers itself. The "ล้างตัวกรอง" button is always visible
  // while a filter is on, so a remembered choice can never look like
  // "the other lines disappeared".
  var FILTER_KEY = 'mms_pm_filter';

  function esc(s) { return U.escapeHtml(s); }

  /** PM plans are stored against a line, not an area — the line implies it. */
  function areaOf(p) {
    return (cfg && cfg.AreaOfLine && cfg.AreaOfLine[p.line]) || (cfg && cfg.DefaultArea) || '';
  }

  function currentFilter() {
    return {
      area: document.getElementById('fArea').value,
      line: document.getElementById('fLine').value,
      mc:   document.getElementById('fMc').value,
      shift: document.getElementById('fShift').value
    };
  }

  function filterActive(f) { return !!(f.area || f.line || f.mc || f.shift); }

  function applyFilter(list) {
    var f = currentFilter();
    return list.filter(function (p) {
      if (f.area && areaOf(p) !== f.area) return false;
      if (f.line && p.line !== f.line) return false;
      if (f.mc && p.mcStation !== f.mc) return false;
      if (f.shift && p.shiftOwner !== f.shift) return false;
      return true;
    });
  }

  // ---- shift rotation -----------------------------------------------------
  // Each plan belongs to กะ A or B; whoever finishes it hands the next round
  // to the other shift (see nextPMShiftOwner in gas/Code.gs).

  function normShift(s) {
    var m = /(?:^|[^A-Z])([AB])(?:$|[^A-Z])/.exec(' ' + String(s || '').toUpperCase() + ' ');
    return m ? m[1] : '';
  }
  function otherShift(s) { return s === 'A' ? 'B' : (s === 'B' ? 'A' : ''); }

  /** The signed-in user's shift from USERS, else what the clock says. */
  function myShift() {
    var u = (window.Auth && Auth.get()) || {};
    var s = normShift(u.shift);
    if (s) return s;
    var set = (cfg && cfg.Setting) || {};
    var a = parseInt(set.ShiftA_StartHour, 10); if (isNaN(a)) a = 8;
    var b = parseInt(set.ShiftB_StartHour, 10); if (isNaN(b)) b = 20;
    var h = new Date().getHours();
    return (h >= a && h < b) ? 'A' : 'B';
  }

  function shiftPill(s) {
    if (!s) return '';
    return '<span class="pill pm-shift pm-shift-' + s.toLowerCase() + (s === myShift() ? ' is-mine' : '') + '">กะ ' + s + '</span>';
  }

  function pmCardHtml(p, showDue) {
    var overdue = p.overdue
      ? '<span class="pill overdue">เกิน ' + p.overdueDays + ' วัน</span>'
      : '<span class="pill">ถึงกำหนด</span>';
    return '<div class="card' + (showDue && p.overdue ? ' pm-card-overdue' : '') + '">' +
      '<div style="display:flex;justify-content:space-between;gap:8px">' +
        '<b>' + esc(p.pmItem || p.pmId) + (p.photoUrl ? ' <span title="มีรูปอ้างอิง">📷</span>' : '') + '</b>' +
        '<span class="pm-pills">' + shiftPill(p.shiftOwner) +
          (showDue ? overdue : (p.active ? '<span class="pill ok">Active</span>' : '<span class="pill">ปิด</span>')) +
        '</span>' +
      '</div>' +
      '<div class="meta">' + esc(p.line) + ' • ' + esc(p.mcStation) + ' • ' + esc(p.frequency) + '</div>' +
      (p.standard ? '<div class="hint">เกณฑ์: ' + esc(p.standard) + '</div>' : '') +
      '<div class="hint">ครบกำหนด: ' + U.thaiDate(p.nextDue) + (p.lastDone ? ' • ทำล่าสุด: ' + U.thaiDate(p.lastDone) : '') + '</div>' +
      '<div class="btn-group" style="margin-top:8px"><button class="btn small" data-pm="' + esc(p.pmId) + '">ทำ PM</button>' +
        '<button class="btn small secondary" data-hist="' + esc(p.pmId) + '">ประวัติที่บันทึก</button></div>' +
      '</div>';
  }

  /** Everything due, split by ไลน์ and then by เครื่อง.
   *
   * One flat list was the complaint: every area's plans ran together, so
   * "which line do I need to walk to" couldn't be read off the screen. The
   * most overdue line sorts to the top, and so does the most overdue machine
   * inside it — the order is the priority. */
  function groupDue(list) {
    var byLine = {};
    list.forEach(function (p) {
      var key = p.line || 'ไม่ระบุไลน์';
      (byLine[key] = byLine[key] || []).push(p);
    });

    return Object.keys(byLine).map(function (line) {
      var items = byLine[line];
      var byMc = {};
      items.forEach(function (p) {
        var key = p.mcStation || 'ไม่ระบุเครื่อง';
        (byMc[key] = byMc[key] || []).push(p);
      });
      var machines = Object.keys(byMc).map(function (mc) {
        return { mc: mc, items: byMc[mc], count: byMc[mc].length, worst: worstOverdue(byMc[mc]) };
      }).sort(byUrgency('mc'));

      return {
        line: line,
        area: areaOf(items[0]),
        count: items.length,
        overdue: items.filter(function (p) { return p.overdue; }).length,
        worst: worstOverdue(items),
        machines: machines
      };
    }).sort(byUrgency('line'));
  }

  function worstOverdue(items) {
    return items.reduce(function (m, p) { return Math.max(m, p.overdueDays || 0); }, 0);
  }

  /** Most overdue first, then the biggest pile, then alphabetical so the
   * order is stable between refreshes. */
  function byUrgency(nameKey) {
    return function (a, b) {
      if (b.worst !== a.worst) return b.worst - a.worst;
      if (b.count !== a.count) return b.count - a.count;
      return String(a[nameKey]).localeCompare(String(b[nameKey]), 'th');
    };
  }

  /** The "so what" line above the list: how much is due, how much is late,
   * and which lines it's sitting on — each one a shortcut to that line. */
  function dueSummaryHtml(groups, shownCount, totalCount) {
    var overdue = groups.reduce(function (n, g) { return n + g.overdue; }, 0);
    var chips = groups.map(function (g) {
      return '<button class="pm-chip' + (g.overdue ? ' is-overdue' : '') + '" data-line="' + esc(g.line) + '">' +
        esc(g.line) + ' <b>' + g.count + '</b>' +
        (g.overdue ? '<span class="pm-chip-late">เลย ' + g.overdue + '</span>' : '') +
      '</button>';
    }).join('');

    var head = 'ถึงกำหนดวันนี้ <b>' + shownCount + '</b> รายการ' +
      (overdue ? ' — <span class="pm-late-text">เลยกำหนดแล้ว ' + overdue + '</span>' : '') +
      (shownCount !== totalCount ? ' <span class="hint">(กรองจากทั้งหมด ' + totalCount + ')</span>' : '');

    // How the due list splits between the shifts — over everything due, like
    // the line chips, so a shift filter still shows what the other one holds.
    var byShift = { A: 0, B: 0 };
    dueList.forEach(function (p) { if (byShift[p.shiftOwner] !== undefined) byShift[p.shiftOwner]++; });
    var mine = myShift();
    var shiftLine = (byShift.A || byShift.B)
      ? '<div class="pm-summary-sub">' +
          ['A', 'B'].map(function (s) {
            return 'กะ ' + s + (s === mine ? ' (กะของฉัน)' : '') + ': <b>' + byShift[s] + '</b>';
          }).join(' • ') +
        '</div>'
      : '';

    return '<div class="card pm-summary">' +
      '<div class="pm-summary-head">' + head + '</div>' + shiftLine +
      '<div class="pm-summary-sub">ไลน์ที่ต้องทำ PM — กดเพื่อดูเฉพาะไลน์นั้น</div>' +
      '<div class="pm-chips">' + chips + '</div>' +
    '</div>';
  }

  function renderDue() {
    var v = document.getElementById('dueView');
    var shown = applyFilter(dueList);
    setDueBadge(dueList.length);

    if (!dueList.length) {
      v.innerHTML = '<div class="empty">🎉 ไม่มีรายการ PM ที่ถึงกำหนด</div>';
      return;
    }
    if (!shown.length) {
      v.innerHTML = '<div class="empty">ไม่มีรายการ PM ที่ถึงกำหนดตามตัวกรองนี้ ' +
        '(ทั้งหมด ' + dueList.length + ' รายการ) — กด “ล้างตัวกรอง” เพื่อดูทุกไลน์</div>';
      return;
    }

    var groups = groupDue(shown);
    // The chips describe everything that's due, not just what's on screen,
    // so a filtered view still shows the other lines waiting.
    var allGroups = groupDue(dueList);

    v.innerHTML = dueSummaryHtml(allGroups, shown.length, dueList.length) +
      groups.map(function (g) {
        var head = '<h3 class="pm-group-head">' +
          '<span class="status-dot ' + (g.overdue ? 'dot-new' : 'dot-repair') + '"></span>' +
          esc(g.line) +
          (g.area && g.area !== g.line ? '<span class="pm-group-area">' + esc(g.area) + '</span>' : '') +
          '<span class="pm-group-count">' + g.count + ' รายการ</span>' +
          (g.overdue ? '<span class="pill overdue">เลยกำหนด ' + g.overdue + '</span>' : '') +
        '</h3>';
        var body = g.machines.map(function (m) {
          return '<div class="pm-machine">' +
            '<div class="pm-machine-head">' + esc(m.mc) + ' <span>' + m.items.length + ' รายการ</span></div>' +
            m.items.map(function (p) { return pmCardHtml(p, true); }).join('') +
          '</div>';
        }).join('');
        return '<div class="pm-group">' + head + body + '</div>';
      }).join('');

    wire(v, dueList);
    wireChips(v);
    v.querySelectorAll('[data-hist]').forEach(function (b) {
      b.onclick = function () { openHistory(b.getAttribute('data-hist')); };
    });
  }

  /** Red count on the tab itself. The sidebar badge answers "is there PM
   * waiting" from anywhere in the app; this one answers it while you're
   * standing on the other tab. */
  function setDueBadge(n) {
    var el = document.getElementById('dueCount');
    if (!el) return;
    el.textContent = n > 99 ? '99+' : String(n);
    el.classList.toggle('show', n > 0);
  }

  function wireChips(container) {
    container.querySelectorAll('.pm-chip').forEach(function (b) {
      b.onclick = function () {
        var line = b.getAttribute('data-line');
        var lineSel = document.getElementById('fLine');
        var areaSel = document.getElementById('fArea');
        // Clicking the line you're already filtered to clears it again, so a
        // chip is a toggle rather than a one-way trip into a filtered view.
        var next = (lineSel.value === line) ? '' : line;
        var area = (cfg && cfg.AreaOfLine && cfg.AreaOfLine[line]) || '';
        areaSel.value = next ? area : '';
        // The chip means "show me this whole line", so any machine narrower
        // than that goes.
        document.getElementById('fMc').value = '';
        refreshPickers();
        lineSel.value = next;
        refreshPickers();
        onFilterChange();
      };
    });
  }

  async function loadDue() {
    var v = document.getElementById('dueView');
    v.innerHTML = U.skeletonCards(3);
    U.progress(true);
    try {
      dueList = await API.call('getPMDue', {});
      window._pmDue = dueList;
      renderDue();
    } catch (e) { v.innerHTML = '<div class="empty">โหลดไม่สำเร็จ: ' + esc(e.message) + '</div>'; }
    finally { U.progress(false); }
  }

  // ---- sign-off history ---------------------------------------------------
  /* "I did it, why is it still asking" was unanswerable from this page: the
   * calendar only drew where a plan was going next, never what had been
   * done, and a plan overdue since last month drew nothing at all — the same
   * blank as a plan that was finished. Everything below reads PM_RECORDS
   * (getPMRecords) next to PM_MASTER so the two can be compared on screen. */

  async function loadRecords() {
    var list = await API.call('getPMRecords', {});
    records = list || [];
    recByPlan = {};
    records.forEach(function (r) { (recByPlan[r.pmId] = recByPlan[r.pmId] || []).push(r); });
  }

  function startOfToday() { var t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
  function dayDiff(a, b) { return Math.round((a.getTime() - b.getTime()) / 86400000); }

  /** Where a plan stands in its current round — the same rule the due list
   * uses (Next_Due on or before today = still to do), so this page and the
   * ถึงกำหนด tab can never disagree. */
  function planState(p) {
    if (!p.active) return { key: 'off', label: 'ปิดใช้งาน' };
    var due = U.toDate(p.nextDue);
    if (!due) return { key: 'nodate', label: 'ไม่มีวันครบกำหนด' };
    var t0 = startOfToday();
    var dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    var late = dayDiff(t0, dueDay);
    if (late > 0) return { key: 'overdue', label: 'ค้าง • เลย ' + late + ' วัน', late: late };
    if (late === 0) return { key: 'due', label: 'ค้าง • ครบวันนี้' };
    if (p.lastDone) return { key: 'done', label: 'ทำแล้ว' };
    return { key: 'wait', label: 'ยังไม่ถึงรอบ' };
  }

  function stateBadge(st) {
    var cls = { overdue: 'st-overdue', due: 'st-due', done: 'st-done', wait: 'st-wait', off: 'st-off', nodate: 'st-off' }[st.key];
    var icon = { overdue: '⏰', due: '⏳', done: '✅', wait: '🗓', off: '⏸', nodate: '?' }[st.key];
    return '<span class="pm-st ' + cls + '">' + icon + ' ' + esc(st.label) + '</span>';
  }

  /** A backfilled paper sheet is stamped at midnight and carries no photo —
   * say so, rather than print "00:00" as if someone worked at midnight. */
  function doneWhen(r) {
    var d = U.toDate(r.doneAt);
    if (!d) return '-';
    return (d.getHours() || d.getMinutes()) ? U.thaiDateTime(d) : U.thaiDate(d);
  }

  function resultPill(r) {
    return String(r.result).toUpperCase() === 'NG'
      ? '<span class="pill ng">NG</span>' : '<span class="pill ok">OK</span>';
  }

  function photoThumb(url, big) {
    if (!url) return '<span class="pm-nophoto' + (big ? ' big' : '') + '" title="ไม่มีรูป — บันทึกผ่านหน้าลงหลายรายการ">ไม่มีรูป</span>';
    return '<a class="pm-thumb' + (big ? ' big' : '') + '" href="' + esc(url) + '" target="_blank" rel="noopener">' +
      '<img src="' + esc(url) + '" alt="รูปหลังทำ PM" loading="lazy"></a>';
  }

  /** The things that make "I did it" and the screen disagree, spelled out.
   * Each one is a real way it has happened, not a guess. */
  function planWarnings(p, st, last) {
    var w = [];
    if (st.key === 'done' && !last) {
      w.push('แผนบอกว่าทำแล้ว (' + U.thaiDate(p.lastDone) + ') แต่ไม่พบบันทึกผลในระบบ');
    }
    if ((st.key === 'overdue' || st.key === 'due') && last) {
      // Next_Due is counted from the day it was done — a back-dated entry
      // can land the next round in the past straight away.
      w.push('บันทึกล่าสุด ' + U.thaiDate(last.doneAt) + ' แล้ว แต่รอบถัดไป (' + p.frequency + ') ' +
        'ครบกำหนด ' + U.thaiDate(p.nextDue) + ' จึงต้องทำรอบใหม่');
    }
    if ((st.key === 'overdue' || st.key === 'due') && !last) {
      w.push('ยังไม่เคยมีบันทึก PM ของแผนนี้เลย');
    }
    return w;
  }

  /** Recent sign-offs of the *same* topic on the line's other machines. Four
   * plans share one name ("ตรวจสอบการ์ดรอบเครื่อง") and differ only by
   * machine, so "I did it" is very often "I did it — on the next one over". */
  function sameTopicElsewhere(p) {
    var since = startOfToday().getTime() - 45 * 86400000;
    return allList.filter(function (q) {
      return q.pmId !== p.pmId && q.pmItem === p.pmItem && q.line === p.line;
    }).map(function (q) {
      var last = (recByPlan[q.pmId] || [])[0];
      return { plan: q, last: last };
    }).filter(function (x) {
      var d = x.last && U.toDate(x.last.doneAt);
      return d && d.getTime() >= since;
    });
  }

  // ---- เช็กรายเครื่อง: this month's round, per shift --------------------------
  /* A shift lead's question is "what is my shift's PM this round, and which
   * machines are still left" — the due list can't answer it, because a plan
   * drops off the moment it's signed off and its owner flips to the other
   * shift. So the round is the calendar month, and each plan in it is filed
   * under one shift:
   *   - still to do  -> the shift that owns it now (Shift_Owner)
   *   - done          -> the shift that actually did it (the record's Shift)
   * A plan is in this month's round if it's open now, due later this month,
   * or was signed off this month. */

  var checkOnlyOpen = false;

  function sameMonth(d, ref) { return d && d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth(); }

  /** Area/line/machine from the shared filter row, but not its shift: here
   * the shift is decided per plan by roundOf(), not by Shift_Owner. */
  function applyPlaceFilter(list) {
    var f = currentFilter();
    return list.filter(function (p) {
      if (f.area && areaOf(p) !== f.area) return false;
      if (f.line && p.line !== f.line) return false;
      if (f.mc && p.mcStation !== f.mc) return false;
      return true;
    });
  }

  /** Where this plan sits in this month's round, or null if it isn't in it. */
  function roundOf(p) {
    var now = new Date();
    var recs = recByPlan[p.pmId] || [];
    var thisMonth = recs.filter(function (r) { return sameMonth(U.toDate(r.doneAt), now); });
    var st = planState(p);
    if (st.key === 'overdue' || st.key === 'due') {
      return { st: st, shift: p.shiftOwner || '', doneCount: thisMonth.length };
    }
    if (thisMonth.length) {
      var r = thisMonth[0];
      return { st: { key: 'done', label: 'ทำแล้ว ' + U.thaiDate(r.doneAt) }, record: r,
               shift: normShift(r.shift) || otherShift(p.shiftOwner) };
    }
    var due = U.toDate(p.nextDue);
    if (p.active && sameMonth(due, now)) {
      return { st: { key: 'wait', label: 'ยังไม่ถึงวัน • ครบ ' + U.thaiDate(due) }, shift: p.shiftOwner || '' };
    }
    return null;
  }

  function isOpenKey(k) { return k === 'overdue' || k === 'due'; }

  function renderCheck() {
    var v = document.getElementById('checkView');
    if (!allList.length) {
      v.innerHTML = '<div class="empty">ยังไม่มีแผน PM (เพิ่มได้ที่หน้าตั้งค่า)</div>';
      return;
    }
    var now = new Date();
    var shiftSel = currentFilter().shift;

    // Everything in this month's round for the chosen place, both shifts —
    // the shift tiles compare the two, so they're counted before narrowing.
    var round = [];
    applyPlaceFilter(allList).filter(function (p) { return p.active; }).forEach(function (p) {
      var r = roundOf(p);
      if (r) { r.p = p; r.last = (recByPlan[p.pmId] || [])[0] || null; round.push(r); }
    });

    function tally(list) {
      var t = { total: list.length, done: 0, open: 0, wait: 0 };
      list.forEach(function (r) {
        if (r.st.key === 'done') t.done++;
        else if (isOpenKey(r.st.key)) t.open++;
        else t.wait++;
      });
      return t;
    }

    var mine = myShift();
    var tiles = ['A', 'B'].map(function (s) {
      var t = tally(round.filter(function (r) { return r.shift === s; }));
      var pct = t.total ? Math.round(t.done / t.total * 100) : 0;
      return '<button class="pm-shift-tile' + (shiftSel === s ? ' is-active' : '') + '" data-shift="' + s + '">' +
        '<div class="pm-shift-tile-head"><b>กะ ' + s + '</b>' + (s === mine ? ' <span class="hint">(กะของฉัน)</span>' : '') +
          '<span class="pm-shift-tile-pct">' + pct + '%</span></div>' +
        '<div class="pm-progress"><span style="width:' + pct + '%"></span></div>' +
        '<div class="pm-shift-tile-nums">' +
          '<span class="ok">✅ ทำแล้ว <b>' + t.done + '</b></span>' +
          '<span class="bad">⏰ ค้าง <b>' + t.open + '</b></span>' +
          '<span>🗓 รอวัน <b>' + t.wait + '</b></span>' +
          '<span>รวม <b>' + t.total + '</b></span>' +
        '</div>' +
      '</button>';
    }).join('');

    var shown = shiftSel ? round.filter(function (r) { return r.shift === shiftSel; }) : round;

    var ORDER = { overdue: 0, due: 1, wait: 2, done: 3 };
    var byMc = {};
    shown.forEach(function (r) {
      var key = (r.p.line || 'ไม่ระบุไลน์') + '\u0000' + (r.p.mcStation || 'ไม่ระบุเครื่อง');
      (byMc[key] = byMc[key] || { key: key, line: r.p.line, mc: r.p.mcStation, rows: [] }).rows.push(r);
    });
    var machines = Object.keys(byMc).map(function (k) {
      var m = byMc[k];
      m.rows.sort(function (a, b) {
        return (ORDER[a.st.key] - ORDER[b.st.key]) || ((b.st.late || 0) - (a.st.late || 0)) ||
          String(a.p.pmItem).localeCompare(String(b.p.pmItem), 'th');
      });
      var t = tally(m.rows);
      m.done = t.done; m.open = t.open; m.wait = t.wait; m.total = t.total;
      m.state = m.open ? 'open' : (m.wait ? 'wait' : 'done');
      return m;
    }).sort(function (a, b) {
      var rank = { open: 0, wait: 1, done: 2 };
      return (rank[a.state] - rank[b.state]) || (b.open - a.open) ||
        String(a.line + a.mc).localeCompare(String(b.line + b.mc), 'th');
    });

    var head = '<div class="card pm-summary">' +
      '<div class="pm-summary-head">PM รอบเดือน ' + U.monthsTh[now.getMonth()] + ' ' + now.getFullYear() +
        (shiftSel ? ' — กะ ' + shiftSel : ' — ทุกกะ') + '</div>' +
      '<div class="pm-summary-sub">งานที่ยังไม่ทำนับให้กะเจ้าของรอบ • งานที่ทำแล้วนับให้กะที่ลงมือทำจริง • ' +
        'กดที่กะเพื่อดูเฉพาะกะนั้น (กดซ้ำเพื่อดูทุกกะ)</div>' +
      '<div class="pm-shift-tiles">' + tiles + '</div>' +
    '</div>';

    if (!machines.length) {
      v.innerHTML = head + '<div class="empty">ไม่มีงาน PM ในรอบเดือนนี้ตามตัวกรองนี้</div>';
      wireCheck(v);
      return;
    }

    // At-a-glance board: one tile per machine, coloured by where it stands.
    var board = '<div class="card">' +
      '<div class="pm-board-legend">' +
        '<span><i class="pm-mt-sw open"></i> ยังมีหัวข้อค้าง</span>' +
        '<span><i class="pm-mt-sw wait"></i> ยังไม่ถึงวัน</span>' +
        '<span><i class="pm-mt-sw done"></i> ทำครบแล้ว</span>' +
        '<span class="hint">กดที่เครื่องเพื่อดูรายละเอียด</span>' +
      '</div>' +
      '<div class="pm-board">' + machines.map(function (m, i) {
        return '<button class="pm-mt ' + m.state + '" data-jump="mc' + i + '">' +
          '<b>' + esc(m.mc || '-') + '</b>' +
          '<span class="pm-mt-line">' + esc(m.line || '') + '</span>' +
          '<span class="pm-mt-count">' + m.done + '/' + m.total +
            (m.open ? ' • ค้าง ' + m.open : '') + '</span>' +
        '</button>';
      }).join('') + '</div>' +
      '<label class="pm-only-open"><input type="checkbox" id="chkOnlyOpen"' + (checkOnlyOpen ? ' checked' : '') + '> ' +
        'รายละเอียดด้านล่าง: แสดงเฉพาะเครื่องที่ยังไม่ครบ</label>' +
    '</div>';

    var body = machines.map(function (m, i) {
      if (checkOnlyOpen && m.state === 'done') return '';
      var pct = m.total ? Math.round(m.done / m.total * 100) : 0;
      return '<div class="card pm-mc ' + (m.state === 'open' ? 'has-open' : (m.state === 'done' ? 'all-done' : 'is-wait')) + '" id="mc' + i + '">' +
        '<div class="pm-mc-head">' +
          '<div><b>' + esc(m.mc || '-') + '</b> <span class="hint">' + esc(m.line || '') + '</span></div>' +
          '<div class="pm-mc-count">ทำแล้ว <b>' + m.done + '/' + m.total + '</b>' +
            (m.open ? ' • ค้าง <b class="pm-late-text">' + m.open + '</b>' : '') +
            (m.wait ? ' • รอวัน ' + m.wait : '') + '</div>' +
        '</div>' +
        '<div class="pm-progress"><span style="width:' + pct + '%"></span></div>' +
        m.rows.map(checkRowHtml).join('') +
      '</div>';
    }).join('');

    v.innerHTML = head + board + (body || '<div class="empty">🎉 ทุกเครื่องทำ PM ครบแล้ว</div>');
    wireCheck(v);
  }

  function wireCheck(v) {
    v.querySelectorAll('[data-shift]').forEach(function (b) {
      b.onclick = function () {
        var sel = document.getElementById('fShift');
        var s = b.getAttribute('data-shift');
        sel.value = (sel.value === s) ? '' : s;
        onFilterChange();
      };
    });
    v.querySelectorAll('[data-jump]').forEach(function (b) {
      b.onclick = function () {
        var el = document.getElementById(b.getAttribute('data-jump'));
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });
    var only = document.getElementById('chkOnlyOpen');
    if (only) only.onchange = function () { checkOnlyOpen = this.checked; renderCheck(); };
    v.querySelectorAll('[data-hist]').forEach(function (b) {
      b.onclick = function () { openHistory(b.getAttribute('data-hist')); };
    });
    v.querySelectorAll('[data-do]').forEach(function (b) {
      b.onclick = function () {
        var p = findPlan(b.getAttribute('data-do'));
        if (p) openModal(p);
      };
    });
  }

  function checkRowHtml(r) {
    var p = r.p, st = r.st, last = r.last;
    var open = st.key === 'overdue' || st.key === 'due';
    var lastHtml = last
      ? '<div class="pm-last">' + resultPill(last) + ' <b>' + doneWhen(last) + '</b> • ' + esc(last.technician || '-') +
          (last.shift ? ' • กะ ' + esc(last.shift) : '') +
          (last.actionTaken ? '<div class="mh-sub">' + esc(last.actionTaken) + '</div>' : '') +
          (last.ngDetail ? '<div class="mh-sub pm-late-text">NG: ' + esc(last.ngDetail) + '</div>' : '') +
        '</div>'
      : '<div class="pm-last hint">ยังไม่มีบันทึก</div>';
    var warns = planWarnings(p, st, last).map(function (w) { return '<div class="pm-warn">⚠ ' + esc(w) + '</div>'; }).join('');
    return '<div class="pm-row is-' + st.key + '">' +
      '<div class="pm-row-photo">' + (last ? photoThumb(last.photoUrl) : '<span class="pm-nophoto">—</span>') + '</div>' +
      '<div class="pm-row-main">' +
        '<div class="pm-row-top">' + stateBadge(st) + ' <b>' + esc(p.pmItem || p.pmId) + '</b></div>' +
        '<div class="mh-sub">' + esc(p.frequency) + ' • ครบกำหนด ' + U.thaiDate(p.nextDue) +
          (p.shiftOwner ? (st.key === 'done' ? ' • รอบหน้าเป็นของกะ ' : ' • กะเจ้าของรอบ: กะ ') + esc(p.shiftOwner) : '') +
          ' • ' + esc(p.pmId) + '</div>' +
        lastHtml + warns +
      '</div>' +
      '<div class="pm-row-btns">' +
        '<button class="btn small secondary" data-hist="' + esc(p.pmId) + '">ประวัติ (' + (recByPlan[p.pmId] || []).length + ')</button>' +
        (open ? '<button class="btn small" data-do="' + esc(p.pmId) + '">ทำ PM</button>' : '') +
      '</div>' +
    '</div>';
  }

  function findPlan(id) {
    return allList.filter(function (x) { return x.pmId === id; })[0] ||
      dueList.filter(function (x) { return x.pmId === id; })[0] || null;
  }

  // ---- per-plan history modal -------------------------------------------

  var histPM = null;

  async function openHistory(pmId) {
    var p = findPlan(pmId);
    if (!p) return;
    histPM = p;
    var m = document.getElementById('pmHistModal');
    document.getElementById('pmHistBody').innerHTML = U.skeletonCards(2);
    m.classList.add('show');
    try {
      if (!records) await loadRecords();
      renderHistory(p);
    } catch (e) {
      document.getElementById('pmHistBody').innerHTML = '<div class="empty">โหลดประวัติไม่สำเร็จ: ' + esc(e.message) + '</div>';
    }
  }

  function renderHistory(p) {
    var st = planState(p);
    var list = recByPlan[p.pmId] || [];
    var last = list[0] || null;
    var open = st.key === 'overdue' || st.key === 'due';

    var head = '<div class="pm-hist-head">' +
      '<div class="pm-row-top">' + stateBadge(st) + ' <span class="pill">' + esc(p.pmId) + '</span></div>' +
      '<h2>' + esc(p.pmItem || p.pmId) + '</h2>' +
      '<div class="hint">' + esc([p.line, p.mcStation, p.frequency].filter(Boolean).join(' • ')) + '</div>' +
      '<div class="pm-hist-facts">' +
        '<div><span>ทำล่าสุด (ตามแผน)</span><b>' + U.thaiDate(p.lastDone) + '</b></div>' +
        '<div><span>ครบกำหนดรอบถัดไป</span><b' + (open ? ' class="pm-late-text"' : '') + '>' + U.thaiDate(p.nextDue) + '</b></div>' +
        '<div><span>บันทึกทั้งหมด</span><b>' + list.length + ' ครั้ง</b></div>' +
        '<div><span>รอบนี้เป็นของ</span><b>' + (p.shiftOwner ? 'กะ ' + esc(p.shiftOwner) : '-') + '</b></div>' +
      '</div>' +
      planWarnings(p, st, last).map(function (w) { return '<div class="pm-warn">⚠ ' + esc(w) + '</div>'; }).join('') +
    '</div>';

    var elsewhere = sameTopicElsewhere(p);
    var elsewhereHtml = (open && elsewhere.length)
      ? '<div class="pm-elsewhere"><b>หัวข้อเดียวกันที่เครื่องอื่นในไลน์นี้ (45 วันล่าสุด)</b>' +
          '<div class="hint">ถ้าช่างบอกว่าทำแล้วแต่เครื่องนี้ยังค้าง ให้ดูว่าเผลอบันทึกไปที่เครื่องข้างๆ หรือเปล่า</div>' +
          elsewhere.map(function (x) {
            return '<div class="pm-elsewhere-row">' + photoThumb(x.last.photoUrl) +
              '<div><b>' + esc(x.plan.mcStation) + '</b> — ' + doneWhen(x.last) + ' • ' + esc(x.last.technician || '-') +
              (x.last.shift ? ' • กะ ' + esc(x.last.shift) : '') + '</div></div>';
          }).join('') +
        '</div>'
      : '';

    var timeline = list.length
      ? '<div class="pm-hist-list">' + list.map(function (r) {
          return '<div class="pm-hist-item">' +
            photoThumb(r.photoUrl, true) +
            '<div class="pm-hist-text">' +
              '<div>' + resultPill(r) + ' <b>' + doneWhen(r) + '</b>' +
                (r.status === 'Overdue' ? ' <span class="pill overdue">ทำช้ากว่ากำหนด</span>' : (r.status === 'OnTime' ? ' <span class="pill ok">ตรงเวลา</span>' : '')) +
              '</div>' +
              '<div class="mh-sub">โดย <b>' + esc(r.technician || '-') + '</b>' + (r.shift ? ' • กะ ' + esc(r.shift) : '') +
                ' • ' + esc(r.recordId) + (r.photoUrl ? '' : ' • ไม่มีรูป (ลงหลายรายการ)') + '</div>' +
              (r.actionTaken ? '<div class="pm-hist-act">การดำเนินการ: ' + esc(r.actionTaken) + '</div>' : '') +
              (r.ngDetail ? '<div class="pm-hist-act pm-late-text">ปัญหาที่พบ: ' + esc(r.ngDetail) + '</div>' : '') +
            '</div>' +
          '</div>';
        }).join('') + '</div>'
      : '<div class="empty">ยังไม่เคยมีบันทึก PM ของแผนนี้</div>';

    document.getElementById('pmHistBody').innerHTML = head + elsewhereHtml +
      '<h3 class="pm-hist-title">ประวัติการทำ PM (ล่าสุดก่อน)</h3>' + timeline;
    document.getElementById('pmHistDoBtn').style.display = p.active ? '' : 'none';
    document.getElementById('pmHistDoBtn').textContent = open ? 'ทำ PM รอบนี้' : 'ทำ PM (ก่อนกำหนด)';
  }

  function closeHistory() { document.getElementById('pmHistModal').classList.remove('show'); }

  // ---- calendar ----------------------------------------------------------

  /** Schedule overview: one row per plan, one column per day of the month.
   * It draws both halves now — the day each sign-off actually happened (✓)
   * and where the plan is due — plus a status pill on every row, so a blank
   * row can no longer mean either "finished" or "overdue since last month".
   * Click a row for its full history. */
  function pmGanttHtml(list) {
    var today = new Date();
    var view = new Date(today.getFullYear(), today.getMonth() + ganttOffset, 1);
    var y = view.getFullYear(), mo = view.getMonth();
    var isThisMonth = ganttOffset === 0;
    var todayDate = isThisMonth ? today.getDate() : -1;
    var daysInMonth = new Date(y, mo + 1, 0).getDate();
    var monthStart = new Date(y, mo, 1);
    var t0 = startOfToday();

    var dayHeaders = '';
    for (var d = 1; d <= daysInMonth; d++) {
      dayHeaders += '<th class="gantt-day' + (d === todayDate ? ' gantt-today' : '') + '">' + d + '</th>';
    }

    var rows = list.map(function (p) {
      var st = planState(p);
      var due = U.toDate(p.nextDue);
      var dueDay = (due && due.getFullYear() === y && due.getMonth() === mo) ? due.getDate() : null;
      var overdue = !!(due && due < t0);
      // Overdue since before this month: nothing would land in it, so the
      // row would be blank — mark the first day instead.
      var carried = isThisMonth && due && due < monthStart;

      var doneOn = {};
      (recByPlan[p.pmId] || []).forEach(function (r) {
        var rd = U.toDate(r.doneAt);
        if (!rd || rd.getFullYear() !== y || rd.getMonth() !== mo) return;
        var k = rd.getDate();
        (doneOn[k] = doneOn[k] || []).push(r);
      });

      var meta = [p.line, p.mcStation, p.frequency, p.shiftOwner ? 'กะ ' + p.shiftOwner : '', p.assignedTo].filter(Boolean).join(' · ');
      var cells = '';
      for (var d2 = 1; d2 <= daysInMonth; d2++) {
        var marks = '';
        if (doneOn[d2]) {
          var ng = doneOn[d2].some(function (r) { return String(r.result).toUpperCase() === 'NG'; });
          var tip = doneOn[d2].map(function (r) { return doneWhen(r) + ' ' + (r.technician || '') + ' ' + r.result; }).join('\n');
          marks += '<span class="gantt-done' + (ng ? ' ng' : '') + '" title="' + esc(tip) + '">' + (ng ? '!' : '✓') + '</span>';
        }
        if (d2 === dueDay && !(doneOn[d2] && st.key !== 'overdue' && st.key !== 'due')) {
          marks += '<span class="gantt-dot' + (overdue ? ' overdue' : '') + '" title="ครบกำหนด ' + U.thaiDate(due) + '"></span>';
        } else if (carried && d2 === 1) {
          marks += '<span class="gantt-dot overdue carried" title="ค้างมาตั้งแต่ ' + U.thaiDate(due) + '">◀</span>';
        }
        cells += '<td class="gantt-day' + (d2 === todayDate ? ' gantt-today' : '') + '">' + marks + '</td>';
      }
      return '<tr data-pm="' + esc(p.pmId) + '" class="is-' + st.key + '">' +
        '<td class="gantt-label"><b>' + esc(p.pmItem || p.pmId) + '</b>' +
        '<div class="meta">' + esc(meta) + '</div>' +
        '<div class="gantt-state">' + stateBadge(st) + '</div></td>' + cells + '</tr>';
    }).join('');

    return '<div class="card" style="padding:0;overflow:hidden">' +
      '<div class="pm-gantt-nav">' +
        '<button class="btn small secondary" id="ganttPrev">◀ เดือนก่อน</button>' +
        '<b>' + U.monthsTh[mo] + ' ' + y + '</b>' +
        '<span class="pm-gantt-nav-r">' +
          (ganttOffset ? '<button class="btn small secondary" id="ganttNow">เดือนนี้</button>' : '') +
          '<button class="btn small secondary" id="ganttNext">เดือนถัดไป ▶</button>' +
        '</span>' +
      '</div>' +
      '<div class="pm-gantt-wrap"><table class="pm-gantt">' +
        '<thead>' +
          '<tr><th class="gantt-label"></th><th class="gantt-month" colspan="' + daysInMonth + '">' + U.monthsTh[mo] + ' ' + y + '</th></tr>' +
          '<tr><th class="gantt-label">แผน PM</th>' + dayHeaders + '</tr>' +
        '</thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="pm-gantt-legend">' +
        '<span><span class="gantt-done">✓</span> วันที่ทำจริง (OK)</span>' +
        '<span><span class="gantt-done ng">!</span> ทำแล้วผล NG</span>' +
        '<span><span class="gantt-dot"></span> ครบกำหนด</span>' +
        '<span><span class="gantt-dot overdue"></span> เลยกำหนดแล้ว</span>' +
        '<span><span class="gantt-dot overdue carried">◀</span> ค้างมาจากเดือนก่อน</span>' +
        '<span>กดที่แถวเพื่อดูประวัติ / รูปหลักฐาน</span>' +
      '</div></div>';
  }

  function renderAll() {
    var v = document.getElementById('allView');
    if (!allList.length) {
      v.innerHTML = '<div class="empty">ยังไม่มีแผน PM (เพิ่มได้ที่หน้าตั้งค่า)</div>';
      return;
    }
    var shown = applyFilter(allList);
    if (!shown.length) {
      v.innerHTML = '<div class="empty">ไม่มีแผน PM ตามตัวกรองนี้ (ทั้งหมด ' + allList.length + ' แผน) — ' +
        'กด “ล้างตัวกรอง” เพื่อดูทุกไลน์</div>';
      return;
    }
    v.innerHTML = (shown.length !== allList.length
      ? '<div class="hint" style="margin-bottom:10px">แสดง ' + shown.length + ' จาก ' + allList.length + ' แผน</div>'
      : '') + pmGanttHtml(shown);
    wireGantt(v, shown);
  }

  /** Plans and their sign-off history together — the calendar and the
   * machine checklist both need the pair. */
  async function loadAll() {
    ['allView', 'checkView'].forEach(function (id) {
      document.getElementById(id).innerHTML = U.skeletonCards(3);
    });
    U.progress(true);
    try {
      var res = await Promise.all([API.call('getPMMaster', {}), loadRecords()]);
      allList = res[0] || [];
      window._pmAll = allList;
      renderAll();
      renderCheck();
    } catch (e) {
      ['allView', 'checkView'].forEach(function (id) {
        document.getElementById(id).innerHTML = '<div class="empty">โหลดไม่สำเร็จ: ' + esc(e.message) + '</div>';
      });
    }
    finally { U.progress(false); }
  }

  /** After a sign-off: the calendar and checklist were drawn from the old
   * Next_Due, and leaving them that way is exactly how a finished PM keeps
   * looking undone. */
  function reloadAfterSave() {
    loadDue();
    if (window._pmAll) loadAll();
    else records = null;
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
        openHistory(row.getAttribute('data-pm'));
      };
    });
    function shift(n) { return function () { ganttOffset = n === 0 ? 0 : ganttOffset + n; renderAll(); }; }
    document.getElementById('ganttPrev').onclick = shift(-1);
    document.getElementById('ganttNext').onclick = shift(1);
    var now = document.getElementById('ganttNow');
    if (now) now.onclick = shift(0);
    // Bring today's column into view instead of starting scrolled all the way left.
    var wrap = container.querySelector('.pm-gantt-wrap');
    var todayTh = container.querySelector('th.gantt-today');
    if (wrap && todayTh) {
      var offset = todayTh.getBoundingClientRect().left - wrap.getBoundingClientRect().left + wrap.scrollLeft;
      wrap.scrollLeft = Math.max(0, offset - 120);
    }
  }

  function openModal(p) {
    currentPM = p; pmPhoto = null;
    document.getElementById('pmModalId').textContent = p.pmId;
    document.getElementById('pmModalItem').textContent = (p.pmItem || '') + ' — ' + (p.line || '') + ' ' + (p.mcStation || '');
    fillReference(p);
    document.getElementById('pmNgDetail').value = '';
    document.getElementById('pmAction').value = '';
    document.getElementById('pmActionSelect').innerHTML = actionOptionsHtml(p);
    setResult('OK');   // after the options exist, so it can show the right control
    setDoneShift(myShift());
    document.getElementById('pmPhoto').value = '';
    document.getElementById('pmPhoto').closest('.field').classList.remove('field-error');
    document.getElementById('pmPhotoPreview').classList.remove('show');
    document.getElementById('pmModal').classList.add('show');
  }
  function closeModal() { document.getElementById('pmModal').classList.remove('show'); }

  /** The reference photo, method and notes the admin attached to the plan —
   * the technician at the machine is the person who needs them. Tapping the
   * photo opens it full size. */
  function fillReference(p) {
    var link = document.getElementById('pmRefPhotoLink');
    var img = document.getElementById('pmRefPhoto');
    var std = document.getElementById('pmRefStd');
    var notes = document.getElementById('pmRefNotes');
    if (p.photoUrl) {
      img.src = p.photoUrl;
      link.href = p.photoUrl;
      link.style.display = '';
    } else {
      img.removeAttribute('src');
      link.style.display = 'none';
    }
    std.textContent = p.standard ? 'วิธีการทำ / เกณฑ์: ' + p.standard : '';
    notes.textContent = p.notes ? 'หมายเหตุ: ' + p.notes : '';
    document.getElementById('pmRef').style.display =
      (p.photoUrl || p.standard || p.notes) ? '' : 'none';
  }

  /** Which shift is doing this round. Covering for the other shift is fine —
   * the hint just says so, and who gets the next round. */
  var doneShift = '';
  function setDoneShift(s) {
    doneShift = s;
    document.getElementById('shiftA').classList.toggle('active', s === 'A');
    document.getElementById('shiftB').classList.toggle('active', s === 'B');
    var owner = currentPM && currentPM.shiftOwner;
    var hint = '';
    if (s) {
      hint = (owner && owner !== s)
        ? '⚠️ งานนี้เป็นของกะ ' + owner + ' — ทำแทนได้ '
        : '';
      hint += 'รอบหน้าจะเป็นของกะ ' + otherShift(s);
    }
    document.getElementById('pmShiftHint').textContent = hint;
  }

  function setResult(r) {
    result = r;
    document.getElementById('resOK').classList.toggle('active', r === 'OK');
    document.getElementById('resNG').classList.toggle('active', r === 'NG');
    document.getElementById('ngBox').style.display = (r === 'NG') ? 'block' : 'none';
    syncActionField();
  }

  /** OK gets the dropdown; NG always gets the box, because a fault and its
   * fix can't come off a list. Picking "อื่นๆ" on an OK opens the box too. */
  function syncActionField() {
    var sel = document.getElementById('pmActionSelect');
    var box = document.getElementById('pmAction');
    var pickable = (result === 'OK');
    sel.style.display = pickable ? '' : 'none';
    box.style.display = (pickable && sel.value) ? 'none' : '';
    if (!pickable) box.placeholder = 'สิ่งที่ทำไปเพื่อแก้ปัญหานี้';
    else box.placeholder = 'พิมพ์สิ่งที่ทำไป';
  }

  /** Whichever control is on screen is the answer. */
  function actionValue() {
    var sel = document.getElementById('pmActionSelect');
    if (result === 'OK' && sel.value) return sel.value;
    return document.getElementById('pmAction').value.trim();
  }

  async function submit() {
    var btn = document.getElementById('pmSubmitBtn');
    // The photo is the proof the work was done. The server refuses without
    // one too; this just says so before a round trip.
    if (pmPhotoBusy) return U.toast('กำลังเตรียมรูป รอสักครู่แล้วกดอีกครั้ง', 'error');
    if (!pmPhoto) {
      U.toast('ต้องถ่ายรูปหลังทำ PM ก่อนบันทึก', 'error');
      var field = document.getElementById('pmPhoto');
      field.scrollIntoView({ block: 'center', behavior: 'smooth' });
      field.closest('.field').classList.add('field-error');
      return;
    }
    var payload = {
      pmId: currentPM.pmId,
      result: result,
      ngDetail: document.getElementById('pmNgDetail').value.trim(),
      actionTaken: actionValue(),
      photoBase64: pmPhoto,
      shift: doneShift
    };
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> กำลังบันทึก...';
    try {
      var res = await API.call('submitPM', payload);
      closeModal();
      if (result === 'NG') offerBM();
      else U.toast('บันทึก PM สำเร็จ • ครบกำหนดครั้งถัดไป ' + U.thaiDate(res.nextDue) +
        (res.nextShiftOwner ? ' (กะ ' + res.nextShiftOwner + ')' : ''), 'success');
      reloadAfterSave();
      // One fewer plan waiting — the sidebar/bottom-nav count is computed at
      // page load, so it would otherwise keep showing the pre-PM number.
      if (window.Layout) Layout.refreshAlerts();
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

  // ---- bulk entry ---------------------------------------------------------

  /* Backfilling a stack of paper sheets one modal at a time is the slowest
   * possible way to use this app, and it's the situation every rollout hits:
   * the work got done and written down before the system was ready. This tab
   * lists everything due, prefills what was *done* per topic, and takes one
   * date, one technician and one save for the lot.
   *
   * What it deliberately does NOT prefill is the outcome. The OK/NG toggle is
   * the finding, and a finding has to come off the paper — a screen that
   * defaults sixty-five checks to "passed" would quietly launder a real NG
   * into a clean audit report. Rows also start unticked for the same reason:
   * saving is something a person does per row, not something that happens by
   * arriving on the page. */
  /* What a technician actually writes in "การดำเนินการ" after a PM that
   * passed is one of a handful of sentences, and they're the same sentences
   * every month — so on OK it's a dropdown, not a keyboard. NG is the
   * opposite: every fault is its own story and nothing can be canned, so
   * that stays a free-text box.
   *
   * Matched against the plan's ชื่อรายการ + เกณฑ์. First match wins, so the
   * more specific patterns go above the general ones (ตู้คอนโทรล before the
   * bare ไฟฟ้า, เซอร์โว before มอเตอร์). */
  var ACTION_SETS = [
    [/5\s*ส|5s|ตู้คอนโทรล/i, [
      'ทำความสะอาดและจัดระเบียบเรียบร้อย ไม่พบความผิดปกติ',
      'ทำความสะอาด ดูดฝุ่นภายในตู้ จัดเก็บสายไฟเรียบร้อย',
      'ทำความสะอาด และจัดทำป้ายชี้บ่งใหม่'
    ]],
    [/เซอร์โว|servo/i, [
      'ตรวจการทำงานชุดขับเซอร์โว ปกติ ไม่มีเสียงผิดปกติ',
      'อัดจารบีชุดขับ และตรวจการเคลื่อนที่ ปกติ',
      'ทำความสะอาดชุดขับ และตรวจจุดยึด แน่นดี'
    ]],
    [/จารบี|หล่อลื่น|grease|lubric/i, [
      'อัดจารบีครบทุกจุดตามแผน',
      'อัดจารบี และเช็ดคราบจารบีเก่าออก',
      'เติมสารหล่อลื่นจนได้ระดับที่กำหนด'
    ]],
    [/ลม|pneumat|air/i, [
      'ตรวจความดันลมอยู่ในเกณฑ์ ไม่พบรอยรั่ว',
      'ตรวจสอบและถ่ายน้ำออกจากชุดกรองลม',
      'ขันแน่นข้อต่อลม ไม่พบการรั่วซึม'
    ]],
    [/สายพาน|belt/i, [
      'ตรวจความตึงสายพาน อยู่ในเกณฑ์',
      'ปรับความตึงสายพานใหม่',
      'ตรวจสภาพสายพาน ไม่พบรอยแตกหรือสึกหรอ'
    ]],
    [/โซ่|chain/i, [
      'ตรวจความตึงโซ่และหล่อลื่น เรียบร้อย',
      'ปรับความตึงโซ่ใหม่ และหยอดน้ำมัน'
    ]],
    [/เซนเซอร์|เซ็นเซอร์|sensor/i, [
      'ทำความสะอาดหน้าเซนเซอร์ ทดสอบการตรวจจับปกติ',
      'ปรับตั้งระยะเซนเซอร์ใหม่ ทดสอบแล้วปกติ'
    ]],
    [/มอเตอร์|motor/i, [
      'ตรวจเสียง ความร้อน และการสั่นสะเทือน อยู่ในเกณฑ์ปกติ',
      'ทำความสะอาดพัดลมระบายความร้อน'
    ]],
    [/กรอง|ฟิลเตอร์|filter/i, [
      'ทำความสะอาดไส้กรอง ประกอบกลับเรียบร้อย',
      'เปลี่ยนไส้กรองใหม่ตามรอบ'
    ]],
    [/น้ำมัน|oil|ไฮดรอลิ|hydraul/i, [
      'ตรวจระดับน้ำมัน อยู่ในระดับที่กำหนด',
      'เติมน้ำมันจนได้ระดับที่กำหนด',
      'เปลี่ยนถ่ายน้ำมันตามรอบ'
    ]],
    [/สอบเทียบ|calib/i, [
      'สอบเทียบแล้ว ผลอยู่ในช่วงที่ยอมรับได้',
      'ปรับตั้งค่าใหม่ และสอบเทียบซ้ำ ผ่านเกณฑ์'
    ]],
    [/ไฟฟ้า|electric/i, [
      'ตรวจจุดต่อสายไฟ ขันแน่น ไม่พบความร้อนผิดปกติ',
      'ทำความสะอาดภายในตู้ไฟ ไม่พบคราบไหม้'
    ]],
    [/น็อต|ขันแน่น|bolt|screw/i, [
      'ตรวจและขันแน่นจุดยึดครบทุกจุด'
    ]],
    [/ทำความสะอาด|clean/i, [
      'ทำความสะอาดตามจุดที่กำหนด เรียบร้อย'
    ]]
  ];

  // Always offered, after whatever the topic matched — the honest catch-alls
  // for a check that passed with nothing else to say about it.
  var ACTION_GENERIC = [
    'ตรวจสอบตามเกณฑ์ ไม่พบความผิดปกติ',
    'ทำความสะอาดและตรวจสอบสภาพทั่วไป เรียบร้อย',
    'ปรับตั้ง/แก้ไขเล็กน้อย ใช้งานได้ปกติ'
  ];

  var ACTION_OTHER = 'อื่นๆ (พิมพ์เอง)';

  /** The dropdown for this plan: its topic's sentences first, then the
   * generic ones, then the escape hatch. Deduped, because a plan whose name
   * mentions cleaning would otherwise offer it twice. */
  function actionOptions(p) {
    var hay = String((p && p.pmItem) || '') + ' ' + String((p && p.standard) || '');
    var out = [];
    for (var i = 0; i < ACTION_SETS.length; i++) {
      if (ACTION_SETS[i][0].test(hay)) { out = ACTION_SETS[i][1].slice(); break; }
    }
    ACTION_GENERIC.forEach(function (g) { if (out.indexOf(g) < 0) out.push(g); });
    return out;
  }

  /** What the bulk table starts each row on — the topic's first sentence. */
  function defaultAction(p) { return actionOptions(p)[0]; }

  function actionOptionsHtml(p, selected) {
    return actionOptions(p).map(function (o) {
      return '<option value="' + esc(o) + '"' + (o === selected ? ' selected' : '') + '>' + esc(o) + '</option>';
    }).join('') + '<option value="">' + ACTION_OTHER + '</option>';
  }

  function bulkRowHtml(p) {
    return '<tr data-bulk="' + esc(p.pmId) + '">' +
      '<td class="bk-check"><input type="checkbox" class="bk-pick" aria-label="เลือก"></td>' +
      '<td><b>' + esc(p.pmItem || p.pmId) + '</b> ' + shiftPill(p.shiftOwner) +
        '<div class="mh-sub">' + esc(p.line) + ' • ' + esc(p.mcStation) + ' • ' + esc(p.frequency) +
        (p.overdue ? ' • <span class="pm-late-text">เกิน ' + p.overdueDays + ' วัน</span>' : '') + '</div></td>' +
      '<td class="bk-result">' +
        '<select class="bk-res"><option value="OK">OK</option><option value="NG">NG</option></select>' +
      '</td>' +
      '<td class="bk-action">' +
        '<select class="bk-act-sel">' + actionOptionsHtml(p, defaultAction(p)) + '</select>' +
        '<input type="text" class="bk-act" placeholder="พิมพ์สิ่งที่ทำไป" style="display:none">' +
        '<input type="text" class="bk-ng" placeholder="รายละเอียดปัญหาที่พบ (NG)" style="display:none">' +
      '</td>' +
    '</tr>';
  }

  function renderBulk() {
    var v = document.getElementById('bulkView');
    var shown = applyFilter(dueList);

    if (!dueList.length) {
      v.innerHTML = '<div class="empty">🎉 ไม่มีรายการ PM ที่ถึงกำหนด</div>';
      return;
    }
    if (!shown.length) {
      v.innerHTML = '<div class="empty">ไม่มีรายการตามตัวกรองนี้ (ทั้งหมด ' + dueList.length +
        ' รายการ) — กด “ล้างตัวกรอง” เพื่อดูทุกไลน์</div>';
      return;
    }

    // Same order as the due tab: most overdue line first, machine by machine.
    var ordered = [];
    groupDue(shown).forEach(function (g) {
      g.machines.forEach(function (m) { m.items.forEach(function (p) { ordered.push(p); }); });
    });

    var techOpts = (window._pmTechs || []).map(function (n) {
      return '<option value="' + esc(n) + '"></option>';
    }).join('');

    v.innerHTML =
      '<div class="card bk-bar">' +
        '<div class="bk-fields">' +
          '<label>วันที่ทำจริง<input type="date" id="bkDate" max="' + U.ymd(new Date()) + '"></label>' +
          '<label>ผู้ทำ<input type="text" id="bkTech" list="bkTechList" placeholder="ชื่อช่างที่ทำงานนี้">' +
            '<datalist id="bkTechList">' + techOpts + '</datalist></label>' +
          '<label>กะที่ทำ<select id="bkShift">' +
            '<option value="A">กะ A</option><option value="B">กะ B</option>' +
            '<option value="">ไม่ทราบ (สลับจากกะเดิม)</option>' +
          '</select></label>' +
        '</div>' +
        '<div class="bk-actions">' +
          '<button class="btn small secondary" id="bkAll">เลือกทั้งหมด (' + ordered.length + ')</button>' +
          '<button class="btn small secondary" id="bkNone">ล้างที่เลือก</button>' +
          '<button class="btn small success" id="bkSave" disabled>บันทึกที่เลือก</button>' +
        '</div>' +
        '<div class="hint bk-note">ติ๊กเฉพาะรายการที่ทำจริงตามใบกระดาษ • ช่อง “การดำเนินการ” ' +
          'เติมข้อความตั้งต้นไว้ให้ตามหัวข้อ แก้ไขได้ • ผล OK/NG ต้องเลือกเองตามที่บันทึกไว้จริง</div>' +
      '</div>' +
      '<div class="card table-wrap bk-table">' +
        '<table><thead><tr><th class="bk-check"></th><th>รายการ PM</th><th>ผล</th>' +
        '<th>การดำเนินการ (Action Taken)</th></tr></thead>' +
        '<tbody>' + ordered.map(bulkRowHtml).join('') + '</tbody></table></div>';

    document.getElementById('bkDate').value = U.ymd(new Date());
    var u = (window.Auth && Auth.get()) || {};
    document.getElementById('bkTech').value = u.name || '';
    document.getElementById('bkShift').value = myShift();
    wireBulk(v);
  }

  /** Same rule as the modal, one row at a time: OK picks from the list, NG
   * (or "อื่นๆ") types.
   *
   * Nothing is copied from the dropdown into the box on the way to NG — the
   * sentences in that list all describe a check that passed, and dropping
   * one into the fix field of a failed check is exactly the wrong default.
   * The select keeps its selection either way, so flipping back to OK
   * restores it. */
  function syncBulkAction(tr) {
    var sel = tr.querySelector('.bk-act-sel');
    var box = tr.querySelector('.bk-act');
    var pickable = tr.querySelector('.bk-res').value !== 'NG';
    sel.style.display = pickable ? '' : 'none';
    box.style.display = (pickable && sel.value) ? 'none' : '';
  }

  function bulkActionValue(tr) {
    var sel = tr.querySelector('.bk-act-sel');
    if (tr.querySelector('.bk-res').value !== 'NG' && sel.value) return sel.value;
    return tr.querySelector('.bk-act').value.trim();
  }

  function pickedRows() {
    return Array.prototype.filter.call(
      document.querySelectorAll('#bulkView tr[data-bulk]'),
      function (tr) { return tr.querySelector('.bk-pick').checked; });
  }

  function refreshBulkCount() {
    var n = pickedRows().length;
    var btn = document.getElementById('bkSave');
    if (!btn) return;
    btn.disabled = !n;
    btn.textContent = n ? ('บันทึก ' + n + ' รายการ') : 'บันทึกที่เลือก';
  }

  function wireBulk(v) {
    v.querySelectorAll('tr[data-bulk]').forEach(function (tr) {
      tr.querySelector('.bk-pick').addEventListener('change', function () {
        tr.classList.toggle('is-picked', this.checked);
        refreshBulkCount();
      });
      // NG needs somewhere to say what was wrong, and ticking the row is
      // implied — nobody selects NG on a line they aren't recording.
      tr.querySelector('.bk-res').addEventListener('change', function () {
        var ng = this.value === 'NG';
        tr.querySelector('.bk-ng').style.display = ng ? '' : 'none';
        tr.classList.toggle('is-ng', ng);
        syncBulkAction(tr);
        if (ng) {
          var pick = tr.querySelector('.bk-pick');
          if (!pick.checked) { pick.checked = true; tr.classList.add('is-picked'); refreshBulkCount(); }
        }
      });
      tr.querySelector('.bk-act-sel').addEventListener('change', function () { syncBulkAction(tr); });
    });

    document.getElementById('bkAll').onclick = function () {
      v.querySelectorAll('tr[data-bulk]').forEach(function (tr) {
        tr.querySelector('.bk-pick').checked = true;
        tr.classList.add('is-picked');
      });
      refreshBulkCount();
    };
    document.getElementById('bkNone').onclick = function () {
      v.querySelectorAll('tr[data-bulk]').forEach(function (tr) {
        tr.querySelector('.bk-pick').checked = false;
        tr.classList.remove('is-picked');
      });
      refreshBulkCount();
    };
    document.getElementById('bkSave').onclick = submitBulk;
    refreshBulkCount();
  }

  async function submitBulk() {
    var rows = pickedRows();
    if (!rows.length) return;
    var date = document.getElementById('bkDate').value;
    var tech = document.getElementById('bkTech').value.trim();
    var shift = document.getElementById('bkShift').value;
    if (!date) return U.toast('ใส่วันที่ทำจริงก่อน', 'error');
    if (!tech) return U.toast('ใส่ชื่อผู้ทำก่อน', 'error');

    var items = rows.map(function (tr) {
      return {
        pmId: tr.getAttribute('data-bulk'),
        result: tr.querySelector('.bk-res').value,
        actionTaken: bulkActionValue(tr),
        ngDetail: tr.querySelector('.bk-ng').value.trim()
      };
    });
    var ng = items.filter(function (i) { return i.result === 'NG'; }).length;

    // Sixty-five records at once is not an action to take by accident, and
    // the date is the one field that's easy to leave on today by mistake.
    var ok = confirm('บันทึก ' + items.length + ' รายการ\n' +
      'วันที่ทำจริง: ' + U.thaiDate(date) + '\nผู้ทำ: ' + tech + '\n' +
      'กะที่ทำ: ' + (shift ? 'กะ ' + shift + ' (รอบหน้าเป็นของกะ ' + otherShift(shift) + ')' : 'ไม่ทราบ') + '\n' +
      (ng ? 'ในนี้เป็น NG ' + ng + ' รายการ\n' : '') + '\nยืนยันหรือไม่?');
    if (!ok) return;

    var btn = document.getElementById('bkSave');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> กำลังบันทึก...';
    U.progress(true);
    try {
      var res = await API.call('submitPMBulk', { doneDate: date, technician: tech, shift: shift, items: items });
      var msg = 'บันทึกสำเร็จ ' + res.saved + ' รายการ';
      if (res.failed && res.failed.length) msg += ' • ไม่สำเร็จ ' + res.failed.length + ' รายการ';
      U.toast(msg, res.failed && res.failed.length ? 'error' : 'success');
      await loadDue();
      renderBulk();
      if (window._pmAll) loadAll(); else records = null;
      if (window.Layout) Layout.refreshAlerts();
    } catch (e) {
      U.toast('บันทึกไม่สำเร็จ: ' + e.message, 'error');
    } finally {
      U.progress(false);
      refreshBulkCount();
    }
  }

  var VIEWS = { due: 'dueView', bulk: 'bulkView', check: 'checkView', all: 'allView' };

  function initTabs() {
    document.querySelectorAll('#pmTabs [data-tab]').forEach(function (b) {
      b.onclick = function () {
        document.querySelectorAll('#pmTabs [data-tab]').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        var t = b.getAttribute('data-tab');
        Object.keys(VIEWS).forEach(function (k) {
          document.getElementById(VIEWS[k]).style.display = (k === t) ? 'block' : 'none';
        });
        if ((t === 'all' || t === 'check') && !window._pmAll) loadAll();
        if (t === 'bulk') renderBulk();
      };
    });
  }

  // ---- filters ------------------------------------------------------------

  function fillSelect(el, items, placeholder) {
    var keep = el.value;
    el.innerHTML = '';
    if (placeholder) el.appendChild(new Option(placeholder, ''));
    (items || []).forEach(function (v) { el.appendChild(new Option(v, v)); });
    if (keep && items && items.indexOf(keep) >= 0) el.value = keep;
  }

  /** Same three-level cascade as the report form and ประวัติเครื่อง: an area
   * narrows the lines, a line narrows the machines. A level whose value no
   * longer exists under its parent is reset rather than silently filtering
   * everything out. */
  function refreshPickers() {
    if (!cfg) return;   // CONFIG failed to load: the filter row is hidden anyway
    var areaSel = document.getElementById('fArea');
    var lineSel = document.getElementById('fLine');
    var mcSel = document.getElementById('fMc');

    var lines = areaSel.value
      ? U.linesForArea(cfg, areaSel.value)
      : (cfg.Line || []);
    if (lineSel.value && lines.indexOf(lineSel.value) < 0) lineSel.value = '';
    fillSelect(lineSel, lines, 'ทุกไลน์');

    var machines = lineSel.value
      ? U.machinesFor(cfg, areaSel.value || (cfg.AreaOfLine || {})[lineSel.value], lineSel.value)
      : [];
    if (mcSel.value && machines.indexOf(mcSel.value) < 0) mcSel.value = '';
    fillSelect(mcSel, machines, machines.length ? 'ทุกเครื่อง' : 'ทุกเครื่อง (เลือกไลน์ก่อน)');
    mcSel.disabled = !machines.length;
  }

  function onFilterChange() {
    var f = currentFilter();
    document.getElementById('pmClear').style.display = filterActive(f) ? '' : 'none';
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch (e) {}
    renderDue();
    if (allList.length) { renderAll(); renderCheck(); }
    // Re-rendering the bulk tab throws away anything half-typed in it, so
    // only do it while it's the tab on screen.
    if (document.getElementById('bulkView').style.display !== 'none') renderBulk();
  }

  function restoreFilter() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(FILTER_KEY) || 'null'); } catch (e) {}
    if (!saved) return;
    document.getElementById('fArea').value = saved.area || '';
    refreshPickers();
    document.getElementById('fLine').value = saved.line || '';
    refreshPickers();
    document.getElementById('fMc').value = saved.mc || '';
    document.getElementById('fShift').value = saved.shift || '';
  }

  function fillShiftFilter() {
    var sel = document.getElementById('fShift');
    var mine = myShift();
    sel.innerHTML = '';
    sel.appendChild(new Option('ทุกกะ', ''));
    ['A', 'B'].forEach(function (s) {
      sel.appendChild(new Option('กะ ' + s + (s === mine ? ' (กะของฉัน)' : ''), s));
    });
  }

  function initFilters() {
    var areaSel = document.getElementById('fArea');
    var areas = cfg.Area || [];
    fillSelect(areaSel, areas, 'ทุกไลน์หลัก');
    // One area = one book; the level exists but has nothing to choose between.
    areaSel.style.display = areas.length > 1 ? '' : 'none';

    areaSel.addEventListener('change', function () { refreshPickers(); onFilterChange(); });
    document.getElementById('fLine').addEventListener('change', function () { refreshPickers(); onFilterChange(); });
    document.getElementById('fMc').addEventListener('change', onFilterChange);
    fillShiftFilter();
    document.getElementById('fShift').addEventListener('change', onFilterChange);
    document.getElementById('pmClear').onclick = function () {
      areaSel.value = ''; document.getElementById('fLine').value = ''; document.getElementById('fMc').value = '';
      document.getElementById('fShift').value = '';
      refreshPickers();
      onFilterChange();
    };
    document.getElementById('pmRefresh').onclick = function () {
      loadDue();
      if (window._pmAll) loadAll();
    };

    refreshPickers();
    restoreFilter();
    refreshPickers();
    document.getElementById('pmClear').style.display = filterActive(currentFilter()) ? '' : 'none';
  }

  async function init() {
    Auth.renderUserBadge('userBadge');
    initTabs();
    document.getElementById('resOK').onclick = function () { setResult('OK'); };
    document.getElementById('resNG').onclick = function () { setResult('NG'); };
    document.getElementById('shiftA').onclick = function () { setDoneShift('A'); };
    document.getElementById('shiftB').onclick = function () { setDoneShift('B'); };
    document.getElementById('pmActionSelect').onchange = syncActionField;
    document.getElementById('pmCancelBtn').onclick = closeModal;
    document.getElementById('pmModalXBtn').onclick = closeModal;
    document.getElementById('pmSubmitBtn').onclick = submit;
    document.getElementById('pmHistXBtn').onclick = closeHistory;
    document.getElementById('pmHistCloseBtn').onclick = closeHistory;
    document.getElementById('pmHistDoBtn').onclick = function () {
      var p = histPM;
      closeHistory();
      if (p) openModal(p);
    };
    document.getElementById('pmPhoto').addEventListener('change', async function (e) {
      var f = e.target.files[0]; if (!f) { pmPhoto = null; return; }
      pmPhotoBusy = true;
      try { pmPhoto = await U.compressImage(f, 1280); }
      finally { pmPhotoBusy = false; }
      this.closest('.field').classList.remove('field-error');
      var img = document.getElementById('pmPhotoPreview'); img.src = pmPhoto; img.classList.add('show');
    });

    // CONFIG drives the pickers and the line -> area lookup the grouping
    // needs. A failure there shouldn't cost the due list, which is the
    // reason the page exists — fall back to an unfiltered flat view.
    try { cfg = await API.getConfig(); initFilters(); }
    catch (e) {
      cfg = null;
      document.querySelector('.filters').style.display = 'none';
      U.toast('โหลดตัวกรองไม่สำเร็จ: ' + e.message, 'error');
    }

    // Suggestions for the bulk "ผู้ทำ" box. Free text either way — a name off
    // a paper sheet doesn't have to be a system account.
    API.call('getUserNames', {}).then(function (list) {
      window._pmTechs = (list || []).map(function (u) { return u.name; });
    }).catch(function () { window._pmTechs = []; });

    await loadDue();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
