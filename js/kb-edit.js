/* kb-edit.html[?id=KB-0001] — create/edit a Knowledge Base article (Step 4) */
(function () {
  var CATEGORY_LABELS = {
    Repair_Case: 'เคสซ่อมจริง (Repair Case)', PM_Tips: 'ทริค PM (PM Tips)',
    Safety: 'ความปลอดภัย (Safety)', Machine_Manual: 'คู่มือเครื่องจักร (Machine Manual)',
    Troubleshoot: 'แก้ปัญหาเบื้องต้น (Troubleshoot)'
  };
  var MAIN_ISSUES = ['Mechanical', 'Electrical', 'Software', 'Camera&Vision', 'ทั่วไป'];
  var STOPWORDS = ['ไม่', 'การ', 'ที่', 'เป็น', 'มี', 'ใน', 'จาก', 'ให้', 'ของ', 'หรือ', 'และ',
    'ไป', 'มา', 'ได้', 'ว่า', 'ทำ', 'ต้อง', 'นี้', 'นั้น', 'ก็', 'จะ', 'ซึ่ง', 'อยู่', 'ยัง', 'วิธี', 'ถูกต้อง'];

  var kbId = null;
  var pendingPhotos = [];    // [{ base64 }] newly picked this session, not yet uploaded
  var existingPhotoUrls = []; // already-uploaded URLs kept from an existing article

  /** Naive keyword guesser: Title/Problem text in this app is written with
   * spaces between clauses even in Thai, so splitting on whitespace/
   * punctuation is a reasonable low-tech stand-in for a real tokenizer. */
  function guessKeywords(title, problem) {
    var text = title + ' ' + problem;
    var parts = text.split(/[\s,.\-()\/:;，。！？]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    var seen = {}, out = [];
    parts.forEach(function (p) {
      if (p.length < 2 || STOPWORDS.indexOf(p) >= 0) return;
      var low = p.toLowerCase();
      if (seen[low]) return;
      seen[low] = true;
      out.push(p);
    });
    return out.slice(0, 8);
  }

  function renderKeywordSuggestions() {
    var words = guessKeywords(document.getElementById('kbTitle').value, document.getElementById('kbProblem').value);
    document.getElementById('kbKeywordSuggest').innerHTML = words.map(function (w) {
      return '<button type="button" data-word="' + U.escapeHtml(w) + '">+ ' + U.escapeHtml(w) + '</button>';
    }).join('');
    document.querySelectorAll('#kbKeywordSuggest button').forEach(function (b) {
      b.onclick = function () {
        var el = document.getElementById('kbKeywords');
        var current = el.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        var word = b.getAttribute('data-word');
        if (current.indexOf(word) < 0) current.push(word);
        el.value = current.join(', ');
      };
    });
  }

  function renderPhotoPreview() {
    var el = document.getElementById('kbPhotoPreview');
    var html = '';
    existingPhotoUrls.forEach(function (url, i) {
      html += '<div class="kb-photo-item"><img src="' + U.escapeHtml(url) + '">' +
        '<button type="button" class="kb-photo-remove" data-existing="' + i + '">×</button></div>';
    });
    pendingPhotos.forEach(function (p, i) {
      html += '<div class="kb-photo-item"><img src="' + p.base64 + '">' +
        '<button type="button" class="kb-photo-remove" data-pending="' + i + '">×</button></div>';
    });
    el.innerHTML = html;
    el.querySelectorAll('[data-existing]').forEach(function (b) {
      b.onclick = function () { existingPhotoUrls.splice(Number(b.getAttribute('data-existing')), 1); renderPhotoPreview(); };
    });
    el.querySelectorAll('[data-pending]').forEach(function (b) {
      b.onclick = function () { pendingPhotos.splice(Number(b.getAttribute('data-pending')), 1); renderPhotoPreview(); };
    });
  }

  function fillOptions(selectId, opts, labels) {
    document.getElementById(selectId).innerHTML = opts.map(function (v) {
      return '<option value="' + U.escapeHtml(v) + '">' + U.escapeHtml((labels && labels[v]) || v) + '</option>';
    }).join('');
  }

  function populateForm(a) {
    kbId = a.kbId;
    document.getElementById('kbEditTitle').textContent = 'แก้ไขบทความ (' + a.kbId + ')';
    document.getElementById('kbTitle').value = a.title || '';
    document.getElementById('kbCategory').value = a.category || 'Repair_Case';
    document.getElementById('kbMainIssue').value = a.mainIssue || 'ทั่วไป';
    document.getElementById('kbLine').value = a.line || 'ทุกไลน์';
    document.getElementById('kbStation').value = a.station || 'ทุก Station';
    document.getElementById('kbKeywords').value = a.symptomKeywords || '';
    document.getElementById('kbProblem').value = a.problem || '';
    document.getElementById('kbRootCause').value = a.rootCause || '';
    document.getElementById('kbSolution').value = a.solution || '';
    document.getElementById('kbPrevention').value = a.prevention || '';
    document.getElementById('kbTools').value = a.tools || '';
    document.getElementById('kbSpareParts').value = a.spareParts || '';
    document.getElementById('kbTimeEst').value = a.timeEst || '';
    document.getElementById('kbRefMtJobNo').value = a.refMtJobNo || '';
    document.getElementById('kbWarning').value = a.warning || '';
    existingPhotoUrls = String(a.photoUrls || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    renderPhotoPreview();
  }

  function collectPayload(status) {
    var title = document.getElementById('kbTitle').value.trim();
    var problem = document.getElementById('kbProblem').value.trim();
    var solution = document.getElementById('kbSolution').value.trim();
    if (!title || !problem || !solution) {
      U.toast('กรอก ชื่อเรื่อง, อาการที่เจอ, วิธีแก้ ให้ครบ', 'error');
      return null;
    }
    return {
      kbId: kbId || undefined,
      title: title,
      category: document.getElementById('kbCategory').value,
      mainIssue: document.getElementById('kbMainIssue').value,
      line: document.getElementById('kbLine').value,
      station: document.getElementById('kbStation').value,
      symptomKeywords: document.getElementById('kbKeywords').value.trim(),
      problem: problem,
      rootCause: document.getElementById('kbRootCause').value.trim(),
      solution: solution,
      prevention: document.getElementById('kbPrevention').value.trim(),
      tools: document.getElementById('kbTools').value.trim(),
      spareParts: document.getElementById('kbSpareParts').value.trim(),
      timeEst: document.getElementById('kbTimeEst').value.trim(),
      warning: document.getElementById('kbWarning').value.trim(),
      refMtJobNo: document.getElementById('kbRefMtJobNo').value.trim(),
      status: status,
      existingPhotoUrls: existingPhotoUrls.join(','),
      photoBase64List: pendingPhotos.map(function (p) { return p.base64; })
    };
  }

  async function save(status, btn) {
    var payload = collectPayload(status);
    if (!payload) return;
    btn.disabled = true;
    var overlay = document.getElementById('overlay');
    overlay.classList.add('show');
    try {
      var res = await API.call('saveKB', payload);
      U.toast(status === 'Published' ? 'เผยแพร่บทความสำเร็จ' : 'บันทึกฉบับร่างสำเร็จ', 'success');
      location.href = 'kb-detail.html?id=' + encodeURIComponent(res.kbId);
    } catch (e) {
      U.toast('บันทึกไม่สำเร็จ: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      overlay.classList.remove('show');
    }
  }

  async function init() {
    Auth.renderUserBadge('userBadge');
    fillOptions('kbCategory', Object.keys(CATEGORY_LABELS), CATEGORY_LABELS);
    fillOptions('kbMainIssue', MAIN_ISSUES);

    try {
      var cfg = await API.getConfig();
      fillOptions('kbLine', ['ทุกไลน์'].concat(cfg.Line || []));
      fillOptions('kbStation', ['ทุก Station'].concat(cfg.Station || []));
    } catch (e) {}

    document.getElementById('kbTitle').addEventListener('input', renderKeywordSuggestions);
    document.getElementById('kbProblem').addEventListener('input', renderKeywordSuggestions);
    document.getElementById('kbPhotos').addEventListener('change', async function (e) {
      var files = Array.prototype.slice.call(e.target.files);
      for (var i = 0; i < files.length; i++) {
        var b64 = await U.compressImage(files[i], 1280);
        pendingPhotos.push({ base64: b64 });
      }
      e.target.value = '';
      renderPhotoPreview();
    });
    document.getElementById('kbPublishBtn').onclick = function () { save('Published', this); };
    document.getElementById('kbDraftBtn').onclick = function () { save('Draft', this); };
    document.getElementById('kbCancelBtn').onclick = function () { history.back(); };

    var id = new URLSearchParams(location.search).get('id');
    if (id) {
      U.progress(true);
      try {
        var res = await API.call('getKBDetail', { kbId: id });
        populateForm(res.article);
      } catch (e) {
        U.toast('โหลดบทความไม่สำเร็จ: ' + e.message, 'error');
      } finally {
        U.progress(false);
      }
    }
    renderKeywordSuggestions();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
