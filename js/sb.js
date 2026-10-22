/* ============================================================
   سكرتاري | Secretary — Supabase Client
   - يستخدم مكتبة supabase-js الرسمية (CDN) عند توفرها لمصادقة أقوى
   - ويلجأ إلى REST/PostgREST المباشر عند غيابها أو فشلها
   - يجدّد الجلسة تلقائياً عند انتهاء صلاحية الرمز (401)
   - عزل المستخدمين عبر سياسات RLS على مستوى الصفوف
   ============================================================ */
(function (global) {
  'use strict';

  var CFG_KEY = 'secretary:v1:sb';
  var SESSION_KEY = 'secretary:v1:sb_session';

  var cfg = { url: '', key: '' };
  var session = null;   // { access_token, refresh_token, user, expires_in, ts }
  var sdkCli = null;    // عميل supabase-js الرسمي (كاش)

  function load() {
    try { cfg = JSON.parse(localStorage.getItem(CFG_KEY) || '{"url":"","key":""}'); }
    catch (e) { cfg = { url: '', key: '' }; }
    if (!cfg.url) cfg.url = ''; if (!cfg.key) cfg.key = '';
    /* تكوين تلقائي اختياري: الملف supabase/config.js إذا وُضع (ويُستثنى من الرفع) */
    try {
      if (global.SUPABASE_CONFIG && global.SUPABASE_CONFIG.url && global.SUPABASE_CONFIG.anonKey) {
        cfg.url = String(cfg.url || global.SUPABASE_CONFIG.url);
        cfg.key = String(cfg.key || global.SUPABASE_CONFIG.anonKey);
      }
    } catch (e) { /* ignore */ }
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
    sdkCli = null;               /* أعِد بناء عميل المكتبة الرسمية بالمفاتيح الجديدة */
    return cfg;
  }
  function configured() { return !!(cfg.url && cfg.key); }

  /* عميل المكتبة الرسمية — يُنشأ عند الحاجة فقط */
  function sdk() {
    if (!configured()) return null;
    if (!global.supabase || !global.supabase.createClient) return null;
    try {
      if (!sdkCli) sdkCli = global.supabase.createClient(cfg.url, cfg.key, {
        auth: { persistSession: false, autoRefreshToken: true }
      });
      return sdkCli;
    } catch (e) { return null; }
  }

  /* ---------------- الجلسة (تخزين محلي للرموز) ---------------- */
  function restoreSession() {
    try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { session = null; }
    if (session && (!session.access_token || !session.user)) session = null;
    if (session && !session.refresh_token) session.refresh_token = session.refresh_token || null;
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

  /* تجديد الرمز عبر refresh_token عند انتهاء صلاحيته (401) */
  var refreshing = null;
  function refreshSession() {
    if (!session || !session.refresh_token) return Promise.reject(new Error('لا توجد جلسة للتجديد.'));
    if (refreshing) return refreshing;
    refreshing = request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', token: null,
      body: { refresh_token: session.refresh_token }, _noRetry: true
    }).then(function (d) {
      persistSession({
        access_token: d.access_token,
        refresh_token: d.refresh_token || session.refresh_token,
        user: d.user || session.user,
        expires_in: d.expires_in, ts: Date.now()
      });
      return session;
    }).finally(function () { refreshing = null; });
    return refreshing;
  }

  /* ---------------- الطلب الأساسي (REST) ---------------- */
  function request(path, opts) {
    opts = opts || {};
    if (!configured()) return Promise.reject(new Error('لم يتم إعداد Supabase بعد.'));
    var headers = { apikey: cfg.key, 'Content-Type': 'application/json' };
    var t = opts.token === undefined ? token() : opts.token;
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
          /* انتهت صلاحية الرمز → جرّب التجديد ثم أعِد الطلب مرة واحدة */
          if (res.status === 401 && !opts._noRetry && session && session.refresh_token) {
            return refreshSession().then(function () {
              var o2 = Object.assign({}, opts, { _noRetry: true, token: undefined });
              return request(path, o2);
            }).catch(function () {
              var err = new Error('انتهت صلاحية الجلسة — سجّل الدخول من جديد.');
              err.status = 401; throw err;
            });
          }
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

  /* ---------------- المصادقة (Auth) ---------------- */
  function saveAuthSession(sess) {
    if (sess && sess.access_token) {
      persistSession({
        access_token: sess.access_token,
        refresh_token: sess.refresh_token || null,
        user: sess.user,
        expires_in: sess.expires_in,
        ts: Date.now()
      });
    }
  }

  function signIn(email, password) {
    var c = sdk();
    if (c) {
      return c.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
        if (res.error) throw new Error(res.error.message);
        saveAuthSession(res.data.session);
        return session;
      }).catch(function (e) { throw new Error(e.message || 'تعذّر تسجيل الدخول.'); });
    }
    return request('/auth/v1/token?grant_type=password', {
      method: 'POST', body: { email: email, password: password }, token: null
    }).then(function (d) {
      persistSession({ access_token: d.access_token, refresh_token: d.refresh_token, user: d.user, expires_in: d.expires_in, ts: Date.now() });
      return session;
    });
  }

  function signUp(email, password, name) {
    var o = { email: email, password: password, data: { name: name || email } };
    var c = sdk();
    var p = c
      ? c.auth.signUp(o).then(function (res) {
          if (res.error) throw new Error(res.error.message);
          return { raw: res, hasToken: !!(res.data && res.data.session) };
        })
      : request('/auth/v1/signup', { method: 'POST', token: null, body: o })
          .then(function (d) { return { raw: d, hasToken: !!(d && d.access_token) }; });
    return p.then(function (r) {
      if (r.hasToken) {
        if (c) saveAuthSession(r.raw.data.session);
        else {
          var d = r.raw;
          persistSession({ access_token: d.access_token, refresh_token: d.refresh_token, user: d.user, expires_in: d.expires_in, ts: Date.now() });
        }
        return { session: session, needsConfirmation: false };
      }
      return { session: null, needsConfirmation: true };
    });
  }

  function signOut() {
    var c = sdk();
    persistSession(null);
    if (c) return c.auth.signOut().then(function () { return true; }).catch(function () { return true; });
    return request('/auth/v1/logout', { method: 'DELETE', token: token() })
      .catch(function () { return true; });
  }

  /* نسيت كلمة المرور: إرسال رابط إعادة التعيين إلى البريد */
  function resetPassword(email, redirectTo) {
    var c = sdk();
    if (c) {
      return c.auth.resetPasswordForEmail(email, { redirectTo: redirectTo || (global.location && global.location.origin + global.location.pathname) })
        .then(function (res) { if (res.error) throw new Error(res.error.message); return true; });
    }
    return request('/auth/v1/recover', {
      method: 'POST', token: null,
      body: { email: email, gotrue_meta_security: {}, redirect_to: redirectTo || (cfg.url + '/') }
    });
  }

  /* تعيين أو تغيير كلمة المرور (بعد رابط الاستعادة أو من الإعدادات) */
  function updatePassword(newPassword) {
    var c = sdk();
    if (c) {
      return c.auth.updateUser({ password: newPassword }).then(function (res) {
        if (res.error) throw new Error(res.error.message);
        if (res.data && res.data.session) saveAuthSession(res.data.session);
        return true;
      });
    }
    return request('/auth/v1/user', { method: 'PUT', body: { password: newPassword } });
  }

  /* التحقق من الجلسة عبر المكتبة الرسمية (مناسب بعد فتح رابط الاستعادة في متصفح جديد) */
  function restoreFromSdk() {
    var c = sdk();
    if (!c) return Promise.resolve(session);
    return c.auth.getSession().then(function (r) {
      if (r && r.data && r.data.session) {
        saveAuthSession(r.data.session);
        return session;
      }
      return session;
    }).catch(function () { return session; });
  }

  /* ---------------- البيانات (PostgREST) ---------------- */
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
      .then(function () { return { ok: true, sdk: !!sdk() }; })
      .catch(function (e) {
        if (e.status === 404 || e.status === 401) return { ok: true, sdk: !!sdk() };
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
    resetPassword: resetPassword,
    updatePassword: updatePassword,
    restoreSession: restoreSession,
    restoreFromSdk: restoreFromSdk,
    select: select,
    upsert: upsert,
    remove: remove,
    ping: ping,
    session: function () { return session; },
    token: token,
    userId: userId
  };
})(window);
