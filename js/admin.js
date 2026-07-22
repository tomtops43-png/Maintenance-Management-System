/* admin.html — CRUD for CONFIG / PM_MASTER / USERS (Supervisor/Manager only) */
(function () {
  var current = 'config';

  function esc(s) { return U.escapeHtml(s); }

  // ---- CONFIG ----
  var cfgEditRow = null; // rowIndex currently being edited, or null

  async function renderConfig() {
    var panel = document.getElementById('panel');
    panel.innerHTML = '<div class="empty">กำลังโหลด...</div>';
    var rows = await API.call('adminCRUD', { entity: 'CONFIG', op: 'list' });
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
  var pmEditLastDone = ''; // preserved across edits — the form has no field for it

  async function renderPM() {
    var panel = document.getElementById('panel');
    panel.innerHTML = '<div class="empty">กำลังโหลด...</div>';
    var list = await API.call('adminCRUD', { entity: 'PM_MASTER', op: 'list' });
    var cfg = await API.getConfig();
    pmEditId = null;
    var lineOpts = (cfg.Line || []).map(function (l) { return '<option>' + esc(l) + '</option>'; }).join('');
    var freqOpts = ['Weekly', 'Monthly', 'Quarterly', 'HalfYear', 'Yearly'].map(function (f) { return '<option>' + f + '</option>'; }).join('');

    var html = '<div class="card">' +
      '<div class="card-head"><span class="ch-icon">🗓️</span><div><div class="ch-title" id="pmFormTitle">เพิ่มแผน PM</div>' +
        '<div class="ch-sub">แผนบำรุงรักษาเชิงป้องกันตามความถี่ที่กำหนด</div></div></div>' +
      '<div class="field"><label>รายการตรวจ (PM_Item)</label><input id="pmItem"></div>' +
      '<div class="row"><div class="field"><label>Line</label><select id="pmLine">' + lineOpts + '</select></div>' +
      '<div class="field"><label>M/C / Station</label><input id="pmStation"></div></div>' +
      '<div class="field"><label>เกณฑ์ (Standard)</label><input id="pmStd"></div>' +
      '<div class="row"><div class="field"><label>ความถี่</label><select id="pmFreq">' + freqOpts + '</select></div>' +
      '<div class="field"><label>ครบกำหนดครั้งถัดไป</label><input type="date" id="pmNext"></div></div>' +
      '<div class="field"><label>ผู้รับผิดชอบ</label><input id="pmAssign"></div>' +
      '<div class="btn-group"><button class="btn small" id="pmSave">เพิ่มแผน PM</button>' +
      '<button class="btn small ghost" id="pmCancel" style="display:none">ยกเลิกแก้ไข</button></div></div>';

    html += '<div class="card table-wrap"><table><thead><tr><th>PM_ID</th><th>Item</th><th>Line</th><th>Station</th><th>ความถี่</th><th>ครบกำหนด</th><th></th></tr></thead><tbody>';
    list.forEach(function (p) {
      html += '<tr><td>' + esc(p.pmId) + '</td><td>' + esc(p.pmItem) + '</td><td>' + esc(p.line) + '</td><td>' + esc(p.mcStation) +
        '</td><td>' + esc(p.frequency) + '</td><td>' + U.thaiDate(p.nextDue) + '</td>' +
        '<td class="btn-group">' +
          '<button class="btn small ghost" data-edit="' + esc(p.pmId) + '">แก้ไข</button>' +
          '<button class="btn small danger" data-del="' + esc(p.pmId) + '">ลบ</button>' +
        '</td></tr>';
    });
    html += '</tbody></table></div>';
    panel.innerHTML = html;

    function resetPmForm() {
      pmEditId = null;
      pmEditLastDone = '';
      document.getElementById('pmFormTitle').textContent = 'เพิ่มแผน PM';
      document.getElementById('pmItem').value = '';
      document.getElementById('pmStation').value = '';
      document.getElementById('pmStd').value = '';
      document.getElementById('pmNext').value = '';
      document.getElementById('pmAssign').value = '';
      document.getElementById('pmSave').textContent = 'เพิ่มแผน PM';
      document.getElementById('pmCancel').style.display = 'none';
    }

    document.getElementById('pmSave').onclick = async function () {
      var item = document.getElementById('pmItem').value.trim();
      if (!item) return U.toast('กรอกรายการตรวจ', 'error');
      var data = {
        pmItem: item, line: document.getElementById('pmLine').value,
        mcStation: document.getElementById('pmStation').value.trim(),
        standard: document.getElementById('pmStd').value.trim(),
        frequency: document.getElementById('pmFreq').value,
        nextDue: document.getElementById('pmNext').value,
        assignedTo: document.getElementById('pmAssign').value.trim(), active: true
      };
      if (pmEditId) {
        data.pmId = pmEditId;
        data.lastDone = pmEditLastDone; // round-trip unchanged; form has no field for it
        await mutate('PM_MASTER', 'update', data);
      } else {
        await mutate('PM_MASTER', 'create', data);
      }
      renderPM();
    };
    document.getElementById('pmCancel').onclick = resetPmForm;
    panel.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-edit');
        var p = list.filter(function (x) { return x.pmId === id; })[0];
        if (!p) return;
        pmEditId = id;
        pmEditLastDone = p.lastDone ? p.lastDone.substring(0, 10) : '';
        document.getElementById('pmFormTitle').textContent = 'แก้ไขแผน PM (' + id + ')';
        document.getElementById('pmItem').value = p.pmItem || '';
        document.getElementById('pmLine').value = p.line || '';
        document.getElementById('pmStation').value = p.mcStation || '';
        document.getElementById('pmStd').value = p.standard || '';
        document.getElementById('pmFreq').value = p.frequency || '';
        document.getElementById('pmNext').value = p.nextDue ? p.nextDue.substring(0, 10) : '';
        document.getElementById('pmAssign').value = p.assignedTo || '';
        document.getElementById('pmSave').textContent = 'บันทึกการแก้ไข';
        document.getElementById('pmCancel').style.display = '';
        document.getElementById('pmItem').scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    var list = await API.call('adminCRUD', { entity: 'USERS', op: 'list' });
    userEditId = null;
    var roleOpts = ['Operator', 'Technician', 'Engineer', 'Supervisor', 'Manager'].map(function (r) { return '<option>' + r + '</option>'; }).join('');

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

  async function mutate(entity, op, data) {
    var overlay = document.getElementById('overlay');
    overlay.classList.add('show');
    try {
      await API.call('adminCRUD', { entity: entity, op: op, data: data });
      U.toast('บันทึกสำเร็จ', 'success');
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
    if (!Auth.hasRole(['Supervisor', 'Manager'])) {
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
