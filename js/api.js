/* fetch wrapper: text/plain (no CORS preflight) + retry + client-side config cache. */
(function () {
  var CFG = window.APP_CONFIG || {};

  function currentUser() {
    try { return JSON.parse(localStorage.getItem('mms_user') || '{}'); }
    catch (e) { return {}; }
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function call(action, payload) {
    if (!CFG.GAS_URL || CFG.GAS_URL.indexOf('PASTE') === 0) {
      throw new Error('ยังไม่ได้ตั้งค่า GAS_URL ใน js/config.js');
    }
    var body = JSON.stringify({ action: action, payload: payload || {}, user: currentUser() });
    var retries = CFG.FETCH_RETRIES || 2;
    var lastErr;

    for (var attempt = 0; attempt <= retries; attempt++) {
      try {
        var res = await fetch(CFG.GAS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: body,
          redirect: 'follow'
        });
        var text = await res.text();
        var json;
        try { json = JSON.parse(text); }
        catch (e) { throw new Error('เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง'); }
        if (!json.success) throw new Error(json.error || 'เกิดข้อผิดพลาดจากเซิร์ฟเวอร์');
        return json.data;
      } catch (err) {
        lastErr = err;
        if (attempt < retries) await sleep(600 * (attempt + 1));
      }
    }
    throw new Error((lastErr && lastErr.message) ? lastErr.message : 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ');
  }

  async function getConfig(force) {
    var key = 'mms_config';
    var ttl = (CFG.CONFIG_CACHE_MINUTES || 10) * 60000;
    if (!force) {
      try {
        var cached = JSON.parse(sessionStorage.getItem(key) || 'null');
        if (cached && (Date.now() - cached.t) < ttl) return cached.data;
      } catch (e) {}
    }
    var data = await call('getConfig');
    sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), data: data }));
    return data;
  }

  window.API = { call: call, getConfig: getConfig };
})();
