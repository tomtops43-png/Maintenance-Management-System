/* admin.html — CRUD for CONFIG / PM_MASTER / USERS (Admin only) */
(function () {
  var current = 'config';

  function esc(s) { return U.escapeHtml(s); }

  // ---- CONFIG ----
  var cfgEditRow = null; // rowIndex currently being edited, or null

  async function renderConfig() {
    var panel = document.getElementById('panel');
    panel.innerHTML = '<div class="empty">กำลังโหลด...</div>';
    var rows;
    try {
      rows = await API.call('adminCRUD', { entity: 'CONFIG', op: 'list' });
    } catch (e) {
      panel.innerHTML = '<div class="empty">โหลดไม่สำเร็จ: ' + esc(e.message) + '</div>';
      return;
    }
    cfgEditRow = null;

    var html = '<div class="card">' +
      '<div class="card-head"><span class="ch-icon">⚙️</span><div><div class="ch-title" id="cfgFormTitle">เพิ่มค่าใหม่</div>' +
        '<div class="ch-sub">ตัวเลือก dropdown ทั้งหมดในระบบมาจากที่นี่</div></div></div>' +
      '<div class="row">' +
        '<input id="cfgType" placeholder="Type (Line/Station/Issue...)">' +
        '<input id="cfgValue" placeholder="Value">' +
        '<input id="cfgParent" placeholder="Parent (สำหรับ Issue)">' +
      '</div>' +
      '<div class="btn-group" style="margin-top:12px">' +
        '<button class="btn small" id="cfgSave">เพิ่ม</button>' +
        '<button class="btn small ghost" id="cfgCancel" style="display:none">ยกเลิกแก้ไข</button>' +
      '</div></div>';
    html += '<div class="card table-wrap"><table><thead><tr><th>Type</th><th>Value</th><th>Parent</th><th>Active</th><th></th></tr></thead><tbody>';
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      html += '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td><td>' + esc(r[2]) + '</td><td>' + esc(r[3]) +
        '</td><td class="btn-group">' +
          '<button class="btn small ghost" data-edit="' + (i + 1) + '">แก้ไข</button>' +
          '<button class="btn small danger" data-del="' + (i + 1) + '">ลบ</button>' +
        '</td></tr>';
    }
    html += '</tbody></table></div>';
    panel.innerHTML = html;

    function resetCfgForm() {
      cfgEditRow = null;
      document.getElementById('cfgFormTitle').textContent = 'เพิ่มค่าใหม่';
      document.getElementById('cfgType').value = '';
      document.getElementById('cfgValue').value = '';
      document.getElementById('cfgParent').value = '';
      document.getElementById('cfgSave').textContent = 'เพิ่ม';
      document.getElementById('cfgCancel').style.display = 'none';
    }

    document.getElementById('cfgSave').onclick = async function () {
      var type = document.getElementById('cfgType').value.trim();
      var value = document.getElementById('cfgValue').value.trim();
      if (!type || !value) return U.toast('กรอก Type และ Value', 'error');
      var parent = document.getElementById('cfgParent').value.trim();
      if (cfgEditRow) {
        await mutate('CONFIG', 'update', { rowIndex: cfgEditRow, type: type, value: value, parent: parent, active: true });
      } else {
        await mutate('CONFIG', 'create', { type: type, value: value, parent: parent });
      }
      renderConfig();
    };
    document.getElementById('cfgCancel').onclick = resetCfgForm;
    panel.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function () {
        var idx = Number(b.getAttribute('data-edit'));
        var r = rows[idx - 1];
        cfgEditRow = idx;
        document.getElementById('cfgFormTitle').textContent = 'แก้ไขค่า (แถวที่ ' + idx + ')';
        document.getElementById('cfgType').value = r[0] || '';
        document.getElementById('cfgValue').value = r[1] || '';
        document.getElementById('cfgParent').value = r[2] || '';
        document.getElementById('cfgSave').textContent = 'บันทึกการแก้ไข';
        document.getElementById('cfgCancel').style.display = '';
        document.getElementById('cfgType').scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    });
    panel.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = async function () {
        if (!confirm('ลบรายการนี้?')) return;
        await mutate('CONFIG', 'delete', { rowIndex: Number(b.getAttribute('data-del')) });
        renderConfig();
      };
    });
  }

  // ---- PM_MASTER ----
  var pmEditId = null;
  var pmEditLastDone = ''; // preserved across edits — the modal has no field for it
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
    var stations = cfg.Station || [];
    var lineOpts = (cfg.Line || []).map(function (l) { return '<option>' + esc(l) + '</option>'; }).join('');
    var freqOpts = Object.keys(FREQ_LABELS).map(function (f) {
      return '<option value="' + f + '">' + FREQ_LABELS[f] + '</option>';
    }).join('');

    var html = '<div class="card">' +
      '<div class="card-head"><span class="ch-icon">🗓️</span><div><div class="ch-title">แผนบำรุงรักษาเชิงป้องกัน (PM)</div>' +
        '<div class="ch-sub">เลือกเครื่องจักรได้หลายเครื่องพร้อมกันตอนเพิ่มแผนใหม่</div></div></div>' +
      '<button class="btn small" id="pmAddBtn">+ เพิ่มแผน PM</button></div>';
    html += '<div class="card table-wrap"><table><thead><tr><th>PM_ID</th><th>Item</th><th>Line</th><th>Station</th><th>ความถี่</th><th>ครบกำหนด</th><th></th></tr></thead><tbody>';
    list.forEach(function (p) {
      html += '<tr><td>' + esc(p.pmId) + '</td><td>' + esc(p.pmItem) + '</td><td>' + esc(p.line) + '</td><td>' + esc(p.mcStation) +
        '</td><td>' + esc(FREQ_LABELS[p.frequency] || p.frequency) + '</td><td>' + U.thaiDate(p.nextDue) + '</td>' +
        '<td class="btn-group">' +
          '<button class="btn small ghost" data-edit="' + esc(p.pmId) + '">แก้ไข</button>' +
          '<button class="btn small danger" data-del="' + esc(p.pmId) + '">ลบ</button>' +
        '</td></tr>';
    });
    html += '</tbody></table></div>';
    panel.innerHTML = html;

    // ---- shared Add/Edit PM modal (markup lives once in admin.html) ----
    var modal = document.getElementById('pmModal');
    document.getElementById('pmLine').innerHTML = lineOpts;
    document.getElementById('pmFreq').innerHTML = freqOpts;
    document.getElementById('pmStationGrid').innerHTML = stations.map(function (s) {
      return '<label><input type="checkbox" value="' + esc(s) + '"> ' + esc(s) + '</label>';
    }).join('');

    function closeModal() { modal.classList.remove('show'); }

    function openAddModal() {
      pmEditId = null; pmEditLastDone = ''; pmPhotoBase64 = null; pmExistingPhotoUrl = '';
      document.getElementById('pmModalTitle').textContent = 'เพิ่มแผนซ่อมบำรุง (PM)';
      document.getElementById('pmStationArea').style.display = '';
      document.getElementById('pmStationFixedArea').style.display = 'none';
      document.getElementById('pmStationGrid').querySelectorAll('input[type=checkbox]').forEach(function (c) { c.checked = false; });
      document.getElementById('pmLine').selectedIndex = 0;
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
      pmPhotoBase64 = null; pmExistingPhotoUrl = p.photoUrl || '';
      document.getElementById('pmModalTitle').textContent = 'แก้ไขแผน PM (' + p.pmId + ')';
      document.getElementById('pmStationArea').style.display = 'none';
      document.getElementById('pmStationFixedArea').style.display = '';
      document.getElementById('pmStationFixed').value = p.mcStation || '';
      document.getElementById('pmLine').value = p.line || '';
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
        if (pmEditId) {
          var data = Object.assign({}, base, {
            pmId: pmEditId, mcStation: document.getElementById('pmStationFixed').value, lastDone: pmEditLastDone
          });
          if (pmPhotoBase64) data.photoBase64 = pmPhotoBase64;
          else data.photoUrl = pmExistingPhotoUrl;
          await mutate('PM_MASTER', 'update', data);
        } else {
          var picked = Array.prototype.filter.call(
            document.getElementById('pmStationGrid').querySelectorAll('input[type=checkbox]'),
            function (c) { return c.checked; }
          ).map(function (c) { return c.value; });
          if (!picked.length) { U.toast('เลือกเครื่องจักรอย่างน้อย 1 เครื่อง', 'error'); return; }

          // Upload the reference photo once (on the first plan) and reuse
          // that URL for the rest of the batch, instead of re-uploading the
          // same image to Drive once per selected machine.
          var sharedPhotoUrl = '';
          for (var i = 0; i < picked.length; i++) {
            var rowData = Object.assign({}, base, { mcStation: picked[i] });
            if (i === 0 && pmPhotoBase64) rowData.photoBase64 = pmPhotoBase64;
            else if (sharedPhotoUrl) rowData.photoUrl = sharedPhotoUrl;
            var res = await mutate('PM_MASTER', 'create', rowData, { silent: true });
            if (i === 0 && res && res.photoUrl) sharedPhotoUrl = res.photoUrl;
          }
          U.toast('เพิ่มแผน PM สำเร็จ ' + picked.length + ' เครื่อง', 'success');
        }
        closeModal();
        renderPM();
      } finally {
        btn.disabled = false;
      }
    };

    panel.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function () {
        var p = list.filter(function (x) { return x.pmId === b.getAttribute('data-edit'); })[0];
        if (p) openEditModal(p);
      };
    });
    panel.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = async function () {
        if (!confirm('ลบแผน PM นี้?')) return;
        await mutate('PM_MASTER', 'delete', { pmId: b.getAttribute('data-del') });
        renderPM();
      };
    });
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
