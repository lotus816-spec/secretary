/* ============================================================
   سكرتاري | Secretary — Store & Auth
   localStorage-based, per-user isolated data namespaces.
   Passwords are hashed (SHA-256 + per-user salt) before storage.
   ============================================================ */
(function (global) {
  'use strict';

  var NS = 'secretary:v1:';
  var K_USERS = NS + 'users';
  var K_SESSION = NS + 'session';
  var K_DATA = function (uid) { return NS + 'u:' + uid; };

  var users = null;          // { userId: {id,name,email,salt,hash,createdAt} }
  var session = null;        // { userId, ts, remember }
  var data = null;           // current user's dataset
  var listeners = [];

  /* ---------------- events ---------------- */
  function on(fn) { listeners.push(fn); }
  function emit(type, payload) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](type, payload); } catch (e) { console.error(e); }
    }
  }

  /* ---------------- low level ---------------- */
  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('storage full', e);
      global.UI && global.UI.toast && global.UI.toast({ type: 'err', title: 'تعذّر الحفظ', text: 'مساحة التخزين ممتلئة. احذف بعض البيانات أو صدّر نسخة.' });
      return false;
    }
  }
  function loadUsers() { if (!users) users = readJSON(K_USERS, {}); return users; }

  /* ---------------- الجلسة ---------------- */
  var SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000;   // 30 يوماً عند اختيار «تذكرني»

  function sessionGet() { try { return JSON.parse(sessionStorage.getItem(K_SESSION) || 'null'); } catch (e) { return null; } }
  function sessionSet(v) {
    try {
      if (v) sessionStorage.setItem(K_SESSION, JSON.stringify(v));
      else sessionStorage.removeItem(K_SESSION);
    } catch (e) { /* ignore */ }
  }
  function loadSession() {
    if (session) return session;
    var s = readJSON(K_SESSION, null);          // جلسة دائمة (تذكّرني)
    var persistent = true;
    if (!s) { s = sessionGet(); persistent = false; }   // جلسة حتى إغلاق المتصفح
    if (s) {
      var age = Date.now() - (s.ts || 0);
      if (s.remember && persistent && age > SESSION_MAX_AGE) {
        s = null;                                // انتهت صلاحية الجلسة
        try { localStorage.removeItem(K_SESSION); } catch (e) { }
      }
    }
    session = s;
    return session;
  }
  function saveSession(s) {
    session = s;
    try { localStorage.removeItem(K_SESSION); } catch (e) { }
    sessionSet(null);
    if (!s) return;
    if (s.remember) {
      try { localStorage.setItem(K_SESSION, JSON.stringify(s)); } catch (e) { }
      sessionSet(null);
    } else {
      sessionSet(s);
    }
  }
  function sessionInfo() {
    var s = loadSession();
    if (!s) return null;
    var u = currentUser();
    return {
      userId: s.userId,
      name: u ? u.name : '',
      email: u ? u.email : '',
      persistent: !!s.remember,
      supabase: !!s.sb,
      startedAt: s.ts || 0,
      expiresAt: s.remember && s.ts ? s.ts + SESSION_MAX_AGE : null
    };
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ---------------- password hashing ---------------- */
  function toHex(buf) {
    var arr = new Uint8Array(buf), out = '';
    for (var i = 0; i < arr.length; i++) out += ('0' + arr[i].toString(16)).slice(-2);
    return out;
  }
  function fallbackHash(str) {
    // Deterministic fallback when SubtleCrypto is unavailable (non-secure context).
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < str.length; i++) {
      h1 ^= str.charCodeAt(i); h1 = (h1 * 16777619) >>> 0;
      h2 = ((h2 << 5) - h2 + str.charCodeAt(i) * 31) >>> 0;
    }
    var acc = h1.toString(16) + h2.toString(16);
    for (var r = 0; r < 2048; r++) {
      var x = acc + r;
      var h = 5381;
      for (var j = 0; j < x.length; j++) h = ((h * 33) ^ x.charCodeAt(j)) >>> 0;
      acc = h.toString(16);
    }
    return 'fb' + acc;
  }
  function hashPassword(password, salt) {
    var payload = salt + '::' + password;
    try {
      if (global.crypto && global.crypto.subtle && global.TextEncoder) {
        var buf = global.crypto.subtle.digest('SHA-256', global.TextEncoder.encode(payload));
        return buf.then(function (d) { return toHex(d); })
          .catch(function () { return fallbackHash(payload); });
      }
    } catch (e) { /* fall through */ }
    return Promise.resolve(fallbackHash(payload));
  }
  function makeSalt() {
    var s = '';
    try {
      if (global.crypto && global.crypto.getRandomValues) {
        var a = new Uint8Array(16); global.crypto.getRandomValues(a);
        for (var i = 0; i < a.length; i++) s += ('0' + a[i].toString(16)).slice(-2);
        return s;
      }
    } catch (e) { /* ignore */ }
    return (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
  }

  /* ---------------- normalisation ---------------- */
  function normEmail(email) { return String(email || '').trim().toLowerCase(); }
  function emailValid(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email); }

  /* ---------------- defaults ---------------- */
  function defaultData(ownerId) {
    return {
      ownerId: ownerId,
      version: 1,
      createdAt: Date.now(),
      tasks: [],
      plans: [],
      notes: [],
      messages: [],
      settings: {
        theme: 'light',
        voiceURI: '',
        rate: 1,
        pitch: 1,
        arabicNumbers: true,
        lead: 5,
        digest: true,
        autoLock: true,
        sound: true,
        customFields: [],
        whatsapp: {
          enabled: false,
          phone: '',
          provider: 'link',
          lead: 30,
          apikey: '',
          phoneNumberId: '',
          accessToken: ''
        }
      }
    };
  }
  function defaultSettings() { return defaultData('x').settings; }

  /* ---------------- Supabase sync ---------------- */
  function supabaseMode() { return !!(global.SB && global.SB.configured()); }
  function syncPull() {
    if (!supabaseMode() || !SB.session()) return Promise.resolve(false);
    var uid = SB.userId();
    return SB.select('secretary_items', 'user_id=eq.' + uid + '&select=kind,id,data')
      .then(function (rows) {
        var t = [], p = [], n = [];
        (rows || []).forEach(function (r) {
          var d = r.data || {};
          if (r.kind === 'task') t.push(d);
          else if (r.kind === 'plan') p.push(d);
          else if (r.kind === 'note') n.push(d);
          else if (r.kind === 'settings') { /* handled below */ }
        });
        if (!data) data = defaultData(uid);
        data.tasks = t; data.plans = p; data.notes = n;
        saveData();
        emit('data', data);
        return true;
      })
      .catch(function (err) {
        console.warn('sync pull failed', err);
        return false;
      });
  }
  function syncPush(kind, row) {
    if (!supabaseMode() || !SB.session() || !row) return;
    SB.upsert('secretary_items', {
      id: row.id, user_id: SB.userId(), kind: kind,
      data: row, updated_at: new Date().toISOString()
    }).catch(function (err) { console.warn('sync push failed', err); });
  }
  function syncRemove(kind, id) {
    if (!supabaseMode() || !SB.session() || !id) return;
    SB.remove('secretary_items', 'user_id=eq.' + SB.userId() + '&id=eq.' + encodeURIComponent(id))
      .catch(function (err) { console.warn('sync remove failed', err); });
  }
  function syncSettings() {
    if (!supabaseMode() || !SB.session() || !data) return;
    SB.upsert('secretary_items', {
      id: 'settings', user_id: SB.userId(), kind: 'settings',
      data: data.settings, updated_at: new Date().toISOString()
    }).catch(function (err) { console.warn('sync settings failed', err); });
  }

  /* ---------------- user CRUD ---------------- */
  function findUserByEmail(email) {
    var u = loadUsers(), e = normEmail(email);
    for (var k in u) { if (u[k] && u[k].email === e) return u[k]; }
    return null;
  }

  function fail(msg, code) {
    var e = new Error(msg);
    e.code = code || 'ERROR';
    return Promise.reject(e);
  }

  function register(opts) {
    opts = opts || {};
    var email = normEmail(opts.email);
    var name = String(opts.name || '').trim();
    var password = String(opts.password || '');

    if (!name) return fail('الرجاء إدخال الاسم.', 'NAME');
    if (!emailValid(email)) return fail('صيغة البريد الإلكتروني غير صحيحة.', 'EMAIL');
    if (password.length < 6) return fail('كلمة المرور يجب ألا تقل عن 6 أحرف.', 'PASSWORD');

    if (supabaseMode()) {
      return SB.signUp(email, password, name).then(function (r) {
        if (r.needsConfirmation) {
          return fail('تم إنشاء الحساب — تحقّق من بريدك الإلكتروني لتفعيله ثم سجّل الدخول.', 'CONFIRM');
        }
        return SB.signIn(email, password).then(function (sess) {
          var s = { userId: sess.user.id, ts: Date.now(), remember: true, sb: true };
          saveSession(s);
          loadData();
          return syncPull().then(function () { return currentUser(); });
        });
      }).catch(function (err) {
        var msg = (err && err.message) || '';
        if (/already|registered|exists|duplicate/i.test(msg) || (err && err.status === 422) || (err && err.status === 400)) {
          return fail('هذا البريد مسجّل بالفعل على Supabase — سجّل الدخول بدلاً من ذلك.', 'EMAIL_EXISTS');
        }
        throw err;
      });
    }

    /* لا يمكن تسجيل نفس البريد مرتين — حتى لا تضيع بيانات الحساب السابق */
    if (findUserByEmail(email)) {
      return fail('هذا البريد مسجّل بالفعل على هذا الجهاز — سجّل الدخول بكلمة المرور.', 'EMAIL_EXISTS');
    }

    var salt = makeSalt();
    return hashPassword(password, salt).then(function (hash) {
      var all = loadUsers();
      /* فحص أخير قبل الحفظ (حماية من التزامن) */
      if (findUserByEmail(email)) {
        return fail('هذا البريد مسجّل بالفعل على هذا الجهاز — سجّل الدخول بكلمة المرور.', 'EMAIL_EXISTS');
      }
      var id = uid('u');
      all[id] = { id: id, name: name, email: email, salt: salt, hash: hash, createdAt: Date.now() };
      writeJSON(K_USERS, all);
      return all[id];
    });
  }

  function login(email, password, remember) {
    var e = normEmail(email);
    if (supabaseMode()) {
      return SB.signIn(e, String(password || '')).then(function (sess) {
        var s = { userId: sess.user.id, ts: Date.now(), remember: remember !== false, sb: true };
        saveSession(s);
        loadData();
        return syncPull().then(function () { return currentUser(); });
      });
    }
    var user = findUserByEmail(e);
    if (!user) return Promise.reject(new Error('لا يوجد حساب بهذا البريد الإلكتروني.'));
    return hashPassword(String(password || ''), user.salt).then(function (hash) {
      if (hash !== user.hash) return Promise.reject(new Error('كلمة المرور غير صحيحة.'));
      var s = { userId: user.id, ts: Date.now(), remember: remember !== false };
      saveSession(s);
      return user;
    });
  }

  function logout() {
    if (supabaseMode() && SB.session()) {
      SB.signOut();
    }
    saveSession(null);
    session = null;
    data = null;
  }

  function currentUser() {
    if (supabaseMode() && SB.session()) {
      var su = SB.session().user || {};
      return {
        id: su.id,
        name: (su.user_metadata && su.user_metadata.name) || su.email || 'مستخدم',
        email: su.email || '',
        supabase: true
      };
    }
    var s = loadSession();
    if (!s || !s.userId) return null;
    var all = loadUsers();
    return all[s.userId] || null;
  }

  /* ---------------- dataset ---------------- */
  function loadData() {
    var user = currentUser();
    if (!user) { data = null; return null; }
    var raw = readJSON(K_DATA(user.id), null);
    if (!raw || raw.ownerId !== user.id) raw = defaultData(user.id);
    // merge defaults for forward compatibility
    var d = defaultData(user.id);
    for (var k in d) { if (!(k in raw)) raw[k] = d[k]; }
    raw.settings = Object.assign({}, d.settings, raw.settings || {});
    data = raw;
    return data;
  }

  function saveData() {
    if (!data) return false;
    var user = currentUser();
    if (!user) return false;
    if (data.ownerId !== user.id) {              // ownership guard: never cross accounts
      console.error('blocked write to foreign namespace');
      return false;
    }
    return writeJSON(K_DATA(user.id), data);
  }

  function patch(mutator) {
    if (!data) loadData();
    if (!data) return;
    mutator(data);
    saveData();
    emit('data', data);
  }

  /* ---------------- task helpers ---------------- */
  function addTask(task) {
    var t = Object.assign({
      id: uid('t'), title: '', notes: '', date: todayISO(), time: '', duration: 30,
      category: 'personal', priority: 'med', status: 'todo', reminder: true,
      repeat: 'none', createdAt: Date.now(), doneAt: null, remindedAt: null,
      whatsappSentAt: null, archived: false, archivedAt: null, deletedAt: null, tags: []
    }, task || {});
    patch(function (d) { d.tasks.push(t); });
    syncPush('task', t);
    return t;
  }
  function updateTask(id, changes) {
    var updated = null;
    patch(function (d) {
      for (var i = 0; i < d.tasks.length; i++) {
        if (d.tasks[i].id === id) { d.tasks[i] = Object.assign({}, d.tasks[i], changes); updated = d.tasks[i]; return; }
      }
    });
    if (updated) syncPush('task', updated);
  }
  function removeTask(id) {
    patch(function (d) {
      d.tasks = d.tasks.filter(function (t) { return t.id !== id; });
    });
    syncRemove('task', id);
  }
  function getTask(id) {
    if (!data) return null;
    for (var i = 0; i < data.tasks.length; i++) if (data.tasks[i].id === id) return data.tasks[i];
    return null;
  }

  /* ---------------- plan helpers ---------------- */
  function addPlan(plan) {
    var p = Object.assign({
      id: uid('p'), title: '', category: 'work', startDate: todayISO(), expiryDate: todayISO(),
      cycle: 'monthly', autoRenew: true, cost: 0, note: '', status: 'active',
      lastRenewedAt: null, createdAt: Date.now(), history: [],
      archived: false, archivedAt: null, deletedAt: null
    }, plan || {});
    patch(function (d) { d.plans.push(p); });
    syncPush('plan', p);
    return p;
  }
  function updatePlan(id, changes) {
    var updated = null;
    patch(function (d) {
      for (var i = 0; i < d.plans.length; i++) {
        if (d.plans[i].id === id) { d.plans[i] = Object.assign({}, d.plans[i], changes); updated = d.plans[i]; return; }
      }
    });
    if (updated) syncPush('plan', updated);
  }
  function removePlan(id) {
    patch(function (d) { d.plans = d.plans.filter(function (p) { return p.id !== id; }); });
    syncRemove('plan', id);
  }

  /* ---------------- note helpers ---------------- */
  function addNote(note) {
    var n = Object.assign({
      id: uid('n'), title: '', text: '', color: '#1d4ed8', pinned: false, createdAt: Date.now(), updatedAt: Date.now(),
      archived: false, archivedAt: null, deletedAt: null
    }, note || {});
    patch(function (d) { d.notes.unshift(n); });
    syncPush('note', n);
    return n;
  }
  function updateNote(id, changes) {
    var updated = null;
    patch(function (d) {
      for (var i = 0; i < d.notes.length; i++) {
        if (d.notes[i].id === id) {
          d.notes[i] = Object.assign({}, d.notes[i], changes, { updatedAt: Date.now() });
          updated = d.notes[i];
          return;
        }
      }
    });
    if (updated) syncPush('note', updated);
  }
  function removeNote(id) {
    patch(function (d) { d.notes = d.notes.filter(function (n) { return n.id !== id; }); });
    syncRemove('note', id);
  }

  /* ---------------- messages ---------------- */
  function pushMessage(msg) {
    var m = Object.assign({
      id: uid('m'), title: '', text: '', kind: 'info', ts: Date.now(), read: false, spoken: false, taskId: null
    }, msg || {});
    patch(function (d) {
      d.messages.unshift(m);
      if (d.messages.length > 120) d.messages.length = 120;
    });
    return m;
  }
  function markMessage(id, changes) {
    patch(function (d) {
      for (var i = 0; i < d.messages.length; i++) {
        if (d.messages[i].id === id) { d.messages[i] = Object.assign({}, d.messages[i], changes); return; }
      }
    });
  }
  function clearMessages() { patch(function (d) { d.messages = []; }); }

  /* ---------------- settings ---------------- */
  function getSettings() {
    if (!data) loadData();
    return (data && data.settings) || defaultSettings();
  }
  function setSetting(key, value) {
    patch(function (d) { d.settings[key] = value; });
    syncSettings();
  }

  /* ---------------- backup ---------------- */
  function exportData() {
    if (!data) return null;
    return {
      app: 'secretary',
      version: 1,
      exportedAt: new Date().toISOString(),
      user: { name: (currentUser() || {}).name, email: (currentUser() || {}).email },
      data: data
    };
  }
  function importData(payload) {
    if (!payload || payload.app !== 'secretary' || !payload.data) {
      return Promise.reject(new Error('الملف غير صالح أو لا يخص هذا التطبيق.'));
    }
    var user = currentUser();
    if (!user) return Promise.reject(new Error('سجّل الدخول أولاً.'));
    var incoming = payload.data;
    if (incoming.ownerId && incoming.ownerId !== user.id) incoming.ownerId = user.id;
    patch(function (d) {
      d.tasks = Array.isArray(incoming.tasks) ? incoming.tasks : [];
      d.plans = Array.isArray(incoming.plans) ? incoming.plans : [];
      d.notes = Array.isArray(incoming.notes) ? incoming.notes : [];
      d.messages = Array.isArray(incoming.messages) ? incoming.messages : [];
      if (incoming.settings) d.settings = Object.assign({}, d.settings, incoming.settings);
    });
    return Promise.resolve(true);
  }
  function wipeMyData() {
    patch(function (d) {
      d.tasks = []; d.plans = []; d.notes = []; d.messages = [];
    });
  }
  function wipeAllUsers() {
    try {
      var all = loadUsers();
      for (var k in all) { try { localStorage.removeItem(K_DATA(k)); } catch (e) { /* ignore */ } }
      localStorage.removeItem(K_USERS);
      localStorage.removeItem(K_SESSION);
      users = {}; session = null; data = null;
      return true;
    } catch (e) { return false; }
  }

  /* ---------------- date utils ---------------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayISO(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function parseISO(iso) {
    if (!iso) return null;
    var p = String(iso).split('-');
    if (p.length < 3) return null;
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function addDays(iso, n) {
    var d = parseISO(iso); if (!d) return iso;
    d.setDate(d.getDate() + n);
    return todayISO(d);
  }
  function daysBetween(isoA, isoB) {
    var a = parseISO(isoA), b = parseISO(isoB);
    if (!a || !b) return 0;
    return Math.round((b - a) / 86400000);
  }

  /* ---------------- generic archive / trash ---------------- */
  function kindOf(collection) {
    return collection === 'tasks' ? 'task' : collection === 'plans' ? 'plan' : 'note';
  }
  function mutate(collection, id, fn) {
    var updated = null;
    patch(function (d) {
      var list = d[collection] || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) { fn(list[i]); updated = list[i]; return; }
      }
    });
    if (updated) syncPush(kindOf(collection), updated);
  }
  function drop(collection, id) {
    patch(function (d) {
      d[collection] = (d[collection] || []).filter(function (x) { return x.id !== id; });
    });
    syncRemove(kindOf(collection), id);
  }
  function archiveItem(kind, id) {
    mutate(kind, id, function (it) { it.archived = true; it.archivedAt = Date.now(); it.deletedAt = null; });
  }
  function unarchiveItem(kind, id) {
    mutate(kind, id, function (it) { it.archived = false; it.archivedAt = null; });
  }
  function trashItem(kind, id) {
    mutate(kind, id, function (it) { it.deletedAt = Date.now(); it.archived = false; });
  }
  function restoreItem(kind, id) {
    mutate(kind, id, function (it) { it.deletedAt = null; });
  }
  function purgeItem(kind, id) {
    drop(kind, id);
  }
  function emptyTrash() {
    patch(function (d) {
      ['tasks', 'plans', 'notes'].forEach(function (c) {
        d[c] = (d[c] || []).filter(function (x) { return !x.deletedAt; });
      });
    });
  }
  function purgeAllArchived() {
    patch(function (d) {
      ['tasks', 'plans', 'notes'].forEach(function (c) {
        d[c] = (d[c] || []).filter(function (x) { return !x.archived; });
      });
    });
  }
  function archiveStats() {
    var d = data || {};
    var r = { archived: 0, trashed: 0, byType: { task: 0, plan: 0, note: 0 } };
    ['tasks', 'plans', 'notes'].forEach(function (c) {
      (d[c] || []).forEach(function (x) {
        if (x.deletedAt) { r.trashed++; r.byType[c === 'tasks' ? 'task' : c === 'plans' ? 'plan' : 'note']++; }
        else if (x.archived) { r.archived++; r.byType[c === 'tasks' ? 'task' : c === 'plans' ? 'plan' : 'note']++; }
      });
    });
    return r;
  }

  /* ---------------- export ---------------- */
  global.Store = {
    NS: NS,
    on: on,
    emit: emit,
    register: register,
    login: login,
    logout: logout,
    currentUser: currentUser,
    sessionInfo: sessionInfo,
    saveSession: saveSession,
    findUserByEmail: findUserByEmail,
    loadData: loadData,
    saveData: saveData,
    patch: patch,
    get data() { return data; },
    addTask: addTask, updateTask: updateTask, removeTask: removeTask, getTask: getTask,
    addPlan: addPlan, updatePlan: updatePlan, removePlan: removePlan,
    addNote: addNote, updateNote: updateNote, removeNote: removeNote,
    pushMessage: pushMessage, markMessage: markMessage, clearMessages: clearMessages,
    getSettings: getSettings, setSetting: setSetting,
    exportData: exportData, importData: importData,
    wipeMyData: wipeMyData, wipeAllUsers: wipeAllUsers,
    supabaseMode: supabaseMode, syncPull: syncPull, syncPush: syncPush, syncRemove: syncRemove, syncSettings: syncSettings,
    archiveItem: archiveItem, unarchiveItem: unarchiveItem,
    trashItem: trashItem, restoreItem: restoreItem, purgeItem: purgeItem,
    emptyTrash: emptyTrash, purgeAllArchived: purgeAllArchived, archiveStats: archiveStats,
    todayISO: todayISO, parseISO: parseISO, addDays: addDays, daysBetween: daysBetween,
    uid: uid, normEmail: normEmail, emailValid: emailValid, hashPassword: hashPassword
  };
})(window);
