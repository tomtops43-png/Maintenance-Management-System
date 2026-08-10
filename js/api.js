/* fetch wrapper: text/plain (no CORS preflight) + retry + client-side config cache. */
(function () {
  var CFG = window.APP_CONFIG || {};

  // Marker the backend appends when the session token is missing or expired.
  // Kept in sync with ERR_SESSION in gas/Code.gs.
  var SESSION_EXPIRED = '[SESSION_EXPIRED]';

  function currentUser() {
    try { return JSON.parse(localStorage.getItem('mms_user') || '{}'); }
    catch (e) { return {}; }
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /** A dead session never fixes itself, so drop the stale login and send the
   * user to sign in again rather than surfacing a raw error. */
  function handleSessionExpired() {
    try { localStorage.removeItem('mms_user'); } catch (e) {}
    if (location.pathname.indexOf('login.html') >= 0) return;
    var here = location.pathname.split('/').pop() || 'index.html';
    location.replace('login.html?next=' + encodeURIComponent(here) + '&expired=1');
  }

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
        // Retrying an expired session just wastes the budget and ends in the
        // same place — bail out of the loop and go straight to login.
        if (err && String(err.message).indexOf(SESSION_EXPIRED) >= 0) {
          handleSessionExpired();
          throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        }
        lastErr = err;
        if (attempt < retries) await sleep(600 * (attempt + 1));
      }
    }
    throw new Error((lastErr && lastErr.message) ? lastErr.message : 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ');
  }

  var CONFIG_KEY = 'mms_config';

  /** Drop the cached CONFIG so the next getConfig() goes to the sheet.
   * Needed because the cache lives in sessionStorage: it survives a reload,
   * so a dropdown edited in Google Sheets would otherwise look unchanged for
   * up to CONFIG_CACHE_MINUTES no matter how many times the page is refreshed. */
  function clearConfigCache() {
    try { sessionStorage.removeItem(CONFIG_KEY); } catch (e) {}
  }

  async function getConfig(force) {
    var key = CONFIG_KEY;
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

  window.API = { call: call, getConfig: getConfig, clearConfigCache: clearConfigCache };
})();
