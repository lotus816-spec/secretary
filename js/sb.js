/* ============================================================
   سكرتاري | Secretary — Supabase Client
   عميل خفيف بدون SDK: REST + PostgREST + GoTrue Auth.
   تُستخدم مفاتيح RLS على مستوى الصفوف ليعزل كل مستخدم بياناته.
   ============================================================ */
(function (global) {
  'use strict';

  var CFG_KEY = 'secretary:v1:sb';
  var SESSION_KEY = 'secretary:v1:sb_session';

  var cfg = { url: '', key: '' };
  var session = null;   // { access_token, user }

  function load() {
    try { cfg = JSON.parse(localStorage.getItem(CFG_KEY) || '{"url":"","key":""}'); }
    catch (e) { cfg = { url: '', key: '' }; }
    if (!cfg.url) cfg.url = ''; if (!cfg.key) cfg.key = '';
  }
  function save() {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
  }
  load();

  function configure(url, key) {
    cfg = {
      url: String(url || '').trim().replace(/\/+$/, ''),
      key: String(key || '').trim()
    };
    save();
    return cfg;
  }
  function configured() { return !!(cfg.url && cfg.key); }

  function restoreSession() {
    try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { session = null; }
    if (session && (!session.access_token || !session.user)) session = null;
    return session;
  }
  function persistSession(s) {
    session = s;
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* ignore */ }
  }
  restoreSession();

  function token() { return session && session.access_token; }
  function userId() { return session && session.user ? session.user.id : null; }

  function request(path, opts) {
    opts = opts || {};
    if (!configured()) return Promise.reject(new Error('لم يتم إعداد Supabase بعد.'));
    var headers = { apikey: cfg.key, 'Content-Type': 'application/json' };
    var t = opts.token || token();
    if (t) headers.Authorization = 'Bearer ' + t;
    if (opts.prefer) headers.Prefer = opts.prefer;
    return fetch(cfg.url + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      return res.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
        if (!res.ok) {
          var msg = 'HTTP ' + res.status;
          if (data) {
            if (data.msg) msg = data.msg;
            else if (data.message) msg = data.message;
            else if (data.error_description) msg = data.error_description;
            else if (data.error) msg = typeof data.error === 'string' ? data.error : (data.error.message || msg);
          }
          var err = new Error(msg);
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  /* ---------------- Auth ---------------- */
  function signIn(email, password) {
    return request('/auth/v1/token?grant_type=password', {
      method: 'POST', body: { email: email, password: password }, token: null
    }).then(function (d) {
      persistSession({ access_token: d.access_token, user: d.user, expires_at: d.expires_in });
      return session;
    });
  }
  function signUp(email, password, name) {
    return request('/auth/v1/signup', {
      method: 'POST', token: null,
      body: { email: email, password: password, data: { name: name || email } }
    }).then(function (d) {
      if (d && d.access_token) {
        persistSession({ access_token: d.access_token, user: d.user, expires_at: d.expires_in });
        return { session: session, needsConfirmation: false };
      }
      return { session: null, needsConfirmation: true };
    });
  }
  function signOut() {
    var t = token();
    persistSession(null);
    if (!t) return Promise.resolve(true);
    return request('/auth/v1/logout', { method: 'DELETE', token: t })
      .catch(function () { return true; });
  }

  /* ---------------- Data (PostgREST) ---------------- */
  function select(table, query) {
    var q = query ? ('?' + query) : '';
    return request('/rest/v1/' + table + q);
  }
  function upsert(table, row) {
    return request('/rest/v1/' + table, {
      method: 'POST', body: row,
      prefer: 'resolution=merge-duplicates,return=minimal'
    });
  }
  function remove(table, filter) {
    return request('/rest/v1/' + table + '?' + filter, { method: 'DELETE' });
  }

  /* ---------------- اختبار الاتصال ---------------- */
  function ping() {
    return request('/auth/v1/settings', { token: null })
      .then(function () { return { ok: true }; })
      .catch(function (e) {
        if (e.status === 404 || e.status === 401) return { ok: true };
        return { ok: false, error: e.message };
      });
  }

  global.SB = {
    configure: configure,
    configured: configured,
    get config() { return cfg; },
    signIn: signIn,
    signUp: signUp,
    signOut: signOut,
    restoreSession: restoreSession,
    select: select,
    upsert: upsert,
    remove: remove,
    ping: ping,
    session: function () { return session; },
    token: token,
    userId: userId
  };
})(window);
