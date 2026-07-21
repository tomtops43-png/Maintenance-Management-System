/* admin.html — CRUD for CONFIG / PM_MASTER / USERS (Supervisor/Manager only) */
(function () {
  var current = 'config';

  function esc(s) { return U.escapeHtml(s); }

  // ---- CONFIG ----
  async function renderConfig() {
    var panel = document.getElementById('panel');
    panel.innerHTML = '<div class="empty">กำลังโหลด...</div>';
    var rows = await API.call('adminCRUD', { entity: 'CONFIG', op: 'list' });
    var html = '<div class="card"><b>เพิ่มค่าใหม่</b>' +
      '<div class="row" style="margin-top:8px">' +
        '<input id="cfgType" placeholder="Type (Line/Station/Issue...)">' +
        '<input id="cfgValue" placeholder="Value">' +
        '<input id="cfgParent" placeholder="Parent (สำหรับ Issue)">' +
      '</div>' +
      '<button class="btn small" id="cfgAdd" style="margin-top:8px">เพิ่ม</button></div>';
    html += '<div class="card table-wrap"><table><thead><tr><th>Type</th><th>Value</th><th>Parent</th><th>Active</th><th></th></tr></thead><tbody>';
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      html += '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td><td>' + esc(r[2]) + '</td><td>' + esc(r[3]) +
        '</td><td><button class="btn small danger" data-del="' + (i + 1) + '">ลบ</button></td></tr>';
    }
    html += '</tbody></table></div>';
    panel.innerHTML = html;

    document.getElementById('cfgAdd').onclick = async function () {
      var type = document.getElementById('cfgType').value.trim();
      var value = document.getElementById('cfgValue').value.trim();
      if (!type || !value) return U.toast('กรอก Type และ Value', 'error');
      await mutate('CONFIG', 'create', { type: type, value: value, parent: document.getElementById('cfgParent').value.trim() });
      renderConfig();
    };
    panel.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = async function () {
        if (!confirm('ลบรายการนี้?')) return;
        await mutate('CONFIG', 'delete', { rowIndex: Number(b.getAttribute('data-del')) });
        renderConfig();
      };
    });
  }

  // ---- PM_MASTER ----
  async function renderPM() {
    var panel = document.getElementById('panel');
    panel.innerHTML = '<div class="empty">กำลังโหลด...</div>';
    var list = await API.call('adminCRUD', { entity: 'PM_MASTER', op: 'list' });
    var cfg = await API.getConfig();
    var lineOpts = (cfg.Line || []).map(function (l) { return '<option>' + esc(l) + '</option>'; }).join('');
    var freqOpts = ['Weekly', 'Monthly', 'Quarterly', 'HalfYear', 'Yearly'].map(function (f) { return '<option>' + f + '</option>'; }).join('');

    var html = '<div class="card"><b>เพิ่มแผน PM</b>' +
      '<div class="field"><label>รายการตรวจ (PM_Item)</label><input id="pmItem"></div>' +
      '<div class="row"><div class="field"><label>Line</label><select id="pmLine">' + lineOpts + '</select></div>' +
      '<div class="field"><label>M/C / Station</label><input id="pmStation"></div></div>' +
      '<div class="field"><label>เกณฑ์ (Standard)</label><input id="pmStd"></div>' +
      '<div class="row"><div class="field"><label>ความถี่</label><select id="pmFreq">' + freqOpts + '</select></div>' +
      '<div class="field"><label>ครบกำหนดครั้งแรก</label><input type="date" id="pmNext"></div></div>' +
      '<div class="field"><label>ผู้รับผิดชอบ</label><input id="pmAssign"></div>' +
      '<button class="btn small" id="pmAdd">เพิ่มแผน PM</button></div>';

    html += '<div class="card table-wrap"><table><thead><tr><th>PM_ID</th><th>Item</th><th>Line</th><th>Station</th><th>ความถี่</th><th>ครบกำหนด</th><th></th></tr></thead><tbody>';
    list.forEach(function (p) {
      html += '<tr><td>' + esc(p.pmId) + '</td><td>' + esc(p.pmItem) + '</td><td>' + esc(p.line) + '</td><td>' + esc(p.mcStation) +
        '</td><td>' + esc(p.frequency) + '</td><td>' + U.thaiDate(p.nextDue) + '</td>' +
        '<td><button class="btn small danger" data-del="' + esc(p.pmId) + '">ลบ</button></td></tr>';
    });
    html += '</tbody></table></div>';
    panel.innerHTML = html;

    document.getElementById('pmAdd').onclick = async function () {
      var item = document.getElementById('pmItem').value.trim();
      if (!item) return U.toast('กรอกรายการตรวจ', 'error');
      await mutate('PM_MASTER', 'create', {
        pmItem: item, line: document.getElementById('pmLine').value,
        mcStation: document.getElementById('pmStation').value.trim(),
        standard: document.getElementById('pmStd').value.trim(),
        frequency: document.getElementById('pmFreq').value,
        nextDue: document.getElementById('pmNext').value,
        assignedTo: document.getElementById('pmAssign').value.trim(), active: true
      });
      renderPM();
    };
    panel.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = async function () {
        if (!confirm('ลบแผน PM นี้?')) return;
        await mutate('PM_MASTER', 'delete', { pmId: b.getAttribute('data-del') });
        renderPM();
      };
    });
  }

  // ---- USERS ----
  async function renderUsers() {
    var panel = document.getElementById('panel');
    panel.innerHTML = '<div class="empty">กำลังโหลด...</div>';
    var list = await API.call('adminCRUD', { entity: 'USERS', op: 'list' });
    var roleOpts = ['Operator', 'Technician', 'Engineer', 'Supervisor', 'Manager'].map(function (r) { return '<option>' + r + '</option>'; }).join('');

    var html = '<div class="card"><b>เพิ่มผู้ใช้</b>' +
      '<div class="row"><input id="uEmp" placeholder="Emp_ID"><input id="uName" placeholder="ชื่อ"></div>' +
      '<div class="row" style="margin-top:8px"><select id="uRole">' + roleOpts + '</select><input id="uLine" placeholder="Line"><input id="uPin" placeholder="PIN 4 หลัก" maxlength="4"></div>' +
      '<button class="btn small" id="uAdd" style="margin-top:8px">เพิ่มผู้ใช้</button></div>';
    html += '<div class="card table-wrap"><table><thead><tr><th>Emp_ID</th><th>ชื่อ</th><th>Role</th><th>Line</th><th></th></tr></thead><tbody>';
    list.forEach(function (u) {
      html += '<tr><td>' + esc(u.empId) + '</td><td>' + esc(u.name) + '</td><td>' + esc(u.role) + '</td><td>' + esc(u.line) +
        '</td><td><button class="btn small danger" data-del="' + esc(u.empId) + '">ลบ</button></td></tr>';
    });
    html += '</tbody></table></div>';
    panel.innerHTML = html;

    document.getElementById('uAdd').onclick = async function () {
      var emp = document.getElementById('uEmp').value.trim();
      var pin = document.getElementById('uPin').value.trim();
      if (!emp || pin.length < 4) return U.toast('กรอก Emp_ID และ PIN 4 หลัก', 'error');
      await mutate('USERS', 'create', {
        empId: emp, name: document.getElementById('uName').value.trim(),
        role: document.getElementById('uRole').value, line: document.getElementById('uLine').value.trim(), pin: pin
      });
      renderUsers();
    };
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
