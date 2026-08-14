/* admin.html — CRUD for CONFIG / PM_MASTER / USERS (Admin only) */
(function () {
  var current = 'config';

  function esc(s) { return U.escapeHtml(s); }

  // ---- CONFIG -------------------------------------------------------------
  // The sheet is one flat Type/Value/Parent table, but it encodes three very
  // different things: a three-level machine tree, the dropdown option lists,
  // and a couple of system settings. Editing that as a raw table meant knowing
  // which Type spelling was right and what Parent meant for that particular
  // Type — a typo silently produced a machine nothing could reach. So each of
  // the three is rendered as the thing it actually is, and the flat rows are
  // written back underneath.

  var cfgRows = [];        // { rowIndex, type, value, parent, active }
  var cfgDefaultArea = '';

  // Which Type hangs off which. Used for both rendering and cascade deletes.
  var CHILD_TYPE = { Area: 'Line', Line: 'Station', Main_Issue: 'Issue' };

  function cfgByType(type) {
    return cfgRows.filter(function (r) { return r.type === type; });
  }
  function cfgChildren(node) {
    var ct = CHILD_TYPE[node.type];
    if (!ct) return [];
    return cfgRows.filter(function (r) { return r.type === ct && r.parent === node.value; });
  }
  /** A node plus everything under it, deepest first — the order a cascade
   * delete has to use, since deleting a row shifts every row below it. */
  function cfgWithDescendants(node) {
    var out = [node];
    cfgChildren(node).forEach(function (c) {
      out = out.concat(cfgWithDescendants(c));
    });
    return out;
  }

  /** "+ เพิ่ม" that swaps itself for a name box in place — adding a machine is
   * the frequent job here, so it shouldn't cost a dialog or a page jump. */
  function addControl(type, parent, label, placeholder) {
    return '<span class="cfg-add" data-add-type="' + esc(type) + '" data-add-parent="' + esc(parent || '') + '">' +
      '<button class="btn small ghost" data-add-open>+ ' + esc(label) + '</button>' +
      '<span class="cfg-add-form" hidden>' +
        '<input placeholder="' + esc(placeholder || 'ชื่อ') + '">' +
        '<button class="btn small" data-add-ok>เพิ่ม</button>' +
        '<button class="btn small ghost" data-add-cancel>ยกเลิก</button>' +
      '</span></span>';
  }

  function nodeActions(node, addLabel) {
    return '<span class="cfg-actions">' +
      (CHILD_TYPE[node.type] ? addControl(CHILD_TYPE[node.type], node.value, addLabel, 'ชื่อ' + addLabel) : '') +
      '<button class="btn small ghost" data-ren="' + node.rowIndex + '">เปลี่ยนชื่อ</button>' +
      '<button class="btn small danger" data-del="' + node.rowIndex + '">ลบ</button>' +
      '</span>';
  }

  /** Chips for leaf values (machines, priorities, shifts…). */
  function chips(list, emptyText) {
    if (!list.length) return '<span class="cfg-empty">' + esc(emptyText) + '</span>';
    return list.map(function (r) {
      return '<span class="cfg-chip">' + esc(r.value) +
        '<button class="cfg-chip-x" data-del="' + r.rowIndex + '" title="ลบ">×</button></span>';
    }).join('');
  }

  function machineTreeHtml() {
    var areas = cfgByType('Area');
    var shared = cfgRows.filter(function (r) { return r.type === 'Station' && !r.parent; });

    var html = '<div class="card">' +
      '<div class="card-head"><span class="ch-icon">🏭</span><div>' +
        '<div class="ch-title">โครงสร้างเครื่องจักร</div>' +
        '<div class="ch-sub">ไลน์หลัก → ไลน์ / เครื่องหลัก → M/C — กดปุ่ม + ตรงจุดที่ต้องการเพิ่ม</div>' +
      '</div></div>';

    if (!areas.length) html += '<div class="empty">ยังไม่มีไลน์หลัก — กดปุ่มด้านล่างเพื่อเริ่ม</div>';

    areas.forEach(function (area) {
      var lines = cfgChildren(area);
      var isDefault = area.value === cfgDefaultArea;
      html += '<div class="cfg-area">' +
        '<div class="cfg-node cfg-node-area"><span class="cfg-name">' + esc(area.value) + '</span>' +
          (isDefault ? '<span class="cfg-tag">ไลน์หลักตั้งต้น</span>' : '') +
          nodeActions(area, 'ไลน์') + '</div>';

      if (!lines.length) {
        html += '<div class="cfg-empty cfg-indent">ยังไม่มีไลน์ในพื้นที่นี้</div>';
      }
      lines.forEach(function (line) {
        var own = cfgChildren(line);
        html += '<div class="cfg-line">' +
          '<div class="cfg-node"><span class="cfg-name">' + esc(line.value) + '</span>' +
            nodeActions(line, 'เครื่อง') + '</div>' +
          '<div class="cfg-chips">';
        if (own.length) {
          html += chips(own, '');
        } else if (isDefault) {
          html += '<span class="cfg-empty">ใช้เครื่องกลางร่วมกัน (ดูด้านล่าง)</span>';
        } else {
          html += '<span class="cfg-empty">ยังไม่มีเครื่องย่อย — ระบบจะใช้ชื่อ “' + esc(line.value) + '” เป็นเครื่องไปก่อน</span>';
        }
        html += '</div></div>';
      });
      html += '</div>';
    });

    html += '<div class="cfg-shared">' +
      '<div class="cfg-node"><span class="cfg-name">เครื่องกลาง — ใช้ได้ทุกไลน์ของ ' +
        esc(cfgDefaultArea || 'ไลน์หลักตั้งต้น') + '</span>' +
        '<span class="cfg-actions">' + addControl('Station', '', 'เครื่องกลาง', 'เช่น Station 22') + '</span></div>' +
      '<div class="cfg-chips">' + chips(shared, 'ยังไม่มีเครื่องกลาง') + '</div>' +
      '<div class="hint">Station 1–21 เดิมอยู่ตรงนี้ — ไม่ผูกกับไลน์ใดไลน์หนึ่ง จึงเลือกได้จากทุกไลน์ของไลน์หลักตั้งต้น</div>' +
    '</div>';

    html += '<div class="cfg-foot">' + addControl('Area', '', 'ไลน์หลัก', 'เช่น Assembly M/C') + '</div>';
    return html + '</div>';
  }

  function optionsHtml() {
    var html = '<div class="card">' +
      '<div class="card-head"><span class="ch-icon">📋</span><div>' +
        '<div class="ch-title">ตัวเลือกในฟอร์ม</div>' +
        '<div class="ch-sub">รายการที่ขึ้นให้เลือกตอนแจ้งซ่อมและปิดงาน</div>' +
      '</div></div>';

    // Main_Issue owns Issue, so it gets the same parent/child treatment.
    html += '<div class="cfg-group"><div class="cfg-group-title">ประเภทปัญหา และอาการย่อย</div>';
    var mains = cfgByType('Main_Issue');
    if (!mains.length) html += '<div class="cfg-empty">ยังไม่มีประเภทปัญหา</div>';
    mains.forEach(function (m) {
      html += '<div class="cfg-line">' +
        '<div class="cfg-node"><span class="cfg-name">' + esc(m.value) + '</span>' +
          nodeActions(m, 'อาการ') + '</div>' +
        '<div class="cfg-chips">' + chips(cfgChildren(m), 'ยังไม่มีอาการย่อย') + '</div>' +
      '</div>';
    });
    html += '<div class="cfg-foot">' + addControl('Main_Issue', '', 'ประเภทปัญหา', 'เช่น Mechanical') + '</div></div>';

    [['Priority', 'ความเร่งด่วน', 'เช่น ด่วน'],
     ['Shift', 'กะ', 'เช่น C'],
     ['By', 'ตำแหน่งผู้ซ่อม', 'เช่น Technician']].forEach(function (g) {
      html += '<div class="cfg-group"><div class="cfg-group-title">' + esc(g[1]) + '</div>' +
        '<div class="cfg-chips">' + chips(cfgByType(g[0]), 'ยังไม่มีรายการ') + '</div>' +
        '<div class="cfg-foot">' + addControl(g[0], '', g[1], g[2]) + '</div></div>';
    });

    return html + '</div>';
  }

  function settingsHtml() {
    var settings = cfgByType('Setting');
    if (!settings.length) return '';
    var LABELS = {
      ShiftA_StartHour: 'กะ A เริ่มเวลา (ชั่วโมง 0–23)',
      ShiftB_StartHour: 'กะ B เริ่มเวลา (ชั่วโมง 0–23)'
    };
    return '<div class="card">' +
      '<div class="card-head"><span class="ch-icon">🕒</span><div>' +
        '<div class="ch-title">ค่าตั้งค่าระบบ</div>' +
        '<div class="ch-sub">ใช้คำนวณว่างานที่แจ้งเข้ามาอยู่กะไหน</div>' +
      '</div></div>' +
      settings.map(function (s) {
        return '<div class="cfg-setting">' +
          '<label>' + esc(LABELS[s.parent] || s.parent) + '</label>' +
          '<input value="' + esc(s.value) + '" data-set-row="' + s.rowIndex +
            '" data-set-key="' + esc(s.parent) + '">' +
          '<button class="btn small" data-set-save="' + s.rowIndex + '">บันทึก</button>' +
        '</div>';
      }).join('') + '</div>';
  }

  function rawTableHtml() {
    var rowsHtml = cfgRows.map(function (r) {
      return '<tr><td>' + esc(r.type) + '</td><td>' + esc(r.value) + '</td><td>' + esc(r.parent) +
        '</td><td>' + esc(String(r.active)) + '</td>' +
        '<td><button class="btn small danger" data-del="' + r.rowIndex + '">ลบ</button></td></tr>';
    }).join('');
    return '<details class="card cfg-raw"><summary>ดูตารางดิบทั้งหมด (ขั้นสูง)</summary>' +
      '<div class="hint">ตรงกับชีต CONFIG ทีละแถว ใช้เมื่อมีค่าแปลกๆ ที่ส่วนด้านบนไม่ครอบคลุม</div>' +
      '<div class="table-wrap"><table><thead><tr><th>Type</th><th>Value</th><th>Parent</th><th>Active</th><th></th></tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody></table></div></details>';
  }

  async function renderConfig() {
    var panel = document.getElementById('panel');
    panel.innerHTML = '<div class="empty">กำลังโหลด...</div>';
    var raw;
    try {
      raw = await API.call('adminCRUD', { entity: 'CONFIG', op: 'list' });
      try { cfgDefaultArea = (await API.getConfig()).DefaultArea || ''; } catch (e2) {}
    } catch (e) {
      panel.innerHTML = '<div class="empty">โหลดไม่สำเร็จ: ' + esc(e.message) + '</div>';
      return;
    }

    // raw[0] is the header, so raw[i] lives on sheet row i + 1.
    cfgRows = raw.slice(1).map(function (r, i) {
      return {
        rowIndex: i + 2,
        type: String(r[0] || '').trim(),
        value: String(r[1] || '').trim(),
        parent: String(r[2] || '').trim(),
        active: r[3]
      };
    }).filter(function (r) { return r.type && r.value; });

    panel.innerHTML =
      '<div class="card cfg-bar">' +
        '<div class="hint">แก้ค่าใน Google Sheet โดยตรงแล้วยังไม่เห็นการเปลี่ยน? ระบบพักค่าไว้ชั่วคราวเพื่อความเร็ว การกด F5 เฉยๆ จะยังเห็นค่าเดิม</div>' +
        '<button class="btn small ghost" id="cfgReload">🔄 โหลดค่าใหม่จากชีต</button>' +
      '</div>' +
      machineTreeHtml() + optionsHtml() + settingsHtml() + rawTableHtml();

    wireConfig(panel);
  }

  function wireConfig(panel) {
    document.getElementById('cfgReload').onclick = async function () {
      API.clearConfigCache();
      await renderConfig();
      U.toast('โหลดค่าใหม่จากชีตแล้ว', 'success');
    };

    // Inline "+ เพิ่ม" controls.
    panel.querySelectorAll('.cfg-add').forEach(function (box) {
      var form = box.querySelector('.cfg-add-form');
      var openBtn = box.querySelector('[data-add-open]');
      var input = box.querySelector('input');

      function close() { form.hidden = true; openBtn.hidden = false; input.value = ''; }
      openBtn.onclick = function () {
        openBtn.hidden = true; form.hidden = false; input.focus();
      };
      box.querySelector('[data-add-cancel]').onclick = close;
      box.querySelector('[data-add-ok]').onclick = async function () {
        var value = input.value.trim();
        if (!value) return U.toast('กรอกชื่อก่อน', 'error');
        await mutate('CONFIG', 'create', {
          type: box.getAttribute('data-add-type'),
          value: value,
          parent: box.getAttribute('data-add-parent')
        });
        renderConfig();
      };
      input.onkeydown = function (e) {
        if (e.key === 'Enter') box.querySelector('[data-add-ok]').click();
        if (e.key === 'Escape') close();
      };
    });

    // Rename — rare enough that a prompt beats an inline editor everywhere.
    panel.querySelectorAll('[data-ren]').forEach(function (b) {
      b.onclick = async function () {
        var node = cfgRows.filter(function (r) { return r.rowIndex === Number(b.getAttribute('data-ren')); })[0];
        if (!node) return;
        var name = prompt('เปลี่ยนชื่อ "' + node.value + '" เป็น:', node.value);
        if (name === null) return;
        name = name.trim();
        if (!name || name === node.value) return;

        // Children point at their parent BY NAME, so a rename has to carry
        // them along or they're orphaned the moment it saves.
        var kids = cfgChildren(node);
        if (kids.length && !confirm('จะเปลี่ยนชื่อให้ "' + node.value + '" และย้าย ' + kids.length +
            ' รายการที่อยู่ข้างใต้มาตามด้วย ดำเนินการต่อ?')) return;

        await mutate('CONFIG', 'update', {
          rowIndex: node.rowIndex, type: node.type, value: name, parent: node.parent, active: true
        }, { silent: true });
        for (var i = 0; i < kids.length; i++) {
          await mutate('CONFIG', 'update', {
            rowIndex: kids[i].rowIndex, type: kids[i].type, value: kids[i].value, parent: name, active: true
          }, { silent: true });
        }
        U.toast('เปลี่ยนชื่อแล้ว', 'success');
        renderConfig();
      };
    });

    // Delete — cascades, because a child left behind points at a name that no
    // longer exists and simply stops appearing anywhere.
    panel.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = async function () {
        var node = cfgRows.filter(function (r) { return r.rowIndex === Number(b.getAttribute('data-del')); })[0];
        if (!node) return;
        var doomed = cfgWithDescendants(node);
        var msg = doomed.length > 1
          ? 'ลบ "' + node.value + '" พร้อมรายการข้างใต้อีก ' + (doomed.length - 1) + ' รายการ?\n\n' +
            doomed.slice(1).map(function (d) { return '• ' + d.value; }).join('\n')
          : 'ลบ "' + node.value + '"?';
        if (!confirm(msg)) return;

        // Highest row first: deleting a row shifts everything below it up, so
        // descending order keeps the remaining row numbers valid.
        doomed.sort(function (x, y) { return y.rowIndex - x.rowIndex; });
        for (var i = 0; i < doomed.length; i++) {
          await mutate('CONFIG', 'delete', { rowIndex: doomed[i].rowIndex }, { silent: true });
        }
        U.toast('ลบแล้ว ' + doomed.length + ' รายการ', 'success');
        renderConfig();
      };
    });

    panel.querySelectorAll('[data-set-save]').forEach(function (b) {
      b.onclick = async function () {
        var rowIndex = Number(b.getAttribute('data-set-save'));
        var input = panel.querySelector('[data-set-row="' + rowIndex + '"]');
        await mutate('CONFIG', 'update', {
          rowIndex: rowIndex, type: 'Setting',
          value: input.value.trim(), parent: input.getAttribute('data-set-key'), active: true
        });
        renderConfig();
      };
    });
  }

  // ---- PM_MASTER ----
  var pmEditId = null;
  var pmEditLastDone = ''; // preserved across edits — the modal has no field for it
  var pmEditOriginalStation = ''; // the station this row was assigned to when the modal opened
  var pmPhotoBase64 = null; // newly-picked reference photo, pending upload
  var pmExistingPhotoUrl = ''; // round-tripped on edit when no new photo is picked
  var FREQ_LABELS = {
    Weekly: 'รายสัปดาห์ (Weekly)', Monthly: 'รายเดือน (Monthly)', Quarterly: 'ราย 3 เดือน (Quarterly)',
    HalfYear: 'ราย 6 เดือน (HalfYear)', Yearly: 'รายปี (Yearly)'
  };

  async function renderPM() {
    var panel = document.getElementById('panel');
    panel.innerHTML = '<div class="empty">กำลังโหลด...</div>';
    var list, cfg;
    try {
      list = await API.call('adminCRUD', { entity: 'PM_MASTER', op: 'list' });
      cfg = await API.getConfig();
    } catch (e) {
      panel.innerHTML = '<div class="empty">โหลดไม่สำเร็จ: ' + esc(e.message) + '</div>';
      return;
    }
    // Every machine in the system, flat stations and grouped machines alike,
    // so PM plans can be written against a new area without a second picker.
    var stations = cfg.AllMachines || cfg.Station || [];
    var lineOpts = (cfg.Line || []).map(function (l) { return '<option>' + esc(l) + '</option>'; }).join('');
    var freqOpts = Object.keys(FREQ_LABELS).map(function (f) {
      return '<option value="' + f + '">' + FREQ_LABELS[f] + '</option>';
    }).join('');

    var filterLineOpts = '<option value="">ทุกไลน์</option>' + lineOpts;
    var filterStationOpts = '<option value="">ทุกเครื่องจักร</option>' +
      stations.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('');

    var html = '<div class="card">' +
      '<div class="card-head"><span class="ch-icon">🗓️</span><div><div class="ch-title">แผนบำรุงรักษาเชิงป้องกัน (PM)</div>' +
        '<div class="ch-sub">เลือกเครื่องจักรได้หลายเครื่องพร้อมกัน ทั้งตอนเพิ่มและแก้ไขแผน</div></div></div>' +
      '<button class="btn small" id="pmAddBtn">+ เพิ่มแผน PM</button></div>';
    html += '<div class="filters">' +
      '<select id="pmFilterLine">' + filterLineOpts + '</select>' +
      '<select id="pmFilterStation">' + filterStationOpts + '</select>' +
      '</div>';
    html += '<div class="card table-wrap" id="pmTableWrap"></div>';
    panel.innerHTML = html;

    function renderTable() {
      var fLine = document.getElementById('pmFilterLine').value;
      var fStation = document.getElementById('pmFilterStation').value;
      var filtered = list.filter(function (p) {
        return (!fLine || p.line === fLine) && (!fStation || p.mcStation === fStation);
      });

      var tableHtml = '<table><thead><tr><th>PM_ID</th><th>Item</th><th>Line</th><th>Station</th><th>ความถี่</th><th>ครบกำหนด</th><th></th></tr></thead><tbody>';
      if (!filtered.length) {
        tableHtml += '<tr><td colspan="7" class="empty">ไม่มีแผน PM ตรงตัวกรองที่เลือก</td></tr>';
      }
      filtered.forEach(function (p) {
        tableHtml += '<tr><td>' + esc(p.pmId) + '</td><td>' + esc(p.pmItem) + '</td><td>' + esc(p.line) + '</td><td>' + esc(p.mcStation) +
          '</td><td>' + esc(FREQ_LABELS[p.frequency] || p.frequency) + '</td><td>' + U.thaiDate(p.nextDue) + '</td>' +
          '<td class="btn-group">' +
            '<button class="btn small ghost" data-edit="' + esc(p.pmId) + '">แก้ไข</button>' +
            '<button class="btn small danger" data-del="' + esc(p.pmId) + '">ลบ</button>' +
          '</td></tr>';
      });
      tableHtml += '</tbody></table>';
      var tableWrap = document.getElementById('pmTableWrap');
      tableWrap.innerHTML = tableHtml;

      tableWrap.querySelectorAll('[data-edit]').forEach(function (b) {
        b.onclick = function () {
          var p = list.filter(function (x) { return x.pmId === b.getAttribute('data-edit'); })[0];
          if (p) openEditModal(p);
        };
      });
      tableWrap.querySelectorAll('[data-del]').forEach(function (b) {
        b.onclick = async function () {
          if (!confirm('ลบแผน PM นี้?')) return;
          await mutate('PM_MASTER', 'delete', { pmId: b.getAttribute('data-del') });
          renderPM();
        };
      });
    }

    document.getElementById('pmFilterLine').onchange = renderTable;
    document.getElementById('pmFilterStation').onchange = renderTable;
    renderTable();

    // ---- shared Add/Edit PM modal (markup lives once in admin.html) ----
    var modal = document.getElementById('pmModal');
    document.getElementById('pmLine').innerHTML = lineOpts;
    document.getElementById('pmFreq').innerHTML = freqOpts;

    /** Show only the machines that belong to the line being planned for.
     * The grid used to list every machine in the plant at once, which both
     * hid machines that only exist as a ไลน์/เครื่องหลัก (GV.2) and let a plan
     * pair a line with a machine from a different area. Ticks already made
     * are preserved so switching lines by accident doesn't wipe the form. */
    function renderStationGrid() {
      var grid = document.getElementById('pmStationGrid');
      var checked = {};
      grid.querySelectorAll('input[type=checkbox]:checked').forEach(function (c) { checked[c.value] = true; });

      var line = document.getElementById('pmLine').value;
      var area = (cfg.AreaOfLine || {})[line] || cfg.DefaultArea;
      var list = U.machinesFor(cfg, area, line);
      if (!list.length) list = stations; // no line picked yet — show everything

      grid.innerHTML = list.map(function (s) {
        return '<label><input type="checkbox" value="' + esc(s) + '"' +
          (checked[s] ? ' checked' : '') + '> ' + esc(s) + '</label>';
      }).join('');
    }
    renderStationGrid();
    document.getElementById('pmLine').addEventListener('change', renderStationGrid);

    function closeModal() { modal.classList.remove('show'); }

    /** The current station's checkbox might not exist in the grid — either
     * it predates the CONFIG list, or it's free text from before this UI
     * existed. Add it on the fly so editing never loses/hides it. */
    function ensureStationOption(station) {
      if (!station) return;
      var grid = document.getElementById('pmStationGrid');
      var exists = Array.prototype.some.call(grid.querySelectorAll('input[type=checkbox]'), function (c) { return c.value === station; });
      if (!exists) {
        grid.insertAdjacentHTML('afterbegin', '<label><input type="checkbox" value="' + esc(station) + '"> ' + esc(station) + '</label>');
      }
    }

    function openAddModal() {
      pmEditId = null; pmEditLastDone = ''; pmEditOriginalStation = ''; pmPhotoBase64 = null; pmExistingPhotoUrl = '';
      document.getElementById('pmModalTitle').textContent = 'เพิ่มแผนซ่อมบำรุง (PM)';
      // Line first — the machine grid is built from whatever it holds.
      document.getElementById('pmLine').selectedIndex = 0;
      document.getElementById('pmStationGrid').querySelectorAll('input[type=checkbox]').forEach(function (c) { c.checked = false; });
      renderStationGrid();
      document.getElementById('pmFreq').value = 'Monthly';
      document.getElementById('pmItem').value = '';
      document.getElementById('pmNext').value = '';
      document.getElementById('pmAssign').value = '';
      document.getElementById('pmStd').value = '';
      document.getElementById('pmNotes').value = '';
      document.getElementById('pmRefPhoto').value = '';
      document.getElementById('pmRefPhotoPreview').classList.remove('show');
      document.getElementById('pmModalSave').textContent = 'บันทึกแผน';
      modal.classList.add('show');
    }

    function openEditModal(p) {
      pmEditId = p.pmId;
      pmEditLastDone = p.lastDone ? p.lastDone.substring(0, 10) : '';
      pmEditOriginalStation = p.mcStation || '';
      pmPhotoBase64 = null; pmExistingPhotoUrl = p.photoUrl || '';
      document.getElementById('pmModalTitle').textContent = 'แก้ไขแผน PM (' + p.pmId + ')';
      // Line first, then rebuild the grid for it, then tick this plan's
      // machine — its checkbox doesn't exist until the grid matches the line.
      document.getElementById('pmLine').value = p.line || '';
      document.getElementById('pmStationGrid').querySelectorAll('input[type=checkbox]').forEach(function (c) { c.checked = false; });
      renderStationGrid();
      ensureStationOption(p.mcStation);
      var current = document.getElementById('pmStationGrid').querySelector('input[value="' + CSS.escape(p.mcStation || '') + '"]');
      if (current) current.checked = true;
      document.getElementById('pmFreq').value = p.frequency || 'Monthly';
      document.getElementById('pmItem').value = p.pmItem || '';
      document.getElementById('pmNext').value = p.nextDue ? p.nextDue.substring(0, 10) : '';
      document.getElementById('pmAssign').value = p.assignedTo || '';
      document.getElementById('pmStd').value = p.standard || '';
      document.getElementById('pmNotes').value = p.notes || '';
      document.getElementById('pmRefPhoto').value = '';
      var prev = document.getElementById('pmRefPhotoPreview');
      if (pmExistingPhotoUrl) { prev.src = pmExistingPhotoUrl; prev.classList.add('show'); }
      else prev.classList.remove('show');
      document.getElementById('pmModalSave').textContent = 'บันทึกการแก้ไข';
      modal.classList.add('show');
    }

    document.getElementById('pmAddBtn').onclick = openAddModal;
    document.getElementById('pmModalCancel').onclick = closeModal;
    document.getElementById('pmModalXBtn').onclick = closeModal;
    document.getElementById('pmToggleAll').onclick = function () {
      var boxes = document.getElementById('pmStationGrid').querySelectorAll('input[type=checkbox]');
      var anyUnchecked = Array.prototype.some.call(boxes, function (c) { return !c.checked; });
      boxes.forEach(function (c) { c.checked = anyUnchecked; });
    };
    document.getElementById('pmRefPhoto').onchange = async function (e) {
      var f = e.target.files[0]; if (!f) { pmPhotoBase64 = null; return; }
      pmPhotoBase64 = await U.compressImage(f, 1280);
      var prev = document.getElementById('pmRefPhotoPreview'); prev.src = pmPhotoBase64; prev.classList.add('show');
    };

    document.getElementById('pmModalSave').onclick = async function () {
      var item = document.getElementById('pmItem').value.trim();
      if (!item) return U.toast('กรอกชื่องาน / รายการที่ต้องทำ', 'error');
      var picked = Array.prototype.filter.call(
        document.getElementById('pmStationGrid').querySelectorAll('input[type=checkbox]'),
        function (c) { return c.checked; }
      ).map(function (c) { return c.value; });
      if (!picked.length) return U.toast('เลือกเครื่องจักรอย่างน้อย 1 เครื่อง', 'error');

      var base = {
        pmItem: item, line: document.getElementById('pmLine').value,
        standard: document.getElementById('pmStd').value.trim(),
        notes: document.getElementById('pmNotes').value.trim(),
        frequency: document.getElementById('pmFreq').value,
        nextDue: document.getElementById('pmNext').value,
        assignedTo: document.getElementById('pmAssign').value.trim(), active: true
      };
      var btn = document.getElementById('pmModalSave');
      btn.disabled = true;
      try {
        // Reference photo is uploaded once (on the first row touched) and
        // reused across the rest of the batch, instead of re-uploading the
        // same image to Drive once per selected machine.
        var sharedPhotoUrl = pmPhotoBase64 ? '' : pmExistingPhotoUrl;
        var extraCreated = 0;

        if (pmEditId) {
          // Editing: the row being edited keeps whichever of its currently
          // checked station is still its own (or moves to the first checked
          // one if that station got unchecked); any OTHER checked stations
          // are new plans, created alongside it.
          var keepStation = picked.indexOf(pmEditOriginalStation) >= 0 ? pmEditOriginalStation : picked[0];
          var updateData = Object.assign({}, base, { pmId: pmEditId, mcStation: keepStation, lastDone: pmEditLastDone });
          if (pmPhotoBase64) updateData.photoBase64 = pmPhotoBase64;
          else updateData.photoUrl = pmExistingPhotoUrl;
          var updRes = await mutate('PM_MASTER', 'update', updateData, { silent: picked.length > 1 });
          if (!sharedPhotoUrl && updRes && updRes.photoUrl) sharedPhotoUrl = updRes.photoUrl;

          var others = picked.filter(function (s) { return s !== keepStation; });
          for (var j = 0; j < others.length; j++) {
            var extraData = Object.assign({}, base, { mcStation: others[j] });
            if (sharedPhotoUrl) extraData.photoUrl = sharedPhotoUrl;
            var extraRes = await mutate('PM_MASTER', 'create', extraData, { silent: true });
            if (!sharedPhotoUrl && extraRes && extraRes.photoUrl) sharedPhotoUrl = extraRes.photoUrl;
          }
          extraCreated = others.length;
          if (extraCreated) U.toast('บันทึกแผนสำเร็จ + เพิ่มเครื่องใหม่อีก ' + extraCreated + ' เครื่อง', 'success');
        } else {
          for (var i = 0; i < picked.length; i++) {
            var rowData = Object.assign({}, base, { mcStation: picked[i] });
            if (i === 0 && pmPhotoBase64) rowData.photoBase64 = pmPhotoBase64;
            else if (sharedPhotoUrl) rowData.photoUrl = sharedPhotoUrl;
            var res = await mutate('PM_MASTER', 'create', rowData, { silent: true });
            if (!sharedPhotoUrl && res && res.photoUrl) sharedPhotoUrl = res.photoUrl;
          }
          U.toast('เพิ่มแผน PM สำเร็จ ' + picked.length + ' เครื่อง', 'success');
        }
        closeModal();
        renderPM();
      } finally {
        btn.disabled = false;
      }
    };
  }

  // ---- USERS ----
  var userEditId = null;
  var userEditLine = ''; // Line is no longer edited in the UI — round-trip it unchanged

  async function renderUsers() {
    var panel = document.getElementById('panel');
    panel.innerHTML = '<div class="empty">กำลังโหลด...</div>';
    var list;
    try {
      list = await API.call('adminCRUD', { entity: 'USERS', op: 'list' });
    } catch (e) {
      panel.innerHTML = '<div class="empty">โหลดไม่สำเร็จ: ' + esc(e.message) + '</div>';
      return;
    }
    userEditId = null;
    // Real roles used in the sheet. Grouping (auth.js roleGroup): anything
    // with "Technician" = ช่าง/ผู้ซ่อม, "Leader" (no Technician) = หัวหน้ากะ.
    var roleOpts = ['Admin', 'Leader A', 'Leader B', 'Leader Technician A', 'Leader Technician B', 'Technician']
      .map(function (r) { return '<option>' + r + '</option>'; }).join('');

    var html = '<div class="card">' +
      '<div class="card-head"><span class="ch-icon">👤</span><div><div class="ch-title" id="uFormTitle">เพิ่มผู้ใช้</div>' +
        '<div class="ch-sub">รายชื่อผู้ใช้และสิทธิ์การเข้าถึงระบบ</div></div></div>' +
      '<div class="row"><input id="uEmp" placeholder="Emp_ID"><input id="uName" placeholder="ชื่อ"></div>' +
      '<div class="row" style="margin-top:12px"><select id="uRole">' + roleOpts + '</select>' +
        '<select id="uShift"><option value="">— เลือกกะ —</option><option value="A">กะ A</option><option value="B">กะ B</option></select>' +
        '<input id="uPin" placeholder="PIN 4 หลัก" maxlength="4"></div>' +
      '<div class="hint">ต้องกรอก PIN ทุกครั้งที่บันทึก แม้ตอนแก้ไขข้อมูลอื่นที่ไม่ใช่ PIN</div>' +
      '<div class="btn-group" style="margin-top:12px"><button class="btn small" id="uSave">เพิ่มผู้ใช้</button>' +
      '<button class="btn small ghost" id="uCancel" style="display:none">ยกเลิกแก้ไข</button></div></div>';
    html += '<div class="card table-wrap"><table><thead><tr><th>Emp_ID</th><th>ชื่อ</th><th>Role</th><th>กะ</th><th></th></tr></thead><tbody>';
    list.forEach(function (u) {
      html += '<tr><td>' + esc(u.empId) + '</td><td>' + esc(u.name) + '</td><td>' + esc(u.role) + '</td><td>' + esc(u.shift || '-') +
        '</td><td class="btn-group">' +
          '<button class="btn small ghost" data-edit="' + esc(u.empId) + '">แก้ไข</button>' +
          '<button class="btn small danger" data-del="' + esc(u.empId) + '">ลบ</button>' +
        '</td></tr>';
    });
    html += '</tbody></table></div>';
    panel.innerHTML = html;

    function resetUserForm() {
      userEditId = null;
      userEditLine = '';
      document.getElementById('uFormTitle').textContent = 'เพิ่มผู้ใช้';
      document.getElementById('uEmp').value = '';
      document.getElementById('uEmp').disabled = false;
      document.getElementById('uName').value = '';
      document.getElementById('uShift').value = '';
      document.getElementById('uPin').value = '';
      document.getElementById('uSave').textContent = 'เพิ่มผู้ใช้';
      document.getElementById('uCancel').style.display = 'none';
    }

    document.getElementById('uSave').onclick = async function () {
      var emp = document.getElementById('uEmp').value.trim();
      var pin = document.getElementById('uPin').value.trim();
      if (!emp || pin.length < 4) return U.toast('กรอก Emp_ID และ PIN 4 หลัก', 'error');
      var data = {
        empId: emp, name: document.getElementById('uName').value.trim(),
        role: document.getElementById('uRole').value,
        shift: document.getElementById('uShift').value,
        line: userEditId ? userEditLine : '', // preserved on edit, blank on create
        pin: pin
      };
      if (userEditId) await mutate('USERS', 'update', data);
      else await mutate('USERS', 'create', data);
      renderUsers();
    };
    document.getElementById('uCancel').onclick = resetUserForm;
    panel.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-edit');
        var u = list.filter(function (x) { return x.empId === id; })[0];
        if (!u) return;
        userEditId = id;
        userEditLine = u.line || '';
        document.getElementById('uFormTitle').textContent = 'แก้ไขผู้ใช้ (' + id + ')';
        document.getElementById('uEmp').value = u.empId || '';
        document.getElementById('uEmp').disabled = true; // Emp_ID is the lookup key — don't let it drift out of sync
        document.getElementById('uName').value = u.name || '';
        document.getElementById('uRole').value = u.role || '';
        document.getElementById('uShift').value = u.shift || '';
        document.getElementById('uPin').value = '';
        document.getElementById('uSave').textContent = 'บันทึกการแก้ไข';
        document.getElementById('uCancel').style.display = '';
        document.getElementById('uName').scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    });
    panel.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = async function () {
        if (!confirm('ลบผู้ใช้นี้?')) return;
        await mutate('USERS', 'delete', { empId: b.getAttribute('data-del') });
        renderUsers();
      };
    });
  }

  async function mutate(entity, op, data, opts) {
    opts = opts || {};
    var overlay = document.getElementById('overlay');
    overlay.classList.add('show');
    try {
      var res = await API.call('adminCRUD', { entity: entity, op: op, data: data });
      // Editing CONFIG changes what every dropdown in the app offers — drop
      // the cached copy so the change is visible on the next page, not in
      // ten minutes' time.
      if (entity === 'CONFIG') API.clearConfigCache();
      if (!opts.silent) U.toast('บันทึกสำเร็จ', 'success');
      return res;
    } catch (e) {
      U.toast('ไม่สำเร็จ: ' + e.message, 'error');
      throw e;
    } finally {
      overlay.classList.remove('show');
    }
  }

  function show(tab) {
    current = tab;
    document.querySelectorAll('.tabs [data-tab]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
    if (tab === 'config') renderConfig();
    else if (tab === 'pm') renderPM();
    else renderUsers();
  }

  function init() {
    Auth.renderUserBadge('userBadge');
    if (Auth.myGroup() !== 'admin') {
      document.getElementById('denied').style.display = 'block';
      return;
    }
    document.getElementById('adminBody').style.display = 'block';
    document.querySelectorAll('.tabs [data-tab]').forEach(function (b) {
      b.onclick = function () { show(b.getAttribute('data-tab')); };
    });
    show('config');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
