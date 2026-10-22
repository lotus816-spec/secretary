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
  function loadSession() { if (!session) session = readJSON(K_SESSION, null); return session; }

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
        customFields: []
      }
    };
  }
  function defaultSettings() { return defaultData('x').settings; }

  /* ---------------- user CRUD ---------------- */
  function findUserByEmail(email) {
    var u = loadUsers(), e = normEmail(email);
    for (var k in u) { if (u[k] && u[k].email === e) return u[k]; }
    return null;
  }

  function register(opts) {
    opts = opts || {};
    var email = normEmail(opts.email);
    var name = String(opts.name || '').trim();
    var password = String(opts.password || '');

    if (!name) return Promise.reject(new Error('الرجاء إدخال الاسم.'));
    if (!emailValid(email)) return Promise.reject(new Error('صيغة البريد الإلكتروني غير صحيحة.'));
    if (password.length < 6) return Promise.reject(new Error('كلمة المرور يجب ألا تقل عن 6 أحرف.'));
    if (findUserByEmail(email)) return Promise.reject(new Error('هذا البريد مسجّل بالفعل. سجّل الدخول بدلاً من ذلك.'));

    var salt = makeSalt();
    return hashPassword(password, salt).then(function (hash) {
      var all = loadUsers();
      var id = uid('u');
      all[id] = { id: id, name: name, email: email, salt: salt, hash: hash, createdAt: Date.now() };
      writeJSON(K_USERS, all);
      return all[id];
    });
  }

  function login(email, password, remember) {
    var user = findUserByEmail(email);
    if (!user) return Promise.reject(new Error('لا يوجد حساب بهذا البريد الإلكتروني.'));
    return hashPassword(String(password || ''), user.salt).then(function (hash) {
      if (hash !== user.hash) return Promise.reject(new Error('كلمة المرور غير صحيحة.'));
      var s = { userId: user.id, ts: Date.now(), remember: remember !== false };
      writeJSON(K_SESSION, s);
      session = s;
      return user;
    });
  }

  function logout() {
    try { localStorage.removeItem(K_SESSION); } catch (e) { /* ignore */ }
    session = null;
    data = null;
  }

  function currentUser() {
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
      repeat: 'none', createdAt: Date.now(), doneAt: null, remindedAt: null, tags: []
    }, task || {});
    patch(function (d) { d.tasks.push(t); });
    return t;
  }
  function updateTask(id, changes) {
    patch(function (d) {
      for (var i = 0; i < d.tasks.length; i++) {
        if (d.tasks[i].id === id) { d.tasks[i] = Object.assign({}, d.tasks[i], changes); return; }
      }
    });
  }
  function removeTask(id) {
    patch(function (d) {
      d.tasks = d.tasks.filter(function (t) { return t.id !== id; });
    });
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
      lastRenewedAt: null, createdAt: Date.now(), history: []
    }, plan || {});
    patch(function (d) { d.plans.push(p); });
    return p;
  }
  function updatePlan(id, changes) {
    patch(function (d) {
      for (var i = 0; i < d.plans.length; i++) {
        if (d.plans[i].id === id) { d.plans[i] = Object.assign({}, d.plans[i], changes); return; }
      }
    });
  }
  function removePlan(id) {
    patch(function (d) { d.plans = d.plans.filter(function (p) { return p.id !== id; }); });
  }

  /* ---------------- note helpers ---------------- */
  function addNote(note) {
    var n = Object.assign({
      id: uid('n'), title: '', text: '', color: '#1d4ed8', pinned: false, createdAt: Date.now(), updatedAt: Date.now()
    }, note || {});
    patch(function (d) { d.notes.unshift(n); });
    return n;
  }
  function updateNote(id, changes) {
    patch(function (d) {
      for (var i = 0; i < d.notes.length; i++) {
        if (d.notes[i].id === id) {
          d.notes[i] = Object.assign({}, d.notes[i], changes, { updatedAt: Date.now() });
          return;
        }
      }
    });
  }
  function removeNote(id) {
    patch(function (d) { d.notes = d.notes.filter(function (n) { return n.id !== id; }); });
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

  /* ---------------- export ---------------- */
  global.Store = {
    NS: NS,
    on: on,
    emit: emit,
    register: register,
    login: login,
    logout: logout,
    currentUser: currentUser,
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
    todayISO: todayISO, parseISO: parseISO, addDays: addDays, daysBetween: daysBetween,
    uid: uid, normEmail: normEmail, emailValid: emailValid, hashPassword: hashPassword
  };
})(window);
