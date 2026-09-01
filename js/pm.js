/* pm.html — PM due list, checklist, and NG -> BM handoff */
(function () {
  var pmPhoto = null;
  var currentPM = null;
  var result = 'OK';
  var cfg = null;
  var dueList = [];   // every due plan, unfiltered, as the API returned it
  var allList = [];   // every plan, unfiltered

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
      mc:   document.getElementById('fMc').value
    };
  }

  function filterActive(f) { return !!(f.area || f.line || f.mc); }

  function applyFilter(list) {
    var f = currentFilter();
    return list.filter(function (p) {
      if (f.area && areaOf(p) !== f.area) return false;
      if (f.line && p.line !== f.line) return false;
      if (f.mc && p.mcStation !== f.mc) return false;
      return true;
    });
  }

  function pmCardHtml(p, showDue) {
    var overdue = p.overdue
      ? '<span class="pill overdue">เกิน ' + p.overdueDays + ' วัน</span>'
      : '<span class="pill">ถึงกำหนด</span>';
    return '<div class="card' + (showDue && p.overdue ? ' pm-card-overdue' : '') + '">' +
      '<div style="display:flex;justify-content:space-between;gap:8px">' +
        '<b>' + esc(p.pmItem || p.pmId) + '</b>' + (showDue ? overdue : (p.active ? '<span class="pill ok">Active</span>' : '<span class="pill">ปิด</span>')) +
      '</div>' +
      '<div class="meta">' + esc(p.line) + ' • ' + esc(p.mcStation) + ' • ' + esc(p.frequency) + '</div>' +
      (p.standard ? '<div class="hint">เกณฑ์: ' + esc(p.standard) + '</div>' : '') +
      '<div class="hint">ครบกำหนด: ' + U.thaiDate(p.nextDue) + (p.lastDone ? ' • ทำล่าสุด: ' + U.thaiDate(p.lastDone) : '') + '</div>' +
      '<div class="btn-group" style="margin-top:8px"><button class="btn small" data-pm="' + esc(p.pmId) + '">ทำ PM</button></div>' +
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

    return '<div class="card pm-summary">' +
      '<div class="pm-summary-head">' + head + '</div>' +
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

  /** Schedule overview: one row per plan, one column per day of the current
   * month, with a dot marking the day each plan's next-due date falls on.
   * Click a row to open the same "ทำ PM" modal a due-list card would. */
  function pmGanttHtml(list) {
    var today = new Date();
    var y = today.getFullYear(), mo = today.getMonth(), todayDate = today.getDate();
    var daysInMonth = new Date(y, mo + 1, 0).getDate();
    var startOfToday = new Date(y, mo, todayDate);

    var dayHeaders = '';
    for (var d = 1; d <= daysInMonth; d++) {
      dayHeaders += '<th class="gantt-day' + (d === todayDate ? ' gantt-today' : '') + '">' + d + '</th>';
    }

    var rows = list.map(function (p) {
      var due = U.toDate(p.nextDue);
      var dueDay = (due && due.getFullYear() === y && due.getMonth() === mo) ? due.getDate() : null;
      var overdue = !!(due && due < startOfToday);
      // Line first: with several lines in one table, the machine number alone
      // ("Station 10") doesn't say which line's Station 10 this is.
      var meta = [p.line, p.mcStation, p.frequency, p.assignedTo].filter(Boolean).join(' · ');
      var cells = '';
      for (var d2 = 1; d2 <= daysInMonth; d2++) {
        var marker = (d2 === dueDay) ? '<span class="gantt-dot' + (overdue ? ' overdue' : '') + '"></span>' : '';
        cells += '<td class="gantt-day' + (d2 === todayDate ? ' gantt-today' : '') + '">' + marker + '</td>';
      }
      return '<tr data-pm="' + U.escapeHtml(p.pmId) + '">' +
        '<td class="gantt-label"><b>' + U.escapeHtml(p.pmItem || p.pmId) + '</b>' +
        '<div class="meta">' + U.escapeHtml(meta) + '</div></td>' + cells + '</tr>';
    }).join('');

    return '<div class="card" style="padding:0;overflow:hidden">' +
      '<div class="pm-gantt-wrap"><table class="pm-gantt">' +
        '<thead>' +
          '<tr><th class="gantt-label"></th><th class="gantt-month" colspan="' + daysInMonth + '">' + U.monthsTh[mo] + ' ' + y + '</th></tr>' +
          '<tr><th class="gantt-label">แผน PM</th>' + dayHeaders + '</tr>' +
        '</thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="pm-gantt-legend">' +
        '<span><span class="gantt-dot"></span> ครบกำหนดในเดือนนี้</span>' +
        '<span><span class="gantt-dot overdue"></span> เลยกำหนดแล้ว</span>' +
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

  async function loadAll() {
    var v = document.getElementById('allView');
    v.innerHTML = U.skeletonCards(3);
    U.progress(true);
    try {
      allList = await API.call('getPMMaster', {});
      window._pmAll = allList;
      renderAll();
    } catch (e) { v.innerHTML = '<div class="empty">โหลดไม่สำเร็จ: ' + esc(e.message) + '</div>'; }
    finally { U.progress(false); }
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
        var p = list.filter(function (x) { return x.pmId === row.getAttribute('data-pm'); })[0];
        if (p) openModal(p);
      };
    });
    // Bring today's column into view instead of starting scrolled all the way left.
    var wrap = container.querySelector('.pm-gantt-wrap');
    var todayTh = container.querySelector('.gantt-today');
    if (wrap && todayTh) {
      var offset = todayTh.getBoundingClientRect().left - wrap.getBoundingClientRect().left + wrap.scrollLeft;
      wrap.scrollLeft = Math.max(0, offset - 120);
    }
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
  var ACTION_TEMPLATES = [
    [/5\s*ส|5s/i,                       'ทำความสะอาดและจัดระเบียบตามหลัก 5ส'],
    [/จารบี|หล่อลื่น|grease|lubric/i,   'อัดจารบี/เติมสารหล่อลื่นตามจุดที่กำหนด'],
    [/ลม|pneumat|air/i,                 'ตรวจความดันลมและสภาพท่อ/ข้อต่อ'],
    [/สอบเทียบ|calib/i,                 'สอบเทียบตามเกณฑ์ที่กำหนด'],
    [/สายพาน|belt/i,                    'ตรวจความตึงและสภาพสายพาน'],
    [/โซ่|chain/i,                      'ตรวจความตึงและหล่อลื่นโซ่'],
    [/เซนเซอร์|เซ็นเซอร์|sensor/i,      'ทำความสะอาดหน้าเซนเซอร์และทดสอบการตรวจจับ'],
    [/เซอร์โว|servo/i,                  'ตรวจการทำงานของชุดขับเซอร์โว'],
    [/มอเตอร์|motor/i,                  'ตรวจเสียง ความร้อน และการสั่นสะเทือนของมอเตอร์'],
    [/กรอง|ฟิลเตอร์|filter/i,           'ตรวจสภาพไส้กรอง ทำความสะอาด/เปลี่ยนตามรอบ'],
    [/น้ำมัน|oil|ไฮดรอลิ|hydraul/i,     'ตรวจระดับและสภาพน้ำมัน เติมให้อยู่ในระดับที่กำหนด'],
    [/ไฟฟ้า|electric|ตู้คอนโทรล/i,      'ตรวจสอบอุปกรณ์ไฟฟ้าและจุดต่อสาย ทำความสะอาดภายในตู้'],
    [/น็อต|ขันแน่น|bolt|screw/i,        'ตรวจและขันแน่นจุดยึดต่างๆ'],
    [/ทำความสะอาด|clean/i,              'ทำความสะอาดตามจุดที่กำหนด']
  ];

  /** A first draft of "what was done" for this plan — the activity, never the
   * outcome. Falls back to the plan's own เกณฑ์, which is the most accurate
   * description of the job available without asking anyone. */
  function defaultAction(p) {
    var hay = String(p.pmItem || '') + ' ' + String(p.standard || '');
    for (var i = 0; i < ACTION_TEMPLATES.length; i++) {
      if (ACTION_TEMPLATES[i][0].test(hay)) return ACTION_TEMPLATES[i][1];
    }
    return p.standard ? ('ดำเนินการตามเกณฑ์: ' + p.standard) : ('ดำเนินการตามแผน ' + (p.pmItem || p.pmId));
  }

  function bulkRowHtml(p) {
    return '<tr data-bulk="' + esc(p.pmId) + '">' +
      '<td class="bk-check"><input type="checkbox" class="bk-pick" aria-label="เลือก"></td>' +
      '<td><b>' + esc(p.pmItem || p.pmId) + '</b>' +
        '<div class="mh-sub">' + esc(p.line) + ' • ' + esc(p.mcStation) + ' • ' + esc(p.frequency) +
        (p.overdue ? ' • <span class="pm-late-text">เกิน ' + p.overdueDays + ' วัน</span>' : '') + '</div></td>' +
      '<td class="bk-result">' +
        '<select class="bk-res"><option value="OK">OK</option><option value="NG">NG</option></select>' +
      '</td>' +
      '<td class="bk-action">' +
        '<input type="text" class="bk-act" value="' + esc(defaultAction(p)) + '">' +
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
    wireBulk(v);
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
        if (ng) {
          var pick = tr.querySelector('.bk-pick');
          if (!pick.checked) { pick.checked = true; tr.classList.add('is-picked'); refreshBulkCount(); }
        }
      });
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
    if (!date) return U.toast('ใส่วันที่ทำจริงก่อน', 'error');
    if (!tech) return U.toast('ใส่ชื่อผู้ทำก่อน', 'error');

    var items = rows.map(function (tr) {
      return {
        pmId: tr.getAttribute('data-bulk'),
        result: tr.querySelector('.bk-res').value,
        actionTaken: tr.querySelector('.bk-act').value.trim(),
        ngDetail: tr.querySelector('.bk-ng').value.trim()
      };
    });
    var ng = items.filter(function (i) { return i.result === 'NG'; }).length;

    // Sixty-five records at once is not an action to take by accident, and
    // the date is the one field that's easy to leave on today by mistake.
    var ok = confirm('บันทึก ' + items.length + ' รายการ\n' +
      'วันที่ทำจริง: ' + U.thaiDate(date) + '\nผู้ทำ: ' + tech + '\n' +
      (ng ? 'ในนี้เป็น NG ' + ng + ' รายการ\n' : '') + '\nยืนยันหรือไม่?');
    if (!ok) return;

    var btn = document.getElementById('bkSave');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> กำลังบันทึก...';
    U.progress(true);
    try {
      var res = await API.call('submitPMBulk', { doneDate: date, technician: tech, items: items });
      var msg = 'บันทึกสำเร็จ ' + res.saved + ' รายการ';
      if (res.failed && res.failed.length) msg += ' • ไม่สำเร็จ ' + res.failed.length + ' รายการ';
      U.toast(msg, res.failed && res.failed.length ? 'error' : 'success');
      await loadDue();
      renderBulk();
      if (window.Layout) Layout.refreshAlerts();
    } catch (e) {
      U.toast('บันทึกไม่สำเร็จ: ' + e.message, 'error');
    } finally {
      U.progress(false);
      refreshBulkCount();
    }
  }

  var VIEWS = { due: 'dueView', bulk: 'bulkView', all: 'allView' };

  function initTabs() {
    document.querySelectorAll('#pmTabs [data-tab]').forEach(function (b) {
      b.onclick = function () {
        document.querySelectorAll('#pmTabs [data-tab]').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        var t = b.getAttribute('data-tab');
        Object.keys(VIEWS).forEach(function (k) {
          document.getElementById(VIEWS[k]).style.display = (k === t) ? 'block' : 'none';
        });
        if (t === 'all' && !window._pmAll) loadAll();
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
    if (allList.length) renderAll();
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
    document.getElementById('pmClear').onclick = function () {
      areaSel.value = ''; document.getElementById('fLine').value = ''; document.getElementById('fMc').value = '';
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
    document.getElementById('pmCancelBtn').onclick = closeModal;
    document.getElementById('pmModalXBtn').onclick = closeModal;
    document.getElementById('pmSubmitBtn').onclick = submit;
    document.getElementById('pmPhoto').addEventListener('change', async function (e) {
      var f = e.target.files[0]; if (!f) { pmPhoto = null; return; }
      pmPhoto = await U.compressImage(f, 1280);
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
