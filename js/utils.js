/* Shared helpers: Thai dates, shift detect, image compression, Main_Issue normalize. */
(function () {
  var TH_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function toDate(v) {
    if (!v) return null;
    if (v instanceof Date) return v;
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  /** dd/mm/yyyy (Christian year, per spec) */
  function thaiDate(v) {
    var d = toDate(v);
    if (!d) return '-';
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  function thaiDateTime(v) {
    var d = toDate(v);
    if (!d) return '-';
    return thaiDate(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /** For <input type="date"> value (yyyy-mm-dd, local). */
  function ymd(v) {
    var d = v ? toDate(v) : new Date();
    if (!d) d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function detectShift(date, cfg) {
    var aStart = 8, bStart = 20;
    if (cfg && cfg.Setting) {
      if (cfg.Setting.ShiftA_StartHour) aStart = parseInt(cfg.Setting.ShiftA_StartHour, 10);
      if (cfg.Setting.ShiftB_StartHour) bStart = parseInt(cfg.Setting.ShiftB_StartHour, 10);
    }
    var h = (date || new Date()).getHours();
    return (h >= aStart && h < bStart) ? 'A' : 'B';
  }

  /** Minutes elapsed since a timestamp, formatted as "Xช Ynาที" / "Yนาที". */
  function elapsed(v) {
    var d = toDate(v);
    if (!d) return '-';
    var mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
    var h = Math.floor(mins / 60), m = mins % 60;
    return h > 0 ? (h + ' ชม. ' + m + ' นาที') : (m + ' นาที');
  }

  function normalizeMainIssue(raw) {
    var s = String(raw || '').toLowerCase().trim();
    if (!s) return 'อื่นๆ';
    if (/mach|mech|กล/.test(s)) return 'Mechanical';
    if (/elec|ไฟ/.test(s)) return 'Electrical';
    if (/soft|program|โปรแกรม/.test(s)) return 'Software';
    if (/cam|vision|กล้อง/.test(s)) return 'Camera&Vision';
    return 'อื่นๆ';
  }

  /** Compress an image File to <=maxW wide JPEG, return dataURL (base64). */
  function compressImage(file, maxW) {
    maxW = maxW || 1280;
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('อ่านไฟล์รูปไม่สำเร็จ')); };
      reader.onload = function (e) {
        var img = new Image();
        img.onerror = function () { reject(new Error('เปิดรูปไม่สำเร็จ')); };
        img.onload = function () {
          var w = img.width, h = img.height;
          if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(msg, type) {
    var el = document.getElementById('toast');
    if (!el) { alert(msg); return; }
    el.textContent = msg;
    el.className = 'toast show ' + (type || 'info');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.className = 'toast'; }, 3200);
  }

  /** Thin top progress bar for background fetches — show(true/false). */
  function progress(show) {
    var el = document.getElementById('topProgress');
    if (el) el.classList.toggle('show', !!show);
  }

  /** N skeleton "card" placeholders shaped like a job/list card, for use
   * while the first fetch of a list is still in flight. */
  function skeletonCards(n) {
    var one = '<div class="skeleton-card">' +
      '<div class="skeleton sk-line sk-w40"></div>' +
      '<div class="skeleton sk-line sk-w70"></div>' +
      '<div class="skeleton sk-line sk-w90"></div>' +
      '<div class="skeleton sk-h28"></div>' +
    '</div>';
    return new Array(n || 3).fill(one).join('');
  }

  /** N skeleton tiles shaped like a KPI card. */
  function skeletonKpis(n) {
    var one = '<div class="kpi skeleton-kpi skeleton"></div>';
    return new Array(n || 6).fill(one).join('');
  }

  window.U = {
    pad2: pad2, toDate: toDate, thaiDate: thaiDate, thaiDateTime: thaiDateTime, ymd: ymd,
    detectShift: detectShift, elapsed: elapsed, normalizeMainIssue: normalizeMainIssue,
    compressImage: compressImage, escapeHtml: escapeHtml, toast: toast,
    progress: progress, skeletonCards: skeletonCards, skeletonKpis: skeletonKpis,
    monthsTh: TH_MONTHS
  };
})();
