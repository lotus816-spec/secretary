/* ============================================================
   سكرتاري | Secretary — Application
   Views, scheduling engine, reminders, voice, plans renewal.
   ============================================================ */
(function (global) {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return UI.esc(s); }

  var state = {
    view: 'dashboard',
    dayOffset: 0,
    weekOffset: 0,
    monthOffset: 0,
    dayCat: 'all',
    weekCat: 'all',
    taskQuery: '',
    taskCat: 'all',
    taskStatus: 'all',
    taskSort: 'date',
    taskField: '',
    notesCat: 'all',
    archiveTab: 'archived',
    reminderTimer: null,
    idleTimer: null,
    lastActivity: Date.now(),
    locked: false
  };

  var VIEW_META = {
    dashboard: { title: 'لوحة التحكم', sub: 'نظرة عامة على يومك', icon: 'dash' },
    day: { title: 'اليوم', sub: 'تنظيم اليوم ساعة بساعة', icon: 'day' },
    week: { title: 'الأسبوع', sub: 'توزيع المهام على أيام الأسبوع', icon: 'week' },
    month: { title: 'الشهر', sub: 'رؤية شهرية شاملة', icon: 'month' },
    tasks: { title: 'كل المهام', sub: 'قائمة شاملة قابلة للفلترة', icon: 'tasks' },
    plans: { title: 'الخطط والتجديد', sub: 'متابعة الخطط وتواريخ الانتهاء', icon: 'plans' },
    notes: { title: 'الملاحظات', sub: 'سجلاتك الخاصة', icon: 'notes' },
    archive: { title: 'الأرشيف والسلة', sub: 'استرجع ما حذفته أو أرشفته', icon: 'archive' },
    settings: { title: 'الإعدادات', sub: 'اضبط التطبيق حسب احتياجك', icon: 'settings' }
  };

  /* ==========================================================
     helpers
     ========================================================== */
  function D() { return Store.data || Store.loadData(); }
  function settings() { return Store.getSettings(); }
  /* القوائم النشطة فقط (المحذوفة والمؤرشفة مستبعدة) */
  function active(list) {
    return (list || []).filter(function (x) { return !x.deletedAt && !x.archived; });
  }
  function tasks() { return active((D() && D().tasks) || []); }
  function plans() { return active((D() && D().plans) || []); }
  function notes() { return active((D() && D().notes) || []); }
  function tasksAll() { return (D() && D().tasks) || []; }
  function plansAll() { return (D() && D().plans) || []; }
  function notesAll() { return (D() && D().notes) || []; }
  function messages() { return (D() && D().messages) || []; }
  function today() { return Store.todayISO(); }

  function shiftDate(baseISO, days) { return Store.addDays(baseISO, days); }
  function addMonthsISO(iso, n) {
    var p = String(iso).split('-');
    if (p.length < 3) return iso;
    var day = +p[2];
    var target = new Date(+p[0], (+p[1] - 1) + n, 1);
    var last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(day, last));
    return Store.todayISO(target);
  }
  function advanceDate(iso, cycle) {
    switch (cycle) {
      case 'daily': return shiftDate(iso, 1);
      case 'weekly': return shiftDate(iso, 7);
      case 'biweekly': return shiftDate(iso, 14);
      case 'monthly': return addMonthsISO(iso, 1);
      case 'quarterly': return addMonthsISO(iso, 3);
      case 'yearly': return addMonthsISO(iso, 12);
      default: return iso;
    }
  }
  function cycleLabel(cycle) {
    var m = {
      none: 'لا يتكرر', daily: 'يومي', weekly: 'أسبوعي', biweekly: 'كل أسبوعين',
      monthly: 'شهري', quarterly: 'ربع سنوي', yearly: 'سنوي', once: 'مرة واحدة'
    };
    return m[cycle] || 'لا يتكرر';
  }
  function repeatLabel(rep) {
    var m = { none: '', daily: 'يومي', weekly: 'أسبوعي', biweekly: 'كل أسبوعين', monthly: 'شهري', yearly: 'سنوي' };
    return m[rep] || '';
  }
  function priorityLabel(p) {
    var m = { low: 'منخفضة', med: 'متوسطة', high: 'عالية' };
    return m[p] || 'متوسطة';
  }
  function priorityChip(p) {
    if (p === 'high') return '<span class="chip chip--danger">عالية</span>';
    if (p === 'low') return '<span class="chip chip--ok">منخفضة</span>';
    return '<span class="chip chip--warn">متوسطة</span>';
  }
  function catChip(c) {
    return c === 'work'
      ? '<span class="chip chip--work">' + UI.icon('work') + 'عمل</span>'
      : '<span class="chip chip--personal">' + UI.icon('home') + 'شخصي</span>';
  }
  function isOverdue(t) {
    if (t.status === 'done') return false;
    var tISO = today();
    if (t.date < tISO) return true;
    if (t.date === tISO && t.time) {
      var now = new Date();
      var hh = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      return t.time < hh;
    }
    return false;
  }
  function sortTasks(list) {
    var arr = list.slice();
    var byTime = function (a, b) {
      var ta = a.time || '99:99', tb = b.time || '99:99';
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    };
    arr.sort(function (a, b) {
      switch (state.taskSort) {
        case 'time': return byTime(a, b);
        case 'priority': {
          var rank = { high: 0, med: 1, low: 2 };
          var d = rank[a.priority] - rank[b.priority];
          return d !== 0 ? d : byTime(a, b);
        }
        case 'created': return (b.createdAt || 0) - (a.createdAt || 0);
        default:
          if (a.date !== b.date) return a.date < b.date ? -1 : 1;
          return byTime(a, b);
      }
    });
    return arr;
  }

  /* ==========================================================
     boot / auth
     ========================================================== */
  function init() {
    bindGlobal();
    registerSW();
    restoreCollapse();
    var theme = localStorage.getItem('secretary:v1:theme');
    if (theme) applyTheme(theme, false);

    var user = Store.currentUser();
    if (user) {
      Store.loadData();
      applySettings();
      enterApp(user);
    } else {
      showAuth();
    }
  }

  function showAuth() {
    $('#authScreen').hidden = false;
    $('#appShell').hidden = true;
    $('#lockScreen').hidden = true;
    document.body.classList.add('is-auth');
    document.body.classList.remove('drawer-open');
    switchAuthTab('login');
    var user = Store.currentUser();
    var emailField = $('#loginEmail');
    emailField.disabled = false;
    emailField.value = (user && user.email) ? user.email : '';
    $('#loginPassword').value = '';
    $('#loginError').hidden = true;
    setTimeout(function () { $('#loginPassword').focus(); }, 140);
  }

  function switchAuthTab(which) {
    $$('.auth__tab').forEach(function (b) {
      var on = b.dataset.authtab === which;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('#loginForm').hidden = which === 'signup';
    $('#signupForm').hidden = which !== 'signup';
    var ink = $('.auth__tabs').querySelector('.auth__tabInk');
    if (ink) ink.style.insetInlineStart = which === 'signup' ? 'calc(50% + 1px)' : '5px';
  }

  /* شاشة القفل: مصممة خصيصاً بدل إعادة استخدام نموذج الدخول */
  function showLock() {
    var user = Store.currentUser();
    if (!user) { showAuth(); return; }
    $('#authScreen').hidden = true;
    $('#appShell').hidden = true;
    $('#lockScreen').hidden = false;
    document.body.classList.add('is-auth');
    $('#lockName').textContent = 'مرحباً، ' + (String(user.name || '').split(' ')[0] || 'بك');
    $('#lockEmail').textContent = user.email || '';
    $('#lockAvatar').textContent = UI.initials(user.name);
    $('#lockPassword').value = '';
    $('#lockError').hidden = true;
    setTimeout(function () { $('#lockPassword').focus(); }, 160);
  }

  function unlockApp() {
    var pass = $('#lockPassword').value;
    var user = Store.currentUser();
    var err = $('#lockError');
    err.hidden = true;
    if (!user) { showAuth(); return; }
    if (!pass) { err.textContent = 'أدخل كلمة المرور لفتح التطبيق.'; err.hidden = false; return; }
    var info = Store.sessionInfo();
    var remember = info ? info.persistent : true;
    Store.login(user.email, pass, remember).then(function () {
      $('#lockScreen').hidden = true;
      $('#appShell').hidden = false;
      document.body.classList.remove('is-auth');
      state.locked = false;
      Store.loadData();
      applySettings();
      renderAll();
      resetIdle();
      UI.toast({ type: 'ok', title: 'مرحباً بعودتك', text: 'تم فتح التطبيق.' });
    }).catch(function (ex) {
      err.textContent = ex.message || 'كلمة المرور غير صحيحة.';
      err.hidden = false;
      $('#lockPassword').value = '';
      $('#lockPassword').focus();
    });
  }

  /* تسجيل الخروج */
  function logoutApp(opts) {
    opts = opts || {};
    Store.logout();
    state.locked = false;
    Voice.stop();
    closeSidebar();
    toggleUserMenu(false);
    $('#loginEmail').value = '';
    $('#loginEmail').disabled = false;
    $('#loginPassword').value = '';
    $('#lockScreen').hidden = true;
    showAuth();
    UI.toast({
      type: 'ok', title: 'تم تسجيل الخروج',
      text: opts.everywhere
        ? 'انتهت جلستك. بياناتك تبقى محفوظة على الجهاز.'
        : 'بياناتك تبقى محفوظة على هذا الجهاز.'
    });
  }

  function logoutEverywhere() {
    UI.confirm({
      title: 'خروج من كل الأجهزة', danger: true, confirmLabel: 'تسجيل الخروج',
      text: 'سيتم إنهاء جلستك على هذا الجهاز الآن. لتأمين بقية الجلسات غيّر كلمة المرور من الإعدادات.'
    }).then(function (ok) {
      if (!ok) return;
      logoutApp({ everywhere: true });
    });
  }

  /* نسيت كلمة المرور */
  function forgotPassword() {
    var email = $('#loginEmail').value.trim();
    if (!email) {
      UI.toast({ type: 'warn', title: 'أدخل بريدك الإلكتروني', text: 'اكتب البريد المسجّل ثم حاول مرة أخرى.' });
      $('#loginEmail').focus();
      return;
    }
    if (!Store.supabaseMode()) {
      UI.confirm({
        title: 'استعادة كلمة المرور',
        confirmLabel: 'فهمت',
        text: 'إرسال رابط استعادة عبر البريد يتطلّب ربط Supabase. أمّا الآن فبإمكانك تغيير كلمة المرور من الإعدادات بعد الدخول.'
      });
      return;
    }
    SB.resetPassword(email).then(function () {
      UI.toast({ type: 'ok', title: 'أُرسل رابط الاستعادة', text: 'تحقّق من بريدك الإلكتروني ' + email });
    }).catch(function (e) {
      UI.toast({ type: 'err', title: 'تعذّر الإرسال', text: e.message });
    });
  }

  /* قائمة الحساب */
  function renderUserMenu() {
    var user = Store.currentUser() || {};
    var info = Store.sessionInfo() || {};
    $('#menuName').textContent = user.name || '—';
    $('#menuEmail').textContent = user.email || '—';
    $('#menuAvatar').textContent = UI.initials(user.name);
    $('#topAvatar').textContent = UI.initials(user.name);
    var meta = [];
    meta.push(info.supabase ? 'جلسة عبر Supabase' : 'جلسة محلية على هذا الجهاز');
    if (info.persistent && info.expiresAt) {
      var days = Math.max(0, Math.ceil((info.expiresAt - Date.now()) / 86400000));
      meta.push(days > 0 ? ('تذكّرني — تنتهي بعد ' + days + ' يوم') : 'انتهت صلاحية التذكّر');
    } else {
      meta.push('تنتهي الجلسة عند إغلاق المتصفح');
    }
    if (info.startedAt) meta.push('بدأت الجلسة ' + UI.relTime(info.startedAt));
    $('#menuSession').textContent = meta.join(' • ');
  }
  function toggleUserMenu(force) {
    var m = $('#userMenu');
    if (!m) return;
    var open = (force === undefined) ? m.hidden : !!force;
    m.hidden = !open;
    $('#userBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) renderUserMenu();
  }

  function hideAuth() {
    $('#authScreen').hidden = true;
    $('#lockScreen').hidden = true;
    $('#appShell').hidden = false;
    document.body.classList.remove('is-auth');
  }

  /* يعمل التطبيق دون اتصال عبر Service Worker (عبر http/https فقط) */
  function registerSW() {
    try {
      if (!('serviceWorker' in navigator)) return;
      if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* تجاهل */ });
      });
    } catch (e) { /* ignore */ }
  }

  function enterApp(user) {
    hideAuth();
    state.locked = false;
    Store.loadData();
    applySettings();
    var s = settings();
    $('#userName').textContent = user.name;
    $('#userEmail').textContent = user.email;
    $('#userAvatar').textContent = UI.initials(user.name);
    $('#topAvatar').textContent = UI.initials(user.name);
    $('#setName').value = user.name;
    $('#setEmail').value = user.email;
    renderUserMenu();
    setHash('dashboard');
    renderAll();
    startEngine();
    resetIdle();
    UI.toast({
      type: 'ok', title: 'أهلاً ' + (String(user.name || '').split(' ')[0] || 'بك') + ' 👋',
      text: 'كل بياناتك خاصة بك ومحفوظة على هذا الجهاز.'
    });
  }

  function setHash(v) {
    if (location.hash === '#/' + v) { route(); return; }
    location.hash = '#/' + v;
  }

  /* ==========================================================
     routing
     ========================================================== */
  function route() {
    var v = (location.hash || '#/dashboard').replace('#/', '') || 'dashboard';
    if (!VIEW_META[v]) v = 'dashboard';
    state.view = v;
    $$('.view').forEach(function (s) { s.classList.toggle('is-active', s.id === 'view-' + v); });
    $$('.nav__item').forEach(function (a) { a.classList.toggle('is-active', a.dataset.view === v); });
    var meta = VIEW_META[v];
    $('#viewTitle').textContent = meta.title;
    $('#viewSubtitle').textContent = meta.sub;
    closeSidebar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    render(v);
  }

  /* ==========================================================
     rendering
     ========================================================== */
  function renderAll() {
    renderDashboard();
    renderDay();
    renderWeek();
    renderMonth();
    renderTasks();
    renderPlans();
    renderNotes();
    renderArchive();
    renderSettings();
    renderBadges();
  }
  function render(v) {
    switch (v || state.view) {
      case 'dashboard': renderDashboard(); break;
      case 'day': renderDay(); break;
      case 'week': renderWeek(); break;
      case 'month': renderMonth(); break;
      case 'tasks': renderTasks(); break;
      case 'plans': renderPlans(); break;
      case 'notes': renderNotes(); break;
      case 'archive': renderArchive(); break;
      case 'settings': renderSettings(); break;
    }
    renderBadges();
  }

  function renderBadges() {
    var t = today();
    var due = tasks().filter(function (x) { return x.status !== 'done' && x.date <= t; }).length;
    $('#navBadgeDay').textContent = due ? due : '';
    $('#navBadgeTasks').textContent = tasks().filter(function (x) { return x.status !== 'done'; }).length || '';

    var soon = plans().filter(function (p) {
      if (p.status !== 'active') return false;
      var d = Store.daysBetween(t, p.expiryDate);
      return d <= 14;
    }).length;
    $('#navBadgePlans').textContent = soon ? soon : '';

    var unread = messages().filter(function (m) { return !m.read; }).length;
    $('#bellDot').hidden = !unread;

    var ast = Store.archiveStats();
    var archCount = ast.archived + ast.trashed;
    $('#navBadgeArchive').textContent = archCount ? archCount : '';
  }

  /* ---------------- dashboard ---------------- */
  function renderDashboard() {
    var t = today();
    var all = tasks();
    var todays = all.filter(function (x) { return x.date === t; });
    var doneToday = todays.filter(function (x) { return x.status === 'done'; });
    var overdue = all.filter(isOverdue);
    var activePlans = plans().filter(function (p) { return p.status === 'active'; });

    var hour = new Date().getHours();
    var greet = hour < 12 ? 'صباح الخير' : hour < 17 ? 'طاب يومك' : 'مساء الخير';
    var user = Store.currentUser() || { name: '' };
    $('#heroKicker').textContent = UI.fmtDate(t, { weekday: true });
    $('#heroTitle').textContent = greet + '، ' + (user.name.split(' ')[0] || 'بك');
    $('#heroSub').textContent = todays.length
      ? 'لديك ' + todays.length + ' ' + UI.plural(todays.length, 'مهمة', 'مهمتان', 'مهام', 'مهمة') + ' اليوم، أُنجزت ' + doneToday.length + ' منها.'
      : 'لا توجد مهام مجدولة اليوم — وقت مناسب لالتقاط راحة أو تخطيط الغد.';

    // stat cards
    var stats = [
      { icon: 'day', cls: '', label: 'مهام اليوم', value: todays.length },
      { icon: 'check', cls: 'stat__ico--teal', label: 'منجزة اليوم', value: doneToday.length },
      { icon: 'flame', cls: 'stat__ico--rose', label: 'مهام متأخرة', value: overdue.length },
      { icon: 'plans', cls: 'stat__ico--violet', label: 'خطط نشطة', value: activePlans.length }
    ];
    if (overdue.length) stats[2].cls = 'stat__ico--rose';
    $('#statsGrid').innerHTML = stats.map(function (s) {
      return '<div class="stat"><div class="stat__ico ' + s.cls + '">' + UI.icon(s.icon) + '</div>' +
        '<div><div class="stat__val">' + s.value + '</div><div class="stat__label">' + s.label + '</div></div></div>';
    }).join('');

    // messages
    var msgs = messages().slice(0, 8);
    $('#msgCount').textContent = messages().length;
    var ml = $('#msgList');
    if (!msgs.length) {
      ml.innerHTML = '<div class="empty">' + UI.icon('bell') + '<b>لا توجد رسائل بعد</b><span>ستظهر هنا تنبيهات مهامك ورسائل سكرتاري.</span></div>';
    } else {
      ml.innerHTML = msgs.map(function (m) {
        var ic = m.kind === 'done' ? 'check' : m.kind === 'plan' ? 'plans' : m.kind === 'work' ? 'work' : 'bell';
        return '<div class="msg msg--' + esc(m.kind || 'info') + '">' +
          '<div class="msg__ico">' + UI.icon(ic) + '</div>' +
          '<div class="msg__body">' +
          '<div class="msg__title">' + esc(m.title) + '</div>' +
          '<div class="msg__meta">' + esc(m.text || '') + ' · ' + UI.relTime(m.ts) + '</div>' +
          '<div class="msg__acts">' +
          '<button class="btn btn--soft btn--sm" data-msg-read="' + m.id + '">' + UI.icon('speak') + 'اقرأ</button>' +
          (m.taskId ? '<button class="btn btn--soft btn--sm" data-msg-done="' + m.taskId + '">تم</button>' : '') +
          '</div></div></div>';
      }).join('');
    }

    // agenda
    var agenda = todays.slice().sort(function (a, b) {
      var ta = a.time || '99:99', tb = b.time || '99:99';
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
    var al = $('#agendaToday');
    if (!agenda.length) {
      al.innerHTML = '<div class="empty">' + UI.icon('day') + '<b>لا مواعيد اليوم</b><span>أضف مهمة لتظهر في جدولك.</span></div>';
    } else {
      al.innerHTML = agenda.slice(0, 7).map(function (x) {
        return '<div class="mini" style="cursor:pointer" data-open-task="' + x.id + '">' +
          '<div class="mini__ico ' + (x.status === 'done' ? 'mini--ok' : x.category) + '">' + UI.icon(x.status === 'done' ? 'check' : 'clock') + '</div>' +
          '<div class="mini__body"><div class="mini__title">' + esc(x.title) + '</div>' +
          '<div class="mini__meta">' + (x.time ? UI.fmtTime(x.time) : 'بدون وقت') + ' · ' + (x.category === 'work' ? 'عمل' : 'شخصي') + '</div></div>' +
          '</div>';
      }).join('');
    }

    // plan mini list + chart
    var sorted = activePlans.slice().sort(function (a, b) { return a.expiryDate < b.expiryDate ? -1 : 1; });
    $('#planMiniList').innerHTML = sorted.length ? sorted.slice(0, 4).map(planMiniHTML).join('')
      : '<div class="empty">' + UI.icon('plans') + '<b>لا توجد خطط</b><span>أضف خطة لتتابع انتهاء صلاحيتها.</span></div>';
    drawPlanBars($('#planChart'), sorted.slice(0, 6));

    // weekly performance donut
    var week = weekRange(state.weekOffset);
    var weekTasks = all.filter(function (x) { return x.date >= week.start && x.date <= week.end; });
    var wDone = weekTasks.filter(function (x) { return x.status === 'done'; }).length;
    var wTodo = weekTasks.length - wDone;
    var wOver = weekTasks.filter(isOverdue).length;
    Charts.donut($('#weekChart'), [
      { label: 'منجزة', value: wDone, color: Charts.theme().green },
      { label: 'قيد التنفيذ', value: wTodo, color: Charts.theme().brand },
      { label: 'متأخرة', value: wOver, color: Charts.theme().rose }
    ], { centerValue: wDone, centerLabel: 'منجزة هذا الأسبوع' });
    $('#weekLegend').innerHTML = legendHTML([
      { label: 'منجزة', value: wDone, color: Charts.theme().green },
      { label: 'قيد التنفيذ', value: wTodo, color: Charts.theme().brand },
      { label: 'متأخرة', value: wOver, color: Charts.theme().rose }
    ]);
  }

  function legendHTML(items) {
    return items.map(function (i) {
      return '<span class="legendItem"><i style="background:' + i.color + '"></i>' + esc(i.label) +
        ' <b>' + i.value + '</b></span>';
    }).join('');
  }

  function planMiniHTML(p) {
    var d = Store.daysBetween(today(), p.expiryDate);
    var cls = d < 0 ? 'mini--danger' : d <= 7 ? 'mini--warn' : 'mini--ok';
    return '<div class="mini ' + cls + '" data-open-plan="' + p.id + '" style="cursor:pointer">' +
      '<div class="mini__ico">' + UI.icon('plans') + '</div>' +
      '<div class="mini__body"><div class="mini__title">' + esc(p.title) + '</div>' +
      '<div class="mini__meta">' + UI.daysLabel(d) + ' · ' + UI.fmtDate(p.expiryDate, { year: false }) + '</div></div>' +
      '</div>';
  }

  function drawPlanBars(canvas, list) {
    if (!canvas) return;
    var th = Charts.theme();
    var items = list.map(function (p) {
      var d = Store.daysBetween(today(), p.expiryDate);
      var color = d < 0 ? th.rose : d <= 7 ? th.amber : d <= 30 ? th.brand : th.green;
      return {
        label: p.title,
        value: Math.max(0, d),
        valueText: d < 0 ? 'منتهٍ' : d === 0 ? 'اليوم' : d + ' يوم',
        color: color
      };
    });
    Charts.bars(canvas, items, { emptyText: 'لا توجد خطط نشطة' });
  }

  /* ---------------- day ---------------- */
  function dayDate(offset) { return shiftDate(today(), offset); }

  function renderDay() {
    var iso = dayDate(state.dayOffset);
    $('#dayTitle').textContent = state.dayOffset === 0 ? 'اليوم' : UI.fmtDate(iso, { weekday: true });
    $('#daySub').textContent = UI.fmtDate(iso, { weekday: true }) + ' · ' + tasksOn(iso).length + ' مهمة';

    var list = tasksOn(iso).filter(function (x) { return state.dayCat === 'all' || x.category === state.dayCat; });
    list = list.slice().sort(function (a, b) {
      if (a.status !== b.status) return a.status === 'done' ? 1 : -1;
      var ta = a.time || '99:99', tb = b.time || '99:99';
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });

    var tl = $('#dayTimeline');
    if (!list.length) {
      tl.innerHTML = '<div class="empty">' + UI.icon('day') + '<b>لا مهام في هذا اليوم</b><span>اضغط «مهمة» لإضافة جديد.</span></div>';
      return;
    }
    tl.innerHTML = list.map(function (t) {
      var over = isOverdue(t);
      return '<div class="tlRow ' + (t.status === 'done' ? 'is-done' : '') + (over ? ' is-overdue' : '') +
        ' tlRow--' + t.category + '">' +
        '<div class="tlRow__time">' + (t.time ? t.time : '—') + '<small>' + (t.time ? 'ص/م' : 'مرن') + '</small></div>' +
        '<div class="tlRow__line"><i></i></div>' +
        '<div class="tlRow__card">' +
        '<button class="tick ' + (t.status === 'done' ? 'is-on' : '') + '" data-toggle="' + t.id + '" aria-label="إنجاز">' + UI.icon('check') + '</button>' +
        '<div style="min-width:0;flex:1">' +
        '<div class="tlRow__title">' + esc(t.title) + '</div>' +
        '<div class="tlRow__sub">' + catChip(t.category) + priorityChip(t.priority) +
        (t.repeat && t.repeat !== 'none' ? '<span class="chip">' + UI.icon('repeat') + repeatLabel(t.repeat) + '</span>' : '') +
        (t.notes ? '<span class="chip" title="' + esc(t.notes) + '">' + UI.icon('notes') + 'ملاحظة</span>' : '') +
        (over ? '<span class="chip chip--danger">متأخرة</span>' : '') +
        fieldChips(t) +
        '</div></div>' +
        '<div class="tlRow__acts">' +
        '<button class="iconBtn" data-speak="' + t.id + '" title="اقرأ بصوت">' + UI.icon('speak') + '</button>' +
        '<button class="iconBtn" data-send-group="' + t.id + '" title="تنبيه أولياء الأمور">' + UI.icon('group') + '</button>' +
        '<button class="iconBtn" data-archive-task="' + t.id + '" title="أرشفة">' + UI.icon('archive') + '</button>' +
        '<button class="iconBtn" data-edit="' + t.id + '" title="تعديل">' + UI.icon('edit') + '</button>' +
        '<button class="iconBtn" data-del="' + t.id + '" title="حذف">' + UI.icon('trash') + '</button>' +
        '</div></div></div>';
    }).join('');
  }

  function tasksOn(iso) {
    return tasks().filter(function (t) { return t.date === iso; });
  }

  /* ---------------- week ---------------- */
  function weekRange(offset) {
    var startDow = settings().weekStart === undefined ? 6 : settings().weekStart;
    var base = shiftDate(today(), (offset || 0) * 7);
    var d = Store.parseISO(base);
    var diff = (d.getDay() - startDow + 7) % 7;
    var start = shiftDate(base, -diff);
    return { start: start, end: shiftDate(start, 6), startDow: startDow };
  }

  function renderWeek() {
    var r = weekRange(state.weekOffset);
    $('#weekTitle').textContent = UI.fmtDate(r.start, { year: false }) + ' — ' + UI.fmtDate(r.end, { year: false });
    $('#weekSub').textContent = UI.fmtDate(r.start, { weekday: true }) + ' إلى ' + UI.fmtDate(r.end, { weekday: true });

    var days = [];
    for (var i = 0; i < 7; i++) days.push(shiftDate(r.start, i));

    var html = days.map(function (iso) {
      var list = tasksOn(iso).filter(function (x) { return state.weekCat === 'all' || x.category === state.weekCat; });
      var isToday = iso === today();
      return '<div class="wkCol ' + (isToday ? 'is-today' : '') + '" data-day="' + iso + '">' +
        '<div class="wkCol__head"><span class="wkCol__day">' + UI.weekdayName(iso) + '</span>' +
        '<span class="wkCol__num">' + Store.parseISO(iso).getDate() + '</span></div>' +
        '<div class="wkCol__items">' +
        (list.length ? list.map(function (t) {
          return '<div class="wkItem wkItem--' + t.category + (t.status === 'done' ? ' wkItem--done' : '') +
            '" data-open-task="' + t.id + '">' + esc(t.title) + (t.time ? '<time>' + t.time + '</time>' : '') + '</div>';
        }).join('') : '<div style="font-size:11.5px;color:var(--muted-2);padding:6px 2px">—</div>') +
        '</div></div>';
    }).join('');
    $('#weekGrid').innerHTML = html;

    var load = days.map(function (iso) {
      var list = tasksOn(iso);
      var done = list.filter(function (t) { return t.status === 'done'; }).length;
      return {
        label: UI.weekdayName(iso, true),
        value: list.length,
        color: list.length ? (done === list.length ? Charts.theme().green : Charts.theme().brand) : Charts.theme().grid
      };
    });
    Charts.columns($('#weekLoadChart'), load, {});
  }

  /* ---------------- month ---------------- */
  function monthRange(offset) {
    var now = new Date();
    var first = new Date(now.getFullYear(), now.getMonth() + (offset || 0), 1);
    var last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    return { first: first, last: last, y: first.getFullYear(), m: first.getMonth() };
  }

  function renderMonth() {
    var r = monthRange(state.monthOffset);
    $('#monthTitle').textContent = UI.MONTHS_AR[r.m] + ' ' + r.y;
    $('#monthSub').textContent = UI.fmtDate(Store.todayISO(r.first), { year: false }) + ' — ' + UI.fmtDate(Store.todayISO(r.last), { year: false });

    var startDow = settings().weekStart === undefined ? 6 : settings().weekStart;
    var firstDow = r.first.getDay();
    var lead = (firstDow - startDow + 7) % 7;

    var html = '';
    for (var d = 0; d < startDow; d++) {
      html += '<div class="cal__cell is-out"></div>';
    }
    var monthTasks = [];
    for (var day = 1; day <= r.last.getDate(); day++) {
      var iso = r.y + '-' + String(r.m + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      var list = tasksOn(iso);
      monthTasks = monthTasks.concat(list);
      var planHere = plans().filter(function (p) { return p.expiryDate === iso; });
      var isToday = iso === today();
      html += '<div class="cal__cell ' + (isToday ? 'is-today' : '') + '" data-day="' + iso + '">' +
        '<div class="cal__num">' + day + '</div>';
      list.slice(0, 3).forEach(function (t) {
        html += '<div class="cal__ev cal__ev--' + t.category + (t.status === 'done' ? ' cal__ev--done' : '') +
          '" data-open-task="' + t.id + '" title="' + esc(t.title) + '">' + esc(t.title) + '</div>';
      });
      if (list.length > 3) html += '<div class="cal__more">+' + (list.length - 3) + ' أخرى</div>';
      planHere.forEach(function (p) {
        html += '<div class="cal__ev cal__ev--plan" data-open-plan="' + p.id + '" title="نهاية صلاحية: ' + esc(p.title) + '">' +
          UI.icon('flag') + ' ' + esc(p.title) + '</div>';
      });
      html += '</div>';
    }
    $('#calendar').innerHTML = html;

    // deadlines this month
    var dl = plans().filter(function (p) {
      return p.expiryDate >= Store.todayISO(r.first) && p.expiryDate <= Store.todayISO(r.last);
    }).sort(function (a, b) { return a.expiryDate < b.expiryDate ? -1 : 1; });
    $('#monthDeadlines').innerHTML = dl.length ? dl.map(function (p) {
      var d = Store.daysBetween(today(), p.expiryDate);
      var cls = d < 0 ? 'mini--danger' : d <= 7 ? 'mini--warn' : 'mini--ok';
      return '<div class="mini ' + cls + '"><div class="mini__ico">' + UI.icon('flag') + '</div>' +
        '<div class="mini__body"><div class="mini__title">' + esc(p.title) + '</div>' +
        '<div class="mini__meta">' + UI.fmtDate(p.expiryDate, { weekday: true }) + ' · ' + UI.daysLabel(d) + '</div></div></div>';
    }).join('') : '<div class="empty">' + UI.icon('flag') + '<b>لا نهايات هذا الشهر</b></div>';

    var done = monthTasks.filter(function (t) { return t.status === 'done'; }).length;
    var todo = monthTasks.length - done;
    var work = monthTasks.filter(function (t) { return t.category === 'work'; }).length;
    var personal = monthTasks.length - work;
    Charts.donut($('#monthChart'), [
      { label: 'منجزة', value: done, color: Charts.theme().green },
      { label: 'عمل', value: work, color: Charts.theme().violet },
      { label: 'شخصي', value: personal, color: Charts.theme().teal }
    ], { centerValue: monthTasks.length, centerLabel: 'مهمة في الشهر' });
    $('#monthLegend').innerHTML = legendHTML([
      { label: 'منجزة', value: done, color: Charts.theme().green },
      { label: 'عمل', value: work, color: Charts.theme().violet },
      { label: 'شخصي', value: personal, color: Charts.theme().teal }
    ]);
  }

  /* ---------------- tasks ---------------- */
  function renderTasks() {
    renderFieldFilter();
    var q = state.taskQuery.trim().toLowerCase();
    var list = tasks().filter(function (t) {
      if (state.taskCat !== 'all' && t.category !== state.taskCat) return false;
      if (state.taskStatus === 'todo' && t.status === 'done') return false;
      if (state.taskStatus === 'done' && t.status !== 'done') return false;
      if (state.taskStatus === 'overdue' && !isOverdue(t)) return false;
      if (state.taskField) {
        var parts = state.taskField.split('::');
        var fv = (t.fields || {})[parts[0]];
        if (fv !== parts[1]) return false;
      }
      if (q) {
        var hay = (t.title + ' ' + (t.notes || '') + ' ' + (t.date || '') + ' ' + (t.category) + ' ' + JSON.stringify(t.fields || {})).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    list = sortTasks(list);

    var body = $('#taskTableBody');
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="9"><div class="empty">' + UI.icon('tasks') +
        '<b>لا توجد مهام مطابقة</b><span>جرّب تغيير عوامل التصفية أو أضف مهمة جديدة.</span></div></td></tr>';
    } else {
      body.innerHTML = list.map(function (t) {
        var over = isOverdue(t);
        return '<tr data-row="' + t.id + '">' +
          '<td><button class="tick ' + (t.status === 'done' ? 'is-on' : '') + '" data-toggle="' + t.id + '">' + UI.icon('check') + '</button></td>' +
          '<td><div class="table__title">' + esc(t.title) +
          (t.notes ? '<small>' + esc(t.notes) + '</small>' : '') +
          (fieldChips(t) ? '<span class="table__fields">' + fieldChips(t) + '</span>' : '') +
          '</div></td>' +
          '<td>' + catChip(t.category) + '</td>' +
          '<td class="ltr">' + UI.fmtDate(t.date, { year: false }) + (over ? ' <span class="chip chip--danger">متأخرة</span>' : '') + '</td>' +
          '<td class="ltr">' + (t.time ? t.time : '—') + '</td>' +
          '<td>' + priorityChip(t.priority) + '</td>' +
          '<td>' + (t.repeat && t.repeat !== 'none' ? '<span class="chip">' + UI.icon('repeat') + repeatLabel(t.repeat) + '</span>' : '<span style="color:var(--muted-2)">—</span>') + '</td>' +
          '<td>' + (t.status === 'done' ? '<span class="chip chip--ok">منجزة</span>' : '<span class="chip">قيد التنفيذ</span>') + '</td>' +
          '<td><div class="table__acts">' +
          '<button class="iconBtn" data-speak="' + t.id + '" title="اقرأ">' + UI.icon('speak') + '</button>' +
          '<button class="iconBtn" data-send-group="' + t.id + '" title="تنبيه أولياء الأمور">' + UI.icon('group') + '</button>' +
          '<button class="iconBtn" data-archive-task="' + t.id + '" title="أرشفة">' + UI.icon('archive') + '</button>' +
          '<button class="iconBtn" data-edit="' + t.id + '" title="تعديل">' + UI.icon('edit') + '</button>' +
          '<button class="iconBtn" data-del="' + t.id + '" title="حذف">' + UI.icon('trash') + '</button>' +
          '</div></td></tr>';
      }).join('');
    }
    $('#taskCount').textContent = list.length + ' ' + UI.plural(list.length, 'مهمة', 'مهمتان', 'مهام', 'مهمة') +
      (q ? ' (بحث: ' + state.taskQuery + ')' : '');
  }

  /* ---------------- plans ---------------- */
  function renderPlans() {
    var list = plans().slice().sort(function (a, b) { return a.expiryDate < b.expiryDate ? -1 : 1; });
    var active = list.filter(function (p) { return p.status === 'active'; });
    var urgent = active.filter(function (p) { return Store.daysBetween(today(), p.expiryDate) <= 14; });
    var expired = list.filter(function (p) { return p.status !== 'active'; });
    var autoRenew = active.filter(function (p) { return p.autoRenew; }).length;

    $('#planStats').innerHTML = [
      { icon: 'plans', cls: '', label: 'خطط نشطة', value: active.length },
      { icon: 'flame', cls: 'stat__ico--amber', label: 'تنتهي خلال ١٤ يوماً', value: urgent.length },
      { icon: 'repeat', cls: 'stat__ico--teal', label: 'تجديد تلقائي مفعّل', value: autoRenew },
      { icon: 'x', cls: 'stat__ico--rose', label: 'خطط منتهية', value: expired.length }
    ].map(function (s) {
      return '<div class="stat"><div class="stat__ico ' + s.cls + '">' + UI.icon(s.icon) + '</div>' +
        '<div><div class="stat__val">' + s.value + '</div><div class="stat__label">' + s.label + '</div></div></div>';
    }).join('');

    drawPlanBars($('#plansChart'), active);

    $('#plansLegend').innerHTML = legendHTML([
      { label: 'أكثر من ٣٠ يوماً', value: active.filter(function (p) { return Store.daysBetween(today(), p.expiryDate) > 30; }).length, color: Charts.theme().green },
      { label: 'خلال ٧ أيام', value: active.filter(function (p) { var d = Store.daysBetween(today(), p.expiryDate); return d >= 0 && d <= 7; }).length, color: Charts.theme().amber },
      { label: 'منتهية', value: active.filter(function (p) { return Store.daysBetween(today(), p.expiryDate) < 0; }).length, color: Charts.theme().rose }
    ]);

    $('#plansUrgent').innerHTML = urgent.length ? urgent.map(planMiniHTML).join('')
      : '<div class="empty">' + UI.icon('check') + '<b>لا شيء يحتاج تجديداً الآن</b></div>';

    if (!list.length) {
      $('#planGrid').innerHTML = '<div class="empty">' + UI.icon('plans') +
        '<b>لا توجد خطط بعد</b><span>أضف خطة (اشتراك، شهادة، عقد) ليذكّرك سكرتاري قبل انتهاء صلاحيتها.</span></div>';
      return;
    }

    $('#planGrid').innerHTML = list.map(function (p) {
      var d = Store.daysBetween(today(), p.expiryDate);
      var cls = p.status !== 'active' ? 'planCard--expired' : d < 0 ? 'planCard--danger' : d <= 7 ? 'planCard--warn' : d <= 30 ? '' : 'planCard--ok';
      var span = 1;
      if (p.startDate && p.expiryDate) {
        var total = Math.max(1, Store.daysBetween(p.startDate, p.expiryDate));
        span = Math.max(0.03, Math.min(1, 1 - (d / total)));
      }
      return '<div class="planCard ' + cls + '">' +
        '<div class="planCard__head">' +
        '<div class="planCard__ico">' + UI.icon(p.category === 'work' ? 'work' : 'home') + '</div>' +
        '<div style="flex:1;min-width:0">' +
        '<div class="planCard__title">' + esc(p.title) + '</div>' +
        '<div class="planCard__meta">' + (p.category === 'work' ? 'عمل' : 'شخصي') +
        ' · ' + cycleLabel(p.cycle) + (p.cost ? ' · ' + p.cost + ' ر.س' : '') + '</div>' +
        '</div>' +
        (p.autoRenew ? '<span class="chip chip--ok" title="تجديد تلقائي">' + UI.icon('repeat') + 'تلقائي</span>' : '') +
        '</div>' +
        '<div class="planCard__bar"><i style="width:' + (span * 100).toFixed(1) + '%"></i></div>' +
        '<div class="planCard__foot">' +
        '<div><strong style="font-size:13px">' + UI.daysLabel(d) + '</strong>' +
        '<div style="font-size:11.5px;color:var(--muted)">ينتهي في ' + UI.fmtDate(p.expiryDate) + '</div></div>' +
        '<div class="planCard__acts">' +
        '<button class="btn btn--soft btn--sm" data-renew="' + p.id + '">' + UI.icon('repeat') + 'جدّد</button>' +
        '<button class="iconBtn" data-speak-plan="' + p.id + '" title="اقرأ">' + UI.icon('speak') + '</button>' +
        '<button class="iconBtn" data-send-group-plan="' + p.id + '" title="تنبيه أولياء الأمور">' + UI.icon('group') + '</button>' +
        '<button class="iconBtn" data-archive-plan="' + p.id + '" title="أرشفة">' + UI.icon('archive') + '</button>' +
        '<button class="iconBtn" data-edit-plan="' + p.id + '" title="تعديل">' + UI.icon('edit') + '</button>' +
        '<button class="iconBtn" data-del-plan="' + p.id + '" title="حذف">' + UI.icon('trash') + '</button>' +
        '</div></div>' +
        (p.note ? '<div style="font-size:12px;color:var(--muted);border-top:1px solid var(--border);padding-top:9px">' + esc(p.note) + '</div>' : '') +
        '</div>';
    }).join('');
  }

  /* ---------------- notes ---------------- */
  function renderNotes() {
    var list = notes().slice().sort(function (a, b) {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    var g = $('#notesGrid');
    if (!list.length) {
      g.innerHTML = '<div class="empty">' + UI.icon('notes') +
        '<b>لا توجد ملاحظات</b><span>سجّل أفكارك هنا — تبقى خاصة بك ولا يراها أحد.</span></div>';
      return;
    }
    g.innerHTML = list.map(function (n) {
      return '<div class="noteCard ' + (n.pinned ? 'noteCard--pinned' : '') + '" style="--noteColor:' + esc(n.color || '#1d4ed8') + '">' +
        '<div class="noteCard__title">' + (n.pinned ? UI.icon('flag') + ' ' : '') + esc(n.title || 'بدون عنوان') + '</div>' +
        '<div class="noteCard__text">' + esc(n.text || '') + '</div>' +
        '<div class="noteCard__foot"><span class="noteCard__time">' + UI.relTime(n.updatedAt || n.createdAt) + '</span>' +
        '<div class="rowActions">' +
        '<button class="iconBtn" data-speak-note="' + n.id + '" title="اقرأ بصوت">' + UI.icon('speak') + '</button>' +
        '<button class="iconBtn" data-pin-note="' + n.id + '" title="تثبيت">' + UI.icon('flag') + '</button>' +
        '<button class="iconBtn" data-archive-note="' + n.id + '" title="أرشفة">' + UI.icon('archive') + '</button>' +
        '<button class="iconBtn" data-edit-note="' + n.id + '" title="تعديل">' + UI.icon('edit') + '</button>' +
        '<button class="iconBtn" data-del-note="' + n.id + '" title="حذف">' + UI.icon('trash') + '</button>' +
        '</div></div></div>';
    }).join('');
  }

  /* ---------------- settings ---------------- */
  function renderSettings() {
    var s = settings();
    var user = Store.currentUser() || {};
    $('#setName').value = user.name || '';
    $('#setEmail').value = user.email || '';
    $('#setRate').value = s.rate; $('#rateVal').textContent = Number(s.rate).toFixed(1);
    $('#setPitch').value = s.pitch; $('#pitchVal').textContent = Number(s.pitch).toFixed(1);
    $('#setArabicNumbers').checked = !!s.arabicNumbers;
    $('#setDigest').checked = !!s.digest;
    $('#setAutoLock').checked = !!s.autoLock;
    $('#setLead').value = s.lead; $('#leadVal').textContent = s.lead;
    $('#setDark').checked = document.documentElement.getAttribute('data-theme') === 'dark';
    $('#setWeekStart').value = s.weekStart === undefined ? 6 : s.weekStart;

    // voices
    var sel = $('#setVoice');
    var list = Voice.list();
    var vSig = s.voiceURI + '|' + list.map(function (v) { return v.voiceURI; }).join(',');
    if (sel.dataset.sig !== vSig) {
      sel.dataset.sig = vSig;
      sel.innerHTML = '<option value="">— تلقائي (أفضل صوت متاح) —</option>' +
        list.map(function (v) {
          return '<option value="' + esc(v.voiceURI) + '"' + (v.voiceURI === s.voiceURI ? ' selected' : '') + '>' +
            esc(v.name) + ' (' + esc(v.lang) + ')' + (v.default ? ' ★' : '') + '</option>';
        }).join('');
    }
    sel.value = s.voiceURI || '';
    $('#voiceCount').textContent = list.length ? list.length + ' صوت متاح' : 'لا توجد أصوات متاحة — استخدم Chrome أو Edge';

    // notifications
    var nState = 'غير مفعّلة';
    if ('Notification' in global) {
      if (Notification.permission === 'granted') nState = 'مفعّلة ✓';
      else if (Notification.permission === 'denied') nState = 'مرفوضة من المتصفح';
      else nState = 'غير مفعّلة';
    } else nState = 'غير مدعومة في هذا المتصفح';
    $('#notifState').textContent = nState;
    $('#notifBtn').textContent = Notification && Notification.permission === 'granted' ? 'مفعّلة' : 'تفعيل';

    renderCustomFields();
    renderFieldFilter();
    renderWhatsAppSettings();
    renderParentsSettings();
    renderSupabaseSettings();
    renderSessionCard();
  }

  /* بطاقة الجلسة في الإعدادات */
  function renderSessionCard() {
    var info = Store.sessionInfo();
    var el = $('#sessionState'), chip = $('#sessionChip');
    if (!el || !chip) return;
    if (!info) {
      el.textContent = 'لا توجد جلسة نشطة';
      chip.textContent = 'غير نشط';
      chip.className = 'chip chip--danger';
      return;
    }
    var txt = info.supabase ? 'جلسة عبر Supabase' : 'جلسة محلية على هذا الجهاز';
    if (info.persistent && info.expiresAt) {
      var days = Math.max(0, Math.ceil((info.expiresAt - Date.now()) / 86400000));
      txt += ' • تذكّرني — تنتهي بعد ' + days + ' يوم';
    } else {
      txt += ' • تنتهي عند إغلاق المتصفح';
    }
    txt += ' • بدأت ' + UI.relTime(info.startedAt);
    el.textContent = txt;
    chip.textContent = 'نشط';
    chip.className = 'chip chip--ok';
  }

  /* قائمة تصفية المهام حسب الحقول المخصصة */
  function renderFieldFilter() {
    var sel = $('#taskFieldFilter');
    if (!sel) return;
    var fields = customFields();
    var opts = '<option value="">كل الحقول</option>';
    fields.forEach(function (f) {
      var vals = [];
      tasks().forEach(function (t) {
        var v = (t.fields || {})[f.id];
        if (v && vals.indexOf(v) === -1) vals.push(v);
      });
      vals.forEach(function (v) {
        opts += '<option value="' + esc(f.id + '::' + v) + '">' + esc(f.name + ': ' + v) + '</option>';
      });
    });
    /* لا نعيد بناء القائمة إلا عند تغيّر محتواها — حتى لا تُغلق أثناء فتحها */
    var sig = opts;
    if (sel.dataset.sig === sig) {
      sel.hidden = !fields.length;
      if (state.taskField) sel.value = state.taskField;
      return;
    }
    sel.dataset.sig = sig;
    sel.innerHTML = opts;
    sel.hidden = !fields.length;
    if (state.taskField) sel.value = state.taskField;
    else { state.taskField = ''; sel.value = ''; }
  }

  /* ==========================================================
     task modal
     ========================================================== */
  function taskModal(task) {
    var t = task || {
      title: '', notes: '', date: defaultTaskDate(), time: '', duration: 30,
      category: 'personal', priority: 'med', status: 'todo', reminder: true, repeat: 'none'
    };
    var body = document.createElement('div');
    body.innerHTML =
      '<div class="field"><label>عنوان المهمة</label>' +
      '<div class="field__ctrl"><input id="fTitle" type="text" value="' + UI.esc(t.title) + '" placeholder="مثال: اجتماع فريق المشروع"></div></div>' +

      '<div class="field"><label>ملاحظات إضافية</label>' +
      '<textarea class="input" id="fNotes" placeholder="تفاصيل، روابط، أسماء...">' + UI.esc(t.notes || '') + '</textarea></div>' +

      '<div class="modal__grid">' +
      '<div class="field"><label>النوع</label><div class="catPicker" id="fCat">' +
      '<label class="catOpt catOpt--work' + (t.category === 'work' ? ' is-on' : '') + '" data-val="work">' +
      '<input type="radio" name="fcat" value="work"' + (t.category === 'work' ? ' checked' : '') + '>' + UI.icon('work') + 'عمل</label>' +
      '<label class="catOpt catOpt--personal' + (t.category === 'personal' ? ' is-on' : '') + '" data-val="personal">' +
      '<input type="radio" name="fcat" value="personal"' + (t.category === 'personal' ? ' checked' : '') + '>' + UI.icon('home') + 'شخصي</label>' +
      '</div></div>' +

      '<div class="field"><label>الأولوية</label><div class="optRow" id="fPriority">' +
      optChip('low', 'منخفضة', t.priority) + optChip('med', 'متوسطة', t.priority) + optChip('high', 'عالية', t.priority) +
      '</div></div>' +

      '<div class="field"><label>التاريخ</label><input class="input ltr" id="fDate" type="date" value="' + UI.esc(t.date) + '"></div>' +
      '<div class="field"><label>الوقت</label><input class="input ltr" id="fTime" type="time" value="' + UI.esc(t.time || '') + '"></div>' +

      '<div class="field"><label>المدة (دقائق)</label><input class="input ltr" id="fDuration" type="number" min="5" step="5" value="' + (t.duration || 30) + '"></div>' +
      '<div class="field"><label>التكرار</label><select class="select" id="fRepeat">' +
      ['none', 'daily', 'weekly', 'biweekly', 'monthly', 'yearly'].map(function (r) {
        return '<option value="' + r + '"' + (t.repeat === r ? ' selected' : '') + '>' + cycleLabel(r) + '</option>';
      }).join('') + '</select></div>' +
      '</div>' +

      '<div class="setRow" style="border-top:1px solid var(--border)">' +
      '<div><strong>تذكير في الوقت المحدّد</strong><small>سيصلك تنبيه صوتي ومرئي عند الموعد</small></div>' +
      '<label class="switch"><input type="checkbox" id="fReminder"' + (t.reminder !== false ? ' checked' : '') + '><i></i></label>' +
      '</div>' +
      '<div class="setRow">' +
      '<div><strong>الحالة</strong><small>قيد التنفيذ أو منجزة</small></div>' +
      '<select class="select" id="fStatus" style="max-width:150px">' +
      '<option value="todo"' + (t.status === 'todo' ? ' selected' : '') + '>قيد التنفيذ</option>' +
      '<option value="done"' + (t.status === 'done' ? ' selected' : '') + '>منجزة</option>' +
      '</select></div>' +
      '<div id="cfSection"></div>';

    /* الحقول المخصصة */
    var cfields = customFields();
    if (cfields.length) {
      var existing = (task && task.fields) || {};
      body.querySelector('#cfSection').innerHTML =
        '<div class="fieldHead">' + UI.icon('flag') + 'الحقول المخصصة</div>' +
        '<div class="modal__grid">' + cfields.map(function (f) {
          return '<div class="field' + (f.type === 'checkbox' ? ' field--inline' : '') + '">' +
            '<label>' + UI.esc(f.name) + (f.required ? ' <span style="color:var(--rose-500)">*</span>' : '') + '</label>' +
            fieldInputHTML(f, existing[f.id]) + '</div>';
        }).join('') + '</div>';
    }

    var m = UI.modal({
      title: task ? 'تعديل المهمة' : 'مهمة جديدة',
      icon: task ? 'edit' : 'plus',
      body: body,
      buttons: [
        { label: 'إلغاء', class: 'btn--ghost' },
        {
          label: task ? 'حفظ التعديلات' : 'إضافة المهمة', class: 'btn--primary', onClick: function (api) {
            var title = body.querySelector('#fTitle').value.trim();
            if (!title) {
              UI.toast({ type: 'err', title: 'العنوان مطلوب', text: 'اكتب عنواناً واضحاً للمهمة.' });
              body.querySelector('#fTitle').focus();
              return false;
            }
            var payload = {
              title: title,
              notes: body.querySelector('#fNotes').value.trim(),
              category: (body.querySelector('input[name="fcat"]:checked') || {}).value || 'personal',
              priority: body.querySelector('#fPriority .is-on').dataset.val,
              date: body.querySelector('#fDate').value || today(),
              time: body.querySelector('#fTime').value || '',
              duration: parseInt(body.querySelector('#fDuration').value, 10) || 30,
              repeat: body.querySelector('#fRepeat').value,
              reminder: body.querySelector('#fReminder').checked,
              status: body.querySelector('#fStatus').value,
              fields: readFieldValues(body, cfields)
            };
            /* التحقق من الحقول المطلوبة */
            for (var ci = 0; ci < cfields.length; ci++) {
              var cf = cfields[ci];
              if (cf.required && !payload.fields[cf.id]) {
                UI.toast({ type: 'err', title: 'حقل مطلوب', text: 'الحقل «' + cf.name + '» يجب تعبئته.' });
                var elc = body.querySelector('#cf_' + cf.id);
                if (elc) { elc.focus(); elc.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
                return false;
              }
            }
            if (task) {
              if (payload.status === 'done' && task.status !== 'done') payload.doneAt = Date.now();
              Store.updateTask(task.id, payload);
              UI.toast({ type: 'ok', title: 'تم حفظ التعديلات' });
            } else {
              Store.addTask(payload);
              UI.toast({ type: 'ok', title: 'تمت إضافة المهمة', text: payload.time ? 'سيصلك تذكير قبل الموعد بـ ' + settings().lead + ' دقيقة.' : 'أُضيفت إلى قائمتك.' });
            }
            renderAll();
          }
        }
      ]
    });

    // interactive selectors
    var catWrap = body.querySelector('#fCat');
    catWrap.addEventListener('click', function (e) {
      var lbl = e.target.closest('.catOpt'); if (!lbl) return;
      $$('.catOpt', catWrap).forEach(function (x) { x.classList.remove('is-on'); });
      lbl.classList.add('is-on');
      var r = lbl.querySelector('input'); if (r) r.checked = true;
    });
    var prWrap = body.querySelector('#fPriority');
    prWrap.addEventListener('click', function (e) {
      var chip = e.target.closest('.optChip'); if (!chip) return;
      $$('.optChip', prWrap).forEach(function (x) { x.classList.remove('is-on'); });
      chip.classList.add('is-on');
    });
    return m;
  }

  function optChip(val, label, current) {
    var extra = '';
    if (val === 'high') extra = ' optChip--high';
    else if (val === 'med') extra = ' optChip--med';
    else if (val === 'low') extra = ' optChip--low';
    return '<button type="button" class="optChip' + extra + (current === val ? ' is-on' : '') + '" data-val="' + val + '">' + label + '</button>';
  }

  function defaultTaskDate() {
    if (state.view === 'day') return dayDate(state.dayOffset);
    if (state.view === 'week') return weekRange(state.weekOffset).start;
    if (state.view === 'month') return Store.todayISO(monthRange(state.monthOffset).first);
    return today();
  }

  /* ==========================================================
     plan modal
     ========================================================== */
  function planModal(plan) {
    var p = plan || {
      title: '', category: 'work', startDate: today(), expiryDate: addMonthsISO(today(), 1),
      cycle: 'monthly', autoRenew: true, cost: '', note: ''
    };
    var body = document.createElement('div');
    body.innerHTML =
      '<div class="field"><label>اسم الخطة / الاشتراك</label>' +
      '<div class="field__ctrl"><input id="pTitle" type="text" value="' + UI.esc(p.title) + '" placeholder="مثال: اشتراك Designer"></div></div>' +

      '<div class="modal__grid">' +
      '<div class="field"><label>النوع</label><div class="catPicker" id="pCat">' +
      '<label class="catOpt catOpt--work' + (p.category === 'work' ? ' is-on' : '') + '" data-val="work">' +
      '<input type="radio" name="pcat" value="work"' + (p.category === 'work' ? ' checked' : '') + '>' + UI.icon('work') + 'عمل</label>' +
      '<label class="catOpt catOpt--personal' + (p.category === 'personal' ? ' is-on' : '') + '" data-val="personal">' +
      '<input type="radio" name="pcat" value="personal"' + (p.category === 'personal' ? ' checked' : '') + '>' + UI.icon('home') + 'شخصي</label>' +
      '</div></div>' +
      '<div class="field"><label>دورة التجديد</label><select class="select" id="pCycle">' +
      ['monthly', 'quarterly', 'yearly', 'weekly', 'biweekly', 'daily', 'once'].map(function (c) {
        return '<option value="' + c + '"' + (p.cycle === c ? ' selected' : '') + '>' + cycleLabel(c) + '</option>';
      }).join('') + '</select></div>' +
      '<div class="field"><label>تاريخ البدء</label><input class="input ltr" id="pStart" type="date" value="' + UI.esc(p.startDate) + '"></div>' +
      '<div class="field"><label>تاريخ الانتهاء</label><input class="input ltr" id="pExpiry" type="date" value="' + UI.esc(p.expiryDate) + '"></div>' +
      '<div class="field"><label>التكلفة (اختياري)</label><input class="input ltr" id="pCost" type="number" min="0" step="1" value="' + UI.esc(p.cost || '') + '"></div>' +
      '<div class="field"><label>ملاحظات</label><input class="input" id="pNote" value="' + UI.esc(p.note || '') + '" placeholder="رقم العقد، جهة التذكير..."></div>' +
      '</div>' +

      '<div class="setRow" style="border-top:1px solid var(--border)">' +
      '<div><strong>تجديد تلقائي</strong><small>يمدّد سكرتاري الخطة تلقائياً قبل انتهائها</small></div>' +
      '<label class="switch"><input type="checkbox" id="pAuto"' + (p.autoRenew ? ' checked' : '') + '><i></i></label></div>';

    var m = UI.modal({
      title: plan ? 'تعديل الخطة' : 'خطة جديدة',
      icon: plan ? 'edit' : 'plans',
      body: body,
      buttons: [
        { label: 'إلغاء', class: 'btn--ghost' },
        {
          label: plan ? 'حفظ' : 'إضافة الخطة', class: 'btn--primary', onClick: function () {
            var title = body.querySelector('#pTitle').value.trim();
            if (!title) {
              UI.toast({ type: 'err', title: 'اسم الخطة مطلوب' });
              body.querySelector('#pTitle').focus();
              return false;
            }
            var payload = {
              title: title,
              category: (body.querySelector('input[name="pcat"]:checked') || {}).value || 'work',
              startDate: body.querySelector('#pStart').value || today(),
              expiryDate: body.querySelector('#pExpiry').value || today(),
              cycle: body.querySelector('#pCycle').value,
              autoRenew: body.querySelector('#pAuto').checked,
              cost: parseFloat(body.querySelector('#pCost').value) || 0,
              note: body.querySelector('#pNote').value.trim()
            };
            if (plan) { Store.updatePlan(plan.id, payload); UI.toast({ type: 'ok', title: 'تم تحديث الخطة' }); }
            else { Store.addPlan(payload); UI.toast({ type: 'ok', title: 'تمت إضافة الخطة', text: 'سنتابع تاريخ انتهائها ونذكّرك قبله.' }); }
            renderAll();
          }
        }
      ]
    });

    var catWrap = body.querySelector('#pCat');
    catWrap.addEventListener('click', function (e) {
      var lbl = e.target.closest('.catOpt'); if (!lbl) return;
      $$('.catOpt', catWrap).forEach(function (x) { x.classList.remove('is-on'); });
      lbl.classList.add('is-on');
      var r = lbl.querySelector('input'); if (r) r.checked = true;
    });
    return m;
  }

  /* ==========================================================
     note modal
     ========================================================== */
  function noteModal(note) {
    var n = note || { title: '', text: '', color: '#1d4ed8', pinned: false };
    var palette = ['#1d4ed8', '#0d9488', '#7c3aed', '#e11d48', '#d97706', '#059669', '#334155'];
    var body = document.createElement('div');
    body.innerHTML =
      '<div class="field"><label>العنوان</label>' +
      '<div class="field__ctrl"><input id="nTitle" type="text" value="' + UI.esc(n.title) + '" placeholder="عنوان الملاحظة"></div></div>' +
      '<div class="field"><label>النص</label>' +
      '<textarea class="input" id="nText" style="min-height:150px" placeholder="اكتب ملاحظتك هنا...">' + UI.esc(n.text || '') + '</textarea></div>' +
      '<div class="field"><label>اللون</label><div class="optRow" id="nColor">' +
      palette.map(function (c) {
        return '<button type="button" class="swatch' + (c === n.color ? ' is-on' : '') + '" data-val="' + c + '" style="background:' + c + '"></button>';
      }).join('') + '</div></div>' +
      '<div class="setRow" style="border-top:1px solid var(--border)">' +
      '<div><strong>تثبيت في الأعلى</strong><small>تظهر الملاحظات المثبتة أولاً</small></div>' +
      '<label class="switch"><input type="checkbox" id="nPin"' + (n.pinned ? ' checked' : '') + '><i></i></label></div>';

    UI.modal({
      title: note ? 'تعديل الملاحظة' : 'ملاحظة جديدة',
      icon: 'notes',
      body: body,
      buttons: [
        { label: 'إلغاء', class: 'btn--ghost' },
        {
          label: 'حفظ', class: 'btn--primary', onClick: function () {
            var title = body.querySelector('#nTitle').value.trim();
            var text = body.querySelector('#nText').value.trim();
            if (!title && !text) {
              UI.toast({ type: 'err', title: 'الملاحظة فارغة' });
              return false;
            }
            var color = (body.querySelector('#nColor .is-on') || {}).dataset || {};
            var payload = {
              title: title || 'ملاحظة',
              text: text,
              color: color.val || '#1d4ed8',
              pinned: body.querySelector('#nPin').checked
            };
            if (note) { Store.updateNote(note.id, payload); UI.toast({ type: 'ok', title: 'تم تحديث الملاحظة' }); }
            else { Store.addNote(payload); UI.toast({ type: 'ok', title: 'تمت إضافة الملاحظة' }); }
            renderAll();
          }
        }
      ]
    });

    var cw = body.querySelector('#nColor');
    cw.addEventListener('click', function (e) {
      var b = e.target.closest('.swatch'); if (!b) return;
      $$('.swatch', cw).forEach(function (x) { x.classList.remove('is-on'); });
      b.classList.add('is-on');
    });
  }

  /* ==========================================================
     الحقول المخصصة
     ========================================================== */
  function customFields() {
    var s = settings();
    return Array.isArray(s.customFields) ? s.customFields : [];
  }
  var FIELD_TYPES = [
    { v: 'text', label: 'نص' },
    { v: 'number', label: 'رقم' },
    { v: 'date', label: 'تاريخ' },
    { v: 'time', label: 'وقت' },
    { v: 'select', label: 'اختيار من قائمة' },
    { v: 'checkbox', label: 'نعم / لا' }
  ];
  function fieldTypeLabel(v) {
    for (var i = 0; i < FIELD_TYPES.length; i++) if (FIELD_TYPES[i].v === v) return FIELD_TYPES[i].label;
    return 'نص';
  }

  function fieldInputHTML(f, v) {
    var id = 'cf_' + f.id;
    switch (f.type) {
      case 'number': return '<input class="input ltr" id="' + id + '" type="number" step="any" value="' + UI.esc(v || '') + '" placeholder="' + UI.esc(f.name) + '">';
      case 'date': return '<input class="input ltr" id="' + id + '" type="date" value="' + UI.esc(v || '') + '">';
      case 'time': return '<input class="input ltr" id="' + id + '" type="time" value="' + UI.esc(v || '') + '">';
      case 'select':
        return '<select class="select" id="' + id + '"><option value="">—</option>' +
          (f.options || []).map(function (o) {
            return '<option value="' + UI.esc(o) + '"' + (o === v ? ' selected' : '') + '>' + UI.esc(o) + '</option>';
          }).join('') + '</select>';
      case 'checkbox':
        return '<label class="switch"><input type="checkbox" id="' + id + '"' + (v ? ' checked' : '') + '><i></i></label>';
      default:
        return '<input class="input" id="' + id + '" type="text" value="' + UI.esc(v || '') + '" placeholder="' + UI.esc(f.name) + '">';
    }
  }

  function readFieldValues(root, fields) {
    var out = {};
    fields.forEach(function (f) {
      var el = root.querySelector('#cf_' + f.id);
      if (!el) return;
      if (f.type === 'checkbox') { if (el.checked) out[f.id] = 'نعم'; }
      else if (el.value !== '') out[f.id] = String(el.value).trim();
    });
    return out;
  }

  function fieldChips(t) {
    var fields = customFields();
    if (!fields.length) return '';
    var vals = t.fields || {};
    var out = '';
    fields.forEach(function (f) {
      var v = vals[f.id];
      if (v === undefined || v === null || v === '') return;
      out += '<span class="chip chip--field" title="' + UI.esc(f.name) + '">' +
        UI.icon('flag') + UI.esc(f.name) + ': ' + UI.esc(v) + '</span>';
    });
    return out;
  }

  function fieldModal(field) {
    var f = field || { id: Store.uid('f'), name: '', type: 'text', options: [], required: false };
    var body = document.createElement('div');
    body.innerHTML =
      '<div class="field"><label>اسم الحقل</label>' +
      '<div class="field__ctrl"><input id="cfName" type="text" value="' + UI.esc(f.name) + '" placeholder="مثال: اسم العميل"></div></div>' +
      '<div class="modal__grid">' +
      '<div class="field"><label>نوع الحقل</label><select class="select" id="cfType">' +
      FIELD_TYPES.map(function (t) {
        return '<option value="' + t.v + '"' + (f.type === t.v ? ' selected' : '') + '>' + t.label + '</option>';
      }).join('') + '</select></div>' +
      '<div class="field" id="cfOptionsWrap"><label>الخيارات (مفصولة بفاصلة)</label>' +
      '<input class="input" id="cfOptions" value="' + UI.esc((f.options || []).join('، ')) + '" placeholder="خيار أول، خيار ثاني"></div>' +
      '</div>' +
      '<div class="setRow" style="border-top:1px solid var(--border)">' +
      '<div><strong>حقل مطلوب</strong><small>لن تتم إضافة المهمة قبل تعبئته</small></div>' +
      '<label class="switch"><input type="checkbox" id="cfRequired"' + (f.required ? ' checked' : '') + '><i></i></label>' +
      '</div>';

    UI.modal({
      title: field ? 'تعديل الحقل' : 'حقل مخصص جديد',
      icon: 'plus',
      body: body,
      buttons: [
        { label: 'إلغاء', class: 'btn--ghost' },
        {
          label: field ? 'حفظ' : 'إضافة الحقل', class: 'btn--primary', onClick: function () {
            var name = body.querySelector('#cfName').value.trim();
            if (!name) {
              UI.toast({ type: 'err', title: 'اسم الحقل مطلوب' });
              body.querySelector('#cfName').focus();
              return false;
            }
            var type = body.querySelector('#cfType').value;
            var optsRaw = body.querySelector('#cfOptions').value;
            var options = optsRaw ? optsRaw.split(/[،,]/).map(function (s) { return s.trim(); }).filter(Boolean) : [];
            var payload = {
              id: f.id, name: name, type: type, options: options,
              required: body.querySelector('#cfRequired').checked
            };
            var list = customFields().slice();
            var idx = -1;
            for (var i = 0; i < list.length; i++) if (list[i].id === f.id) idx = i;
            if (idx >= 0) list[idx] = payload; else list.push(payload);
            Store.setSetting('customFields', list);
            renderSettings();
            renderTasks();
            UI.toast({ type: 'ok', title: idx >= 0 ? 'تم تحديث الحقل' : 'تمت إضافة الحقل', text: 'سيظهر الآن في نموذج المهمة.' });
          }
        }
      ]
    });

    var typeSel = body.querySelector('#cfType');
    var optWrap = body.querySelector('#cfOptionsWrap');
    function syncOptions() {
      optWrap.hidden = typeSel.value !== 'select';
    }
    syncOptions();
    typeSel.addEventListener('change', syncOptions);
  }

  function deleteField(id) {
    var f = customFields().filter(function (x) { return x.id === id; })[0];
    if (!f) return;
    UI.confirm({
      title: 'حذف الحقل', danger: true, confirmLabel: 'حذف',
      text: 'سيُحذف الحقل «' + f.name + '» من كل المهام. هل تريد المتابعة؟'
    }).then(function (ok) {
      if (!ok) return;
      var list = customFields().filter(function (x) { return x.id !== id; });
      Store.setSetting('customFields', list);
      // إزالة القيم المخزّنة لهذا الحقل من كل المهام
      Store.patch(function (d) {
        d.tasks.forEach(function (t) { if (t.fields) { delete t.fields[id]; } });
      });
      renderSettings(); renderTasks(); renderDay();
      UI.toast({ type: 'ok', title: 'تم حذف الحقل' });
    });
  }

  function renderCustomFields() {
    var list = customFields();
    var el = $('#customFieldsList');
    if (!el) return;
    if (!list.length) {
      el.innerHTML = '<div class="empty">' + UI.icon('plus') +
        '<b>لا توجد حقول مخصصة</b><span>اضغط «حقل جديد» لإضافة ما تحتاجه (رقم العقد، اسم العميل…)</span></div>';
      return;
    }
    el.innerHTML = list.map(function (f) {
      var used = tasks().filter(function (t) { return t.fields && t.fields[f.id]; }).length;
      return '<div class="mini">' +
        '<div class="mini__ico">' + UI.icon('flag') + '</div>' +
        '<div class="mini__body"><div class="mini__title">' + UI.esc(f.name) +
        (f.required ? ' <span class="chip chip--warn">مطلوب</span>' : '') + '</div>' +
        '<div class="mini__meta">' + fieldTypeLabel(f.type) +
        (f.options && f.options.length ? ' · ' + UI.esc(f.options.join('، ')) : '') +
        ' · مستخدم في ' + used + ' مهمة</div></div>' +
        '<div class="planCard__acts">' +
        '<button class="iconBtn" data-edit-field="' + f.id + '" title="تعديل">' + UI.icon('edit') + '</button>' +
        '<button class="iconBtn" data-del-field="' + f.id + '" title="حذف">' + UI.icon('trash') + '</button>' +
        '</div></div>';
    }).join('');
  }

  /* ==========================================================
     actions
     ========================================================== */
  function toggleTask(id) {
    var t = Store.getTask(id); if (!t) return;
    var nowDone = t.status !== 'done';
    Store.updateTask(id, { status: nowDone ? 'done' : 'todo', doneAt: nowDone ? Date.now() : null });
    if (nowDone) {
      Store.pushMessage({
        title: 'أُنجزت: ' + t.title,
        text: 'أحسنت! تم تعليم المهمة كمكتملة.',
        kind: 'done', taskId: t.id
      });
      if (t.repeat && t.repeat !== 'none') {
        var nextDate = advanceDate(t.date, t.repeat);
        Store.addTask({
          title: t.title, notes: t.notes, date: nextDate, time: t.time, duration: t.duration,
          category: t.category, priority: t.priority, status: 'todo', reminder: t.reminder, repeat: t.repeat
        });
        UI.toast({ type: 'ok', title: 'تمجدول التكرار', text: 'النسخة القادمة في ' + UI.fmtDate(nextDate) });
      }
    }
    renderAll();
  }

  function deleteTask(id) {
    var t = Store.getTask(id); if (!t) return;
    UI.confirm({
      title: 'حذف المهمة', text: 'سيُنقل «' + t.title + '» إلى سلة المحذوفات ويمكنك استرجاعه لاحقاً.',
      confirmLabel: 'نقل إلى السلة'
    }).then(function (ok) {
      if (!ok) return;
      doTrash('task', id, t.title);
    });
  }

  function deletePlan(id) {
    var p = plansAll().filter(function (x) { return x.id === id; })[0]; if (!p) return;
    UI.confirm({
      title: 'حذف الخطة', text: 'سيُنقل «' + p.title + '» إلى سلة المحذوفات ويمكنك استرجاعه لاحقاً.',
      confirmLabel: 'نقل إلى السلة'
    }).then(function (ok) {
      if (!ok) return;
      doTrash('plan', id, p.title);
    });
  }

  function deleteNote(id) {
    var n = notesAll().filter(function (x) { return x.id === id; })[0]; if (!n) return;
    UI.confirm({
      title: 'حذف الملاحظة', text: 'سيُنقل «' + (n.title || 'ملاحظة') + '» إلى سلة المحذوفات ويمكنك استرجاعه لاحقاً.',
      confirmLabel: 'نقل إلى السلة'
    }).then(function (ok) {
      if (!ok) return;
      doTrash('note', id, n.title);
    });
  }

  function renewPlan(id) {
    var p = plans().filter(function (x) { return x.id === id; })[0]; if (!p) return;
    var nextExpiry = advanceDate(p.expiryDate, p.cycle);
    if (nextExpiry <= p.expiryDate) nextExpiry = addMonthsISO(p.expiryDate, 1);
    var history = (p.history || []).concat([{ at: Date.now(), from: p.expiryDate, to: nextExpiry }]);
    Store.updatePlan(id, { expiryDate: nextExpiry, status: 'active', lastRenewedAt: Date.now(), history: history });
    Store.pushMessage({
      title: 'جُدّدت خطة: ' + p.title,
      text: 'التاريخ الجديد ' + UI.fmtDate(nextExpiry),
      kind: 'plan'
    });
    renderAll();
    UI.toast({ type: 'ok', title: 'تم تجديد الخطة', text: 'التاريخ الجديد: ' + UI.fmtDate(nextExpiry) });
    speakText('تم تجديد خطة ' + p.title + '. التاريخ الجديد ' + Voice.dateToArabic(nextExpiry) + '.');
  }

  function speakText(text, opts) {
    opts = opts || {};
    if (!Voice.available()) {
      if (!opts.silent) {
        UI.toast({ type: 'warn', title: 'القراءة الصوتية غير متاحة', text: 'جرّب متصفح Chrome أو Edge على الحاسوب.' });
      }
      return;
    }
    var prepared = Voice.naturalize(text);
    try { Voice.speak(prepared, opts); }
    catch (e) { /* الصوت غير متاح في هذه البيئة */ }
  }

  function speakTask(id) {
    var t = Store.getTask(id); if (!t) return;
    var txt = 'مهمة: ' + t.title + '. ' +
      (t.date ? 'بتاريخ ' + Voice.dateToArabic(t.date) + '. ' : '') +
      (t.time ? Voice.timeToArabic(t.time) + '. ' : '') +
      (t.category === 'work' ? 'من النوع: عمل.' : 'من النوع: شخصي.');
    speakText(txt);
  }
  function speakPlan(id) {
    var p = plans().filter(function (x) { return x.id === id; })[0]; if (!p) return;
    var d = Store.daysBetween(today(), p.expiryDate);
    speakText('خطة ' + p.title + '. ' + UI.daysLabel(d) + '. تنتهي في ' + Voice.dateToArabic(p.expiryDate) + '.');
  }
  function speakNote(id) {
    var n = notes().filter(function (x) { return x.id === id; })[0]; if (!n) return;
    speakText(n.title + '. ' + (n.text || ''));
  }

  function readDaySchedule() {
    var iso = dayDate(state.dayOffset);
    var list = tasksOn(iso).filter(function (t) { return t.status !== 'done'; });
    if (!list.length) {
      speakText('لا توجد مهام مجدولة في ' + Voice.dateToArabic(iso) + '.');
      return;
    }
    var parts = ['لديك ' + UI.plural(list.length, 'مهمة', 'مهمتان', 'مهام', 'مهمة') + ' في ' + Voice.dateToArabic(iso) + '.'];
    var ORD = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة', 'التاسعة', 'العاشرة', 'الحادية عشرة', 'الثانية عشرة'];
    list.slice(0, 12).forEach(function (t, i) {
      parts.push((ORD[i] || ('رقم ' + (i + 1))) + ': ' + t.title + (t.time ? ' ' + Voice.timeToArabic(t.time) : '') + '.');
    });
    Voice.speakList(parts.map(function (p) { return Voice.naturalize(p); }));
  }

  /* ==========================================================
     reminder engine
     ========================================================== */
  function startEngine() {
    if (state.reminderTimer) clearInterval(state.reminderTimer);
    state.reminderTimer = setInterval(function () { engineTick(); }, 20000);
    setTimeout(engineTick, 1200);
  }

  function engineTick() {
    if (!Store.currentUser() || state.locked) return;
    var s = settings();
    var now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var lead = typeof s.lead === 'number' ? s.lead : 5;

    tasks().forEach(function (t) {
      if (t.status === 'done' || !t.reminder || !t.date || !t.time) return;
      if (t.remindedAt) return;
      var p = t.time.split(':');
      var atMin = parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
      var fireMin = atMin - lead;
      var due = nowMin >= fireMin && nowMin <= atMin + 3;
      if (!due) return;
      fireReminder(t);
    });

    processPlans();
    processDigest(nowMin, s);
    processWhatsApp(nowMin);
    processParentsDigest(nowMin);
  }

  /* ---------- تذكير واتساب ---------- */
  function processWhatsApp(nowMin) {
    var w = waConfig();
    if (!w.enabled || !Notify.enabled()) return;
    var lead = typeof w.lead === 'number' ? w.lead : 30;
    tasks().forEach(function (t) {
      if (t.status === 'done' || !t.reminder || !t.date || !t.time) return;
      if (t.whatsappSentAt) return;
      var p = t.time.split(':');
      var atMin = parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
      var fireMin = atMin - lead;
      if (nowMin < fireMin || nowMin > atMin + 5) return;
      sendWhatsapp(t);
    });
  }

  function sendWhatsapp(t) {
    Store.updateTask(t.id, { whatsappSentAt: Date.now() });
    var lines = ['⏰ *تذكير من سكرتاري*', '', '📌 ' + t.title];
    if (t.date) lines.push('📅 ' + Voice.dateToArabic(t.date));
    if (t.time) lines.push('🕘 ' + Voice.timeToArabic(t.time));
    lines.push('🏷️ ' + (t.category === 'work' ? 'عمل' : 'شخصي'));
    if (t.notes) lines.push('📝 ' + t.notes);
    var text = lines.join('\n');

    Notify.send(text).then(function (res) {
      if (res && res.needTap) {
        UI.toast({
          type: 'info', title: 'تذكير واتساب جاهز', text: t.title, duration: 0,
          actions: [{ label: 'فتح واتساب', onClick: function () { global.open(res.link, '_blank', 'noopener'); } }]
        });
      } else {
        UI.toast({ type: 'ok', title: 'أُرسل تذكير واتساب', text: t.title });
      }
    }).catch(function (e) {
      UI.toast({ type: 'err', title: 'تعذّر إرسال واتساب', text: e.message });
    });
  }

  function fireReminder(t) {
    Store.updateTask(t.id, { remindedAt: Date.now() });
    var when = t.time ? ' ' + Voice.timeToArabic(t.time) : '';
    var title = 'تذكير: ' + t.title;
    var text = (t.date === today() ? 'اليوم' : UI.fmtDate(t.date)) + when + (t.category === 'work' ? ' — عمل' : ' — شخصي');

    Store.pushMessage({ title: title, text: text, kind: t.category, taskId: t.id });

    if (settings().sound !== false) { try { Voice.chime(); } catch (e) { /* ignore */ } }
    speakText(title + '. ' + text + '.', { silent: true });

    notify(title, text + ' — سكرتاري');

    UI.toast({
      type: t.category === 'work' ? 'warn' : 'info',
      title: title,
      text: text,
      duration: 0,
      actions: [
        { label: 'تم إنجازها', onClick: function () { toggleTask(t.id); } },
        { label: 'تأجيل 10 د', onClick: function () { Store.updateTask(t.id, { time: addMinutes(t.time, 10), remindedAt: null }); } }
      ]
    });
    renderAll();
  }

  function addMinutes(hhmm, mins) {
    if (!hhmm) return hhmm;
    var p = hhmm.split(':');
    var total = parseInt(p[0], 10) * 60 + parseInt(p[1], 10) + mins;
    total = ((total % 1440) + 1440) % 1440;
    return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  }

  function processPlans() {
    var t = today();
    var changed = false;
    plans().forEach(function (p) {
      if (p.status !== 'active') return;
      if (p.expiryDate >= t) return;
      if (p.autoRenew && p.cycle !== 'once') {
        var next = p.expiryDate;
        var guard = 0;
        while (next < t && guard < 400) { next = advanceDate(next, p.cycle); guard++; }
        if (next === p.expiryDate) next = addMonthsISO(p.expiryDate, 1);
        var history = (p.history || []).concat([{ at: Date.now(), from: p.expiryDate, to: next, auto: true }]);
        Store.updatePlan(p.id, { expiryDate: next, lastRenewedAt: Date.now(), history: history });
        Store.pushMessage({
          title: 'تجديد تلقائي: ' + p.title,
          text: 'مُدّدت حتى ' + UI.fmtDate(next),
          kind: 'plan'
        });
        changed = true;
      } else {
        Store.updatePlan(p.id, { status: 'expired' });
        Store.pushMessage({
          title: 'انتهت صلاحية: ' + p.title,
          text: 'انتهت في ' + UI.fmtDate(p.expiryDate) + ' — تحتاج تجديداً.',
          kind: 'plan'
        });
        changed = true;
      }
    });
    if (changed) renderAll();
  }

  function processDigest(nowMin, s) {
    if (!s.digest) return;
    var d = D(); if (!d) return;
    var todayStr = today();
    if (d.lastDigest === todayStr) return;
    if (nowMin < 8 * 60 || nowMin > 9 * 60) return;
    var list = tasksOn(todayStr);
    if (!list.length) return;
    var done = list.filter(function (t) { return t.status === 'done'; }).length;
    var parts = ['صباح الخير. لديك ' + UI.plural(list.length, 'مهمة', 'مهمتان', 'مهام', 'مهمة') + ' اليوم.'];
    list.slice(0, 10).forEach(function (t) {
      parts.push(t.title + (t.time ? ' ' + Voice.timeToArabic(t.time) : '') + '.');
    });
    parts.push('أنجزت ' + done + ' منها.');
    Voice.speakList(parts.map(function (x) { return Voice.naturalize(x); }));
    Store.patch(function (dd) { dd.lastDigest = todayStr; });
  }

  /* ---------- الملخص اليومي التلقائي لمجموعة الأولياء ---------- */
  function processParentsDigest(nowMin) {
    var p = pgConfig();
    if (!p.auto || !p.link) return;
    var d = D(); if (!d) return;
    var day = today();
    if (d.lastParentsDigest === day) return;
    var hh = parseInt((p.time || '07:00').split(':')[0], 10);
    var mm = parseInt((p.time || '07:00').split(':')[1] || '0', 10);
    var at = hh * 60 + mm;
    if (nowMin < at || nowMin > at + 20) return;
    Store.patch(function (dd) { dd.lastParentsDigest = day; });
    sendToParents(buildParentsSummary(day), { title: 'تم إرسال الملخص اليومي للمجموعة' });
  }

  function notify(title, bodyText) {
    try {
      if ('Notification' in global && Notification.permission === 'granted') {
        var n = new Notification(title, { body: bodyText, tag: 'secretary-' + Date.now(), dir: 'rtl', lang: 'ar' });
        n.onclick = function () { global.focus(); n.close(); };
      }
    } catch (e) { /* ignore */ }
  }

  /* ==========================================================
     الأرشيف وسلة المحذوفات
     ========================================================== */
  function archiveEntries(mode) {
    var out = [];
    var groups = { task: tasksAll(), plan: plansAll(), note: notesAll() };
    Object.keys(groups).forEach(function (kind) {
      groups[kind].forEach(function (x) {
        var isTrash = !!x.deletedAt;
        if (mode === 'trash') { if (isTrash) out.push({ kind: kind, item: x }); }
        else { if (!isTrash && x.archived) out.push({ kind: kind, item: x }); }
      });
    });
    return out;
  }

  function archiveItemHTML(kind, x, mode) {
    var typeLabel = kind === 'task' ? 'مهمة' : kind === 'plan' ? 'خطة' : 'ملاحظة';
    var typeIcon = kind === 'task' ? 'tasks' : kind === 'plan' ? 'plans' : 'notes';
    var meta = '';
    if (kind === 'task') {
      meta = UI.fmtDate(x.date, { year: false }) + (x.time ? ' · ' + x.time : '') +
        ' · ' + (x.category === 'work' ? 'عمل' : 'شخصي') +
        (x.status === 'done' ? ' · منجزة' : '');
    } else if (kind === 'plan') {
      meta = 'تنتهي في ' + UI.fmtDate(x.expiryDate) + ' · ' + cycleLabel(x.cycle);
    } else {
      meta = (x.text || '').slice(0, 70) + (x.text && x.text.length > 70 ? '…' : '');
    }
    var when = mode === 'trash'
      ? 'حُذفت ' + UI.relTime(x.deletedAt)
      : 'أُرشفت ' + UI.relTime(x.archivedAt || x.updatedAt || x.createdAt);

    var acts = '';
    if (mode === 'trash') {
      acts = '<button class="btn btn--soft btn--sm" data-restore="' + kind + ':' + x.id + '">' +
        UI.icon('restore') + 'استرجاع</button>' +
        '<button class="iconBtn" data-purge="' + kind + ':' + x.id + '" title="حذف نهائي">' + UI.icon('trash') + '</button>';
    } else {
      acts = '<button class="btn btn--soft btn--sm" data-unarchive="' + kind + ':' + x.id + '">' +
        UI.icon('restore') + 'إلغاء الأرشفة</button>' +
        '<button class="iconBtn" data-trash="' + kind + ':' + x.id + '" title="نقل إلى سلة المحذوفات">' + UI.icon('trash') + '</button>';
    }
    return '<div class="arcItem">' +
      '<div class="arcItem__ico arcItem__ico--' + kind + '">' + UI.icon(typeIcon) + '</div>' +
      '<div class="arcItem__body">' +
      '<div class="arcItem__title">' + esc(x.title || typeLabel) +
      '<span class="chip">' + typeLabel + '</span></div>' +
      '<div class="arcItem__meta">' + esc(meta) + ' · ' + when + '</div>' +
      '</div>' +
      '<div class="arcItem__acts">' + acts + '</div>' +
      '</div>';
  }

  function renderArchive() {
    var mode = state.archiveTab || 'archived';
    var st = Store.archiveStats();
    var list = archiveEntries(mode);

    $('#archiveStats').innerHTML = [
      { icon: 'archive', cls: '', label: 'عناصر مؤرشفة', value: st.archived },
      { icon: 'trash', cls: 'stat__ico--rose', label: 'في سلة المحذوفات', value: st.trashed },
      { icon: 'tasks', cls: 'stat__ico--teal', label: 'مهام محذوفة', value: st.byType.task },
      { icon: 'plans', cls: 'stat__ico--violet', label: 'خطط محذوفة', value: st.byType.plan }
    ].map(function (s) {
      return '<div class="stat"><div class="stat__ico ' + s.cls + '">' + UI.icon(s.icon) + '</div>' +
        '<div><div class="stat__val">' + s.value + '</div><div class="stat__label">' + s.label + '</div></div></div>';
    }).join('');

    $('#archiveListTitle').innerHTML = UI.icon(mode === 'trash' ? 'trash' : 'archive') +
      '<span>' + (mode === 'trash' ? 'سلة المحذوفات' : 'المؤرشفة') + '</span>';

    var el = $('#archiveList');
    if (!list.length) {
      el.innerHTML = '<div class="empty">' + UI.icon(mode === 'trash' ? 'trash' : 'archive') +
        '<b>' + (mode === 'trash' ? 'سلة المحذوفات فارغة' : 'لا توجد عناصر مؤرشفة') + '</b>' +
        '<span>' + (mode === 'trash' ? 'كل ما تحذفه يُحفظ هنا ويمكنك استرجاعه.' : 'أرشف المهام المنجزة لتنظيم قائمتك دون فقدانها.') + '</span></div>';
      return;
    }
    el.innerHTML = list.map(function (e) { return archiveItemHTML(e.kind, e.item, mode); }).join('');
  }

  /* ---------------- إجراءات الأرشفة والسلة ---------------- */
  var KIND_MAP = { task: 'tasks', plan: 'plans', note: 'notes' };

  function doArchive(kind, id) {
    Store.archiveItem(KIND_MAP[kind], id);
    renderAll();
    UI.toast({ type: 'ok', title: 'تمت الأرشفة', text: 'يمكنك استرجاعها من «الأرشيف والسلة».' });
  }
  function doUnarchive(kind, id) {
    Store.unarchiveItem(KIND_MAP[kind], id);
    renderAll();
    UI.toast({ type: 'ok', title: 'تمت الإعادة للقائمة' });
  }
  function doTrash(kind, id, label) {
    Store.trashItem(KIND_MAP[kind], id);
    renderAll();
    UI.toast({
      type: 'ok', title: 'نُقل إلى سلة المحذوفات', text: label || '',
      duration: 9000,
      actions: [{
        label: 'تراجع', onClick: function () {
          Store.restoreItem(KIND_MAP[kind], id); renderAll();
          UI.toast({ type: 'ok', title: 'تمت الاستعادة' });
        }
      }]
    });
  }
  function doRestore(kind, id) {
    Store.restoreItem(KIND_MAP[kind], id);
    renderAll();
    UI.toast({ type: 'ok', title: 'تمت الاستعادة', text: 'عاد العنصر إلى قائمتك.' });
  }
  function doPurge(kind, id, label) {
    UI.confirm({
      title: 'حذف نهائي', danger: true, confirmLabel: 'حذف نهائي',
      text: 'سيُمحى «' + (label || 'العنصر') + '» نهائياً ولا يمكن استرجاعه. هل أنت متأكد؟'
    }).then(function (ok) {
      if (!ok) return;
      Store.purgeItem(KIND_MAP[kind], id);
      renderAll();
      UI.toast({ type: 'ok', title: 'تم الحذف نهائياً' });
    });
  }
  function archiveCompleted() {
    var done = tasks().filter(function (t) { return t.status === 'done'; });
    if (!done.length) {
      UI.toast({ type: 'warn', title: 'لا توجد مهام مكتملة', text: 'أرشف المهام المنجزة أولاً ثم أعد المحاولة.' });
      return;
    }
    UI.confirm({
      title: 'أرشفة المهام المكتملة', confirmLabel: 'أرشفة',
      text: 'سيتم أرشفة ' + done.length + ' مهمة منجزة. ستبقى محفوظة ويمكنك استرجاعها في أي وقت.'
    }).then(function (ok) {
      if (!ok) return;
      done.forEach(function (t) { Store.archiveItem('tasks', t.id); });
      renderAll();
      UI.toast({ type: 'ok', title: 'تمت أرشفة ' + done.length + ' مهمة' });
    });
  }

  /* ---------------- واتساب ---------------- */
  function waConfig() {
    var s = settings();
    if (!s.whatsapp) {
      s.whatsapp = { enabled: false, phone: '', provider: 'link', lead: 30, apikey: '', phoneNumberId: '', accessToken: '', target: 'number' };
    }
    return s.whatsapp;
  }
  function pgConfig() {
    var s = settings();
    if (!s.parents) {
      s.parents = {
        link: '', groupId: '',
        header: '📢 تذكير من إدارة المدرسة — نرجو الاطلاع',
        auto: false, time: '07:00', category: 'all'
      };
    }
    return s.parents;
  }
  function applyNotifyConfig() {
    var w = waConfig();
    var p = pgConfig();
    Notify.configure(Object.assign({}, w, {
      target: w.target || 'number',
      groupLink: p.link || w.groupLink || '',
      groupId: p.groupId || w.groupId || ''
    }));
  }

  /* ---------- بناء رسائل الأولياء ---------- */
  function parentsHeader() {
    return pgConfig().header || '📢 تذكير من إدارة المدرسة';
  }
  function parentsTasksOf(iso) {
    var cat = pgConfig().category || 'all';
    return tasksOn(iso).filter(function (t) {
      if (t.status === 'done') return false;
      if (!t.time) return false;
      if (cat !== 'all' && t.category !== cat) return false;
      return true;
    });
  }
  function buildParentsSummary(iso) {
    var d = iso || today();
    var list = parentsTasksOf(d);
    var lines = [parentsHeader(), ''];
    lines.push('🗓️ *مواعيد ' + UI.weekdayName(d) + ' ' + UI.fmtDate(d, { year: false }) + '*');
    if (!list.length) {
      lines.push('لا توجد مواعيد مسجّلة في هذا اليوم.');
    } else {
      list.slice(0, 25).forEach(function (t) {
        lines.push('• ' + t.time + ' — ' + t.title + (t.notes ? '\n   ' + t.notes : ''));
      });
    }
    lines.push('');
    lines.push('📌 للاستفسار تواصلوا مع الإدارة. شكراً لتعاونكم.');
    return lines.join('\n');
  }
  function buildParentsTask(t) {
    var lines = [parentsHeader(), ''];
    lines.push('🔔 *تنبيه*: ' + t.title);
    if (t.date) lines.push('📅 ' + UI.fmtDate(t.date, { weekday: true }));
    if (t.time) lines.push('🕘 ' + Voice.timeToArabic(t.time));
    if (t.notes) lines.push('📝 ' + t.notes);
    lines.push('');
    lines.push('📌 للاستفسار تواصلوا مع الإدارة.');
    return lines.join('\n');
  }
  function buildParentsPlan(p) {
    var d = Store.daysBetween(today(), p.expiryDate);
    var lines = [parentsHeader(), ''];
    lines.push('⏳ *تنبيه*: ' + p.title);
    lines.push('📅 ينتهي في ' + UI.fmtDate(p.expiryDate, { weekday: true }) + ' — ' + UI.daysLabel(d));
    if (p.note) lines.push('📝 ' + p.note);
    return lines.join('\n');
  }

  /* ---------- الإرسال ---------- */
  function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(function () { });
        return true;
      }
    } catch (e) { }
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  function sendToParents(text, opts) {
    opts = opts || {};
    var p = pgConfig();
    if (!p.link && !p.groupId) {
      UI.toast({
        type: 'err', title: 'المجموعة غير مُعدّة',
        text: 'أضف رابط دعوة المجموعة من الإعدادات ← قروب أولياء الأمور.'
      });
      return Promise.resolve(false);
    }
    applyNotifyConfig();
    var w = waConfig();
    Notify.configure(Object.assign({}, w, {
      enabled: true, target: 'group',
      groupLink: p.link, groupId: p.groupId,
      provider: (w.provider === 'link' && opts.forceProvider) ? 'link' : w.provider
    }));

    return Notify.send(text).then(function (res) {
      if (res && res.needTap) {
        var copied = copyToClipboard(text);
        UI.toast({
          type: 'info', title: opts.title || 'الرسالة جاهزة للمجموعة',
          text: (copied ? 'تم نسخ الرسالة إلى الحافظة. ' : '') + 'اضغط «فتح واتساب» ثم الصقها في المجموعة.',
          duration: 0,
          actions: [{
            label: 'فتح واتساب',
            onClick: function () { global.open(res.link, '_blank', 'noopener'); }
          }]
        });
      } else {
        UI.toast({ type: 'ok', title: opts.title || 'أُرسلت الرسالة', text: 'تم الإرسال إلى مجموعة الأولياء.' });
      }
      return true;
    }).catch(function (e) {
      UI.toast({ type: 'err', title: 'تعذّر الإرسال', text: e.message });
      return false;
    });
  }

  function renderWhatsAppSettings() {
    var w = waConfig();
    var en = $('#waEnabled'); if (!en) return;
    en.checked = !!w.enabled;
    $('#waPhone').value = w.phone || '';
    $('#waLead').value = w.lead || 30;
    $('#waLeadVal').textContent = w.lead || 30;
    $('#waProvider').value = w.provider || 'link';
    if ($('#waTarget')) $('#waTarget').value = w.target || 'number';
    $('#waApiKey').value = w.apikey || '';
    $('#waPhoneId').value = w.phoneNumberId || '';
    $('#waToken').value = w.accessToken || '';
    syncWaRows();
    var hint = '';
    if (w.provider === 'link') {
      hint = 'عند موعد التذكير سيظهر لك زر «فتح واتساب» برسالة جاهزة — اضغطه لإرسالها (المتصفحات تمنع الفتح التلقائي).';
    } else if (w.provider === 'callmebot') {
      hint = 'للإعداد: افح callmebot.com/keys ثم أرسل /allow إلى الرقم 3464442148 من واتسابك، وضع المفتاح هنا. بعدها ستصل الرسائل تلقائياً.';
    } else {
      hint = 'يتطلب حساب Meta Business ورمز WhatsApp. إرسال الرسائل خارج نافذة الـ24 ساعة يحتاج قوالب معتمدة من Meta.';
    }
    $('#waHint').textContent = hint;
  }
  function syncWaRows() {
    var p = $('#waProvider').value;
    var tgt = $('#waTarget') ? $('#waTarget').value : 'number';
    $('#waApiRow').hidden = p !== 'callmebot';
    $('#waMetaRow').hidden = p !== 'meta';
    $('#waTokenRow').hidden = p !== 'meta';
    var phoneRow = $('#waPhone').closest('.setRow');
    if (phoneRow) phoneRow.hidden = (tgt === 'group');
    var leadRow = $('#waLead').closest('.setRow');
    if (leadRow) leadRow.hidden = (tgt === 'group');
  }
  function saveWa() {
    var w = waConfig();
    w.enabled = $('#waEnabled').checked;
    w.phone = $('#waPhone').value.trim();
    w.lead = parseInt($('#waLead').value, 10) || 30;
    w.provider = $('#waProvider').value;
    w.target = $('#waTarget') ? $('#waTarget').value : 'number';
    w.apikey = $('#waApiKey').value.trim();
    w.phoneNumberId = $('#waPhoneId').value.trim();
    w.accessToken = $('#waToken').value.trim();
    Store.setSetting('whatsapp', w);
    applyNotifyConfig();
  }

  /* ---------- إعدادات قروب الأولياء ---------- */
  function renderParentsSettings() {
    var p = pgConfig();
    var chip = $('#pgChip');
    if (!chip) return;
    var ready = !!(p.link || p.groupId);
    chip.textContent = ready ? 'مُعدّ' : 'غير مُعد';
    chip.className = 'chip ' + (ready ? 'chip--ok' : '');
    if (document.activeElement !== $('#pgLink')) $('#pgLink').value = p.link || '';
    if (document.activeElement !== $('#pgId')) $('#pgId').value = p.groupId || '';
    if (document.activeElement !== $('#pgHeader')) $('#pgHeader').value = p.header || '';
    $('#pgAuto').checked = !!p.auto;
    var h = parseInt((p.time || '07:00').split(':')[0], 10) || 0;
    $('#pgTime').value = h;
    $('#pgTimeVal').textContent = (h < 10 ? '0' : '') + h + ':00';
    $('#pgHint').textContent = ready
      ? 'المجموعة جاهزة. في وضع «رابط الدعوة» تُنسخ الرسالة تلقائياً إلى الحافظة ويفتح واتساب — الصقها وأرسل. أما الإرسال التلقائي فيحتاج Meta Cloud API + Group ID.'
      : 'انسخ رابط الدعوة من داخل واتساب: افتح المجموعة ← معلومات ← «إضافة إلى مجموعة» وانسخ الرابط.';
  }
  function saveParents() {
    var p = pgConfig();
    p.link = $('#pgLink').value.trim();
    p.groupId = $('#pgId').value.trim();
    p.header = $('#pgHeader').value.trim();
    p.auto = $('#pgAuto').checked;
    var h = parseInt($('#pgTime').value, 10) || 0;
    p.time = (h < 10 ? '0' : '') + h + ':00';
    Store.setSetting('parents', p);
    applyNotifyConfig();
  }

  /* ---------------- Supabase ---------------- */
  function renderSupabaseSettings() {
    var cfg = (window.SB && SB.config) ? SB.config : { url: '', key: '' };
    var url = $('#sbUrl'), key = $('#sbKey');
    if (!url) return;
    if (document.activeElement !== url) url.value = cfg.url || '';
    if (document.activeElement !== key) key.value = cfg.key || '';
    var on = !!(window.SB && SB.configured());
    var chip = $('#sbChip');
    chip.textContent = on ? 'مُفعّل' : 'محلي';
    chip.className = 'chip ' + (on ? 'chip--ok' : '');
    var st = $('#sbState');
    if (on) {
      var hasSession = !!(SB.session && SB.session());
      st.textContent = hasSession
        ? 'متصل بحساب ' + ((SB.session().user && SB.session().user.email) || '')
        : 'الإعداد محفوظ — سجّل الدخول بحسابك في Supabase';
    } else {
      st.textContent = 'غير مفعّل — التطبيق يعمل محلياً على هذا الجهاز';
    }
  }

  /* ==========================================================
     settings wiring
     ========================================================== */
  function applySettings() {
    var s = settings();
    if (s.theme) applyTheme(s.theme, false);
    Voice.setVoice(s.voiceURI);
    Voice.setRate(s.rate);
    Voice.setPitch(s.pitch);
    Voice.setArabicNumbers(s.arabicNumbers);
    applyNotifyConfig();
  }

  function applyTheme(theme, save) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('secretary:v1:theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b1120' : '#1D4ED8');
    var btn = $('#themeBtn');
    if (btn) btn.innerHTML = UI.icon(theme === 'dark' ? 'sun' : 'moon');
    var sw = $('#setDark'); if (sw) sw.checked = theme === 'dark';
    if (save && Store.currentUser()) Store.setSetting('theme', theme);
    setTimeout(function () { if (state.view) render(state.view); }, 30);
  }

  /* ==========================================================
     events
     ========================================================== */
  function bindGlobal() {
    /* auth tabs */
    $$('.auth__tab').forEach(function (b) {
      b.addEventListener('click', function () { switchAuthTab(b.dataset.authtab); });
    });

    /* password reveal */
    $$('[data-toggle-pass]').forEach(function (b) {
      b.addEventListener('click', function () {
        var inp = document.getElementById(b.dataset.togglePass);
        var show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        b.textContent = show ? 'إخفاء' : 'إظهار';
      });
    });

    /* password strength */
    var pw = $('#signupPassword');
    if (pw) {
      pw.addEventListener('input', function () {
        var v = pw.value, lvl = 0;
        if (v.length >= 6) lvl++;
        if (/[A-Za-z]/.test(v) && /\d/.test(v)) lvl++;
        if (v.length >= 10 || /[^A-Za-z0-9]/.test(v)) lvl++;
        var meter = $('#pwMeter');
        meter.dataset.level = lvl;
        meter.firstElementChild.style.width = (lvl * 33.4) + '%';
      });
    }

    /* login */
    $('#loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('#loginEmail').value.trim();
      var pass = $('#loginPassword').value;
      var err = $('#loginError');
      err.hidden = true;
      if (!email || !pass) { err.textContent = 'أدخل البريد وكلمة المرور.'; err.hidden = false; return; }
      Store.login(email, pass, $('#loginRemember').checked).then(function (user) {
        $('#loginPassword').value = '';
        Store.loadData();
        try { enterApp(user); }
        catch (ex) { UI.toast({ type: 'err', title: 'تعذّر فتح التطبيق', text: ex.message }); }
      }).catch(function (ex) {
        err.textContent = ex.message || 'تعذّر تسجيل الدخول.';
        err.hidden = false;
      });
    });

    /* signup */
    $('#signupForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = $('#signupName').value.trim();
      var email = $('#signupEmail').value.trim();
      var pass = $('#signupPassword').value;
      var pass2 = $('#signupPassword2').value;
      var err = $('#signupError');
      err.hidden = true;
      if (pass !== pass2) { err.textContent = 'كلمتا المرور غير متطابقتين.'; err.hidden = false; return; }
      Store.register({ name: name, email: email, password: pass }).then(function (user) {
        if (Store.supabaseMode()) return user;
        return Store.login(email, pass, true).then(function () { return user; });
      }).then(function (user) {
        $('#signupPassword').value = ''; $('#signupPassword2').value = '';
        Store.loadData();
        seedWelcome();
        try { enterApp(user); }
        catch (ex) { UI.toast({ type: 'err', title: 'تعذّر فتح التطبيق', text: ex.message }); }
      }).catch(function (ex) {
        err.textContent = ex.message || 'تعذّر إنشاء الحساب.';
        err.hidden = false;
      });
    });

    /* demo */
    var demoBtn = $('#demoBtn');
    if (demoBtn) {
      demoBtn.addEventListener('click', function () {
        var email = 'demo@secretary.app';
        var pass = 'demo1234';
        function enterDemo(user) {
          Store.loadData();
          var existing = (Store.data && Store.data.tasks || []).length > 0;
          if (!existing) seedDemo();
          enterApp(user);
        }
        Store.register({ name: 'مستخدم تجريبي', email: email, password: pass })
          .then(function () { return Store.login(email, pass, true); })
          .then(enterDemo)
          .catch(function (err) {
            return Store.login(email, pass, true).then(enterDemo)
              .catch(function (e2) {
                UI.toast({ type: 'err', title: 'تعذّر فتح الحساب التجريبي', text: e2.message });
              });
          });
      });
    }

    /* nav */
    window.addEventListener('hashchange', route);
    $$('.nav__item').forEach(function (a) {
      a.addEventListener('click', function () { closeSidebar(); });
    });

    /* topbar */
    $('#menuBtn').addEventListener('click', function () {
      if (isMobile()) toggleSidebar();
      else toggleCollapse();
    });
    $('#collapseBtn').addEventListener('click', function () {
      if (isMobile()) closeSidebar();
      else toggleCollapse();
    });
    $('#sidebarClose').addEventListener('click', closeSidebar);
    $('#scrim').addEventListener('click', closeSidebar);
    $('#themeBtn').addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      applyTheme(cur === 'dark' ? 'light' : 'dark', true);
    });
    $('#bellBtn').addEventListener('click', openMessages);
    $('#quickAddBtn').addEventListener('click', function () { taskModal(null); });
    $('#heroAddBtn').addEventListener('click', function () { taskModal(null); });
    $('#heroReadBtn').addEventListener('click', readDaySchedule);
    $('#heroParentsBtn').addEventListener('click', function () {
      var iso = state.view === 'day' ? dayDate(state.dayOffset) : today();
      sendToParents(buildParentsSummary(iso), { title: 'ملخص اليوم جاهز للمجموعة' });
    });
    $('#dayReadBtn').addEventListener('click', readDaySchedule);
    $('#lockBtn').addEventListener('click', lockApp);

    /* global search */
    var search = $('#globalSearch');
    var sTimer;
    search.addEventListener('input', function () {
      clearTimeout(sTimer);
      sTimer = setTimeout(function () {
        if (search.value.trim().length >= 2) openSearch(search.value.trim());
      }, 320);
    });
    search.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { clearTimeout(sTimer); openSearch(search.value.trim()); }
      if (e.key === 'Escape') { search.value = ''; }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement !== search &&
        !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
        e.preventDefault(); search.focus();
      }
      if (e.key === 'Escape') {
        Voice.stop();
        closeSelects();
        toggleUserMenu(false);
        if (isMobile()) closeSidebar();
      }
    });

    /* إغلاق قوائم <select> المفتوحة عند النقر خارجها */
    document.addEventListener('mousedown', function (e) {
      var act = document.activeElement;
      if (act && act.tagName === 'SELECT' && !act.contains(e.target)) act.blur();
    });

    /* day view */
    $$('[data-day-nav]').forEach(function (b) {
      b.addEventListener('click', function () { state.dayOffset += parseInt(b.dataset.dayNav, 10); renderDay(); });
    });
    $('#dayToday').addEventListener('click', function () { state.dayOffset = 0; renderDay(); });
    $('#dayFilters').addEventListener('click', function (e) {
      var b = e.target.closest('.seg__btn'); if (!b) return;
      $$('.seg__btn', $('#dayFilters')).forEach(function (x) { x.classList.remove('is-active'); });
      b.classList.add('is-active'); state.dayCat = b.dataset.cat; renderDay();
    });

    /* week view */
    $$('[data-week-nav]').forEach(function (b) {
      b.addEventListener('click', function () { state.weekOffset += parseInt(b.dataset.weekNav, 10); renderWeek(); });
    });
    $('#weekToday').addEventListener('click', function () { state.weekOffset = 0; renderWeek(); });
    $('#weekFilters').addEventListener('click', function (e) {
      var b = e.target.closest('.seg__btn'); if (!b) return;
      $$('.seg__btn', $('#weekFilters')).forEach(function (x) { x.classList.remove('is-active'); });
      b.classList.add('is-active'); state.weekCat = b.dataset.cat; renderWeek();
    });

    /* month view */
    $$('[data-month-nav]').forEach(function (b) {
      b.addEventListener('click', function () { state.monthOffset += parseInt(b.dataset.monthNav, 10); renderMonth(); });
    });
    $('#monthToday').addEventListener('click', function () { state.monthOffset = 0; renderMonth(); });

    /* tasks view */
    $('#taskSearch').addEventListener('input', function () { state.taskQuery = this.value; renderTasks(); });
    $('#taskCatFilter').addEventListener('change', function () { state.taskCat = this.value; renderTasks(); });
    $('#taskStatusFilter').addEventListener('change', function () { state.taskStatus = this.value; renderTasks(); });
    $('#taskSort').addEventListener('change', function () { state.taskSort = this.value; renderTasks(); });
    $('#taskFieldFilter').addEventListener('change', function () { state.taskField = this.value; renderTasks(); });

    /* notes */
    $('#addNoteBtn').addEventListener('click', function () { noteModal(null); });
    $('#noteReadAll').addEventListener('click', function () {
      var list = notes();
      if (!list.length) { UI.toast({ type: 'warn', title: 'لا توجد ملاحظات' }); return; }
      Voice.speakList(list.map(function (n) { return Voice.naturalize(n.title + '. ' + (n.text || '')); }));
    });

    /* plans */
    $('#addPlanBtn').addEventListener('click', function () { planModal(null); });

    /* custom fields */
    $('#addFieldBtn').addEventListener('click', function () { fieldModal(null); });

    /* archive & trash */
    $('#archiveTabs').addEventListener('click', function (e) {
      var b = e.target.closest('.seg__btn'); if (!b) return;
      $$('.seg__btn', $('#archiveTabs')).forEach(function (x) { x.classList.remove('is-active'); });
      b.classList.add('is-active');
      state.archiveTab = b.dataset.archiveTab;
      renderArchive();
    });
    $('#archiveCompletedBtn').addEventListener('click', archiveCompleted);
    $('#tasksArchiveDoneBtn').addEventListener('click', archiveCompleted);

    /* whatsapp settings */
    ['#waEnabled', '#waPhone', '#waLead', '#waProvider', '#waApiKey', '#waPhoneId', '#waToken', '#waTarget'].forEach(function (sel) {
      var el = $(sel);
      if (!el) return;
      var ev = (sel === '#waProvider' || sel === '#waTarget') ? 'change' : (sel === '#waLead' ? 'input' : 'change');
      el.addEventListener(ev, function () { saveWa(); });
    });
    $('#waProvider').addEventListener('change', syncWaRows);
    $('#waTestBtn').addEventListener('click', function () {
      saveWa();
      var w = waConfig();
      if (!Notify.validPhone(w.phone)) {
        UI.toast({ type: 'err', title: 'رقم غير صحيح', text: 'أدخل رقم واتساب بالصيغة الدولية (مثال: 213555757258).' });
        return;
      }
      Notify.test().then(function (res) {
        if (res && res.needTap) {
          UI.toast({
            type: 'info', title: 'جاهزة للإرسال', text: 'اضغط «فتح واتساب» لإرسال الرسالة التجريبية.',
            duration: 15000,
            actions: [{ label: 'فتح واتساب', onClick: function () { global.open(res.link, '_blank', 'noopener'); } }]
          });
        } else {
          UI.toast({ type: 'ok', title: 'أُرسلت الرسالة التجريبية', text: 'تحقق من محادثاتك على واتساب.' });
        }
      }).catch(function (e) {
        UI.toast({ type: 'err', title: 'تعذّر الإرسال', text: e.message });
      });
    });

    /* parents group settings */
    ['#pgLink', '#pgId', '#pgHeader', '#pgAuto'].forEach(function (sel) {
      var el = $(sel);
      if (!el) return;
      el.addEventListener('change', function () { saveParents(); renderParentsSettings(); });
    });
    $('#pgTime').addEventListener('input', function () {
      var h = parseInt(this.value, 10) || 0;
      $('#pgTimeVal').textContent = (h < 10 ? '0' : '') + h + ':00';
      saveParents();
    });
    $('#pgTestBtn').addEventListener('click', function () {
      saveParents();
      sendToParents(parentsHeader() + '\n\n✅ هذا اختبار من تطبيق سكرتاري — نظام تنبيه أولياء الأمور يعمل بشكل صحيح.', { title: 'رسالة تجريبية للمجموعة' });
    });
    $('#pgSendMsgBtn').addEventListener('click', function () {
      var txt = $('#pgMsg').value.trim();
      if (!txt) { UI.toast({ type: 'warn', title: 'اكتب الرسالة أولاً' }); return; }
      saveParents();
      sendToParents(parentsHeader() + '\n\n' + txt, { title: 'الرسالة جاهزة للإرسال' });
    });
    $('#pgSummaryBtn').addEventListener('click', function () {
      saveParents();
      var iso = state.view === 'day' ? dayDate(state.dayOffset) : today();
      sendToParents(buildParentsSummary(iso), { title: 'ملخص اليوم جاهز للمجموعة' });
    });

    /* supabase settings */
    $('#sbSaveBtn').addEventListener('click', function () {
      var url = $('#sbUrl').value.trim();
      var key = $('#sbKey').value.trim();
      if (!url || !key) {
        UI.toast({ type: 'err', title: 'بيانات ناقصة', text: 'أدخل Project URL ومفتاح anon.' });
        return;
      }
      SB.configure(url, key);
      renderSupabaseSettings();
      SB.ping().then(function (r) {
        if (r.ok) {
          renderSupabaseSettings();
          UI.toast({
            type: 'ok', title: 'تم الربط بقاعدة البيانات',
            text: 'سجّل خروجاً ثم ادخل بحساب Supabase لتفعيل المزامنة.'
          });
        } else {
          UI.toast({ type: 'err', title: 'تعذّر الاتصال', text: r.error });
        }
      }).catch(function (e) {
        UI.toast({ type: 'err', title: 'تعذّر الاتصال', text: e.message });
      });
    });
    $('#sbSyncBtn').addEventListener('click', function () {
      if (!SB.configured()) { UI.toast({ type: 'warn', title: 'الربط غير مفعّل' }); return; }
      Store.syncPull().then(function (ok) {
        renderAll();
        UI.toast({ type: ok ? 'ok' : 'err', title: ok ? 'تمت المزامنة' : 'تعذّرت المزامنة' });
      });
    });
    $('#emptyTrashBtn').addEventListener('click', function () {
      var st = Store.archiveStats();
      if (!st.trashed) { UI.toast({ type: 'warn', title: 'السلة فارغة' }); return; }
      UI.confirm({
        title: 'إفراغ سلة المحذوفات', danger: true, confirmLabel: 'حذف نهائي',
        text: 'سيُحذف ' + st.trashed + ' عنصراً نهائياً ولا يمكن استرجاعها. هل أنت متأكد؟'
      }).then(function (ok) {
        if (!ok) return;
        Store.emptyTrash();
        renderAll();
        UI.toast({ type: 'ok', title: 'تم إفراغ السلة' });
      });
    });

    /* settings */
    $('#setName').addEventListener('change', function () {
      var name = this.value.trim();
      if (!name) return;
      var users = Store.currentUser();
      if (!users) return;
      var all = JSON.parse(localStorage.getItem('secretary:v1:users') || '{}');
      if (all[users.id]) {
        all[users.id].name = name;
        localStorage.setItem('secretary:v1:users', JSON.stringify(all));
        $('#userName').textContent = name;
        $('#userAvatar').textContent = UI.initials(name);
        UI.toast({ type: 'ok', title: 'تم تحديث الاسم' });
        renderDashboard();
      }
    });
    $('#setVoice').addEventListener('change', function () {
      Voice.setVoice(this.value); Store.setSetting('voiceURI', this.value);
    });
    $('#setRate').addEventListener('input', function () {
      $('#rateVal').textContent = Number(this.value).toFixed(1);
      Voice.setRate(this.value); Store.setSetting('rate', parseFloat(this.value));
    });
    $('#setPitch').addEventListener('input', function () {
      $('#pitchVal').textContent = Number(this.value).toFixed(1);
      Voice.setPitch(this.value); Store.setSetting('pitch', parseFloat(this.value));
    });
    $('#setArabicNumbers').addEventListener('change', function () {
      Voice.setArabicNumbers(this.checked); Store.setSetting('arabicNumbers', this.checked);
    });
    $('#setLead').addEventListener('input', function () {
      $('#leadVal').textContent = this.value; Store.setSetting('lead', parseInt(this.value, 10));
    });
    $('#setDigest').addEventListener('change', function () { Store.setSetting('digest', this.checked); });
    $('#setAutoLock').addEventListener('change', function () { Store.setSetting('autoLock', this.checked); });
    $('#setDark').addEventListener('change', function () { applyTheme(this.checked ? 'dark' : 'light', true); });
    $('#setWeekStart').addEventListener('change', function () {
      Store.setSetting('weekStart', parseInt(this.value, 10)); renderWeek(); renderMonth();
    });
    $('#testVoiceBtn').addEventListener('click', function () {
      speakText('مرحباً، أنا سكرتاري. سأذكّرك بمهامك في وقتها.');
    });
    $('#notifBtn').addEventListener('click', function () {
      if (!('Notification' in global)) { UI.toast({ type: 'warn', title: 'غير مدعوم' }); return; }
      Notification.requestPermission().then(function (p) {
        renderSettings();
        UI.toast({
          type: p === 'granted' ? 'ok' : 'warn',
          title: p === 'granted' ? 'تم تفعيل الإشعارات' : 'لم يتم التفعيل',
          text: p === 'granted' ? 'ستصلك إشعارات عند موعد المهام.' : 'يمكنك تفعيلها من إعدادات المتصفح.'
        });
      });
    });
    $('#changePassBtn').addEventListener('click', changePassword);
    $('#exportBtn').addEventListener('click', exportData);
    $('#importBtn').addEventListener('click', function () { $('#importFile').click(); });
    $('#importFile').addEventListener('change', importData);
    $('#wipeBtn').addEventListener('click', function () {
      UI.confirm({
        title: 'حذف كل البيانات', danger: true, confirmLabel: 'حذف نهائي',
        text: 'سيتم حذف جميع مهامك وخططك وملاحظاتك ورسائلك. لا يمكن التراجع. هل أنت متأكد؟'
      }).then(function (ok) {
        if (!ok) return;
        Store.wipeMyData(); renderAll();
        UI.toast({ type: 'ok', title: 'تم حذف البيانات' });
      });
    });
    $('#wipeUsersBtn').addEventListener('click', function () {
      UI.confirm({
        title: 'مسح كل الحسابات', danger: true, confirmLabel: 'مسح',
        text: 'سيتم حذف جميع الحسابات المسجلة على هذا الجهاز نهائياً.'
      }).then(function (ok) {
        if (!ok) return;
        Store.wipeAllUsers();
        location.reload();
      });
    });
    $('#logoutBtn').addEventListener('click', function () {
      logoutApp();
    });

    /* lock & account menu */
    $('#lockUnlockBtn').addEventListener('click', unlockApp);
    $('#lockPassword').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); unlockApp(); }
    });
    $('#lockToggle').addEventListener('click', function () {
      var inp = $('#lockPassword');
      var show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      this.textContent = show ? 'إخفاء' : 'إظهار';
    });
    $('#lockLogoutBtn').addEventListener('click', function () { logoutApp(); });
    $('#lockAppBtn').addEventListener('click', function () { lockApp(); });

    $('#userBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      toggleUserMenu();
    });
    $('#menuProfile').addEventListener('click', function () { toggleUserMenu(false); setHash('settings'); });
    $('#menuSettings').addEventListener('click', function () { toggleUserMenu(false); setHash('settings'); });
    $('#menuLock').addEventListener('click', function () { toggleUserMenu(false); lockApp(); });
    $('#menuLogout').addEventListener('click', function () { toggleUserMenu(false); logoutApp(); });
    $('#menuLogoutAll').addEventListener('click', function () { toggleUserMenu(false); logoutEverywhere(); });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#userMenuWrap')) toggleUserMenu(false);
    });
    $('#forgotBtn').addEventListener('click', forgotPassword);

    /* delegated actions */
    document.addEventListener('click', onDelegated);
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (t.id === 'fDate' || t.id === 'fExpiry' || t.id === 'fStart') return;
    });

    /* idle auto-lock */
    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(function (ev) {
      document.addEventListener(ev, resetIdle, { passive: true });
    });

    window.addEventListener('online', function () { UI.toast({ type: 'ok', title: 'عاد الاتصال' }); });

    /* resize → إعادة رسم المخططات + ضبط حالة القائمة */
    var rTimer;
    window.addEventListener('resize', function () {
      clearTimeout(rTimer);
      rTimer = setTimeout(function () {
        if (!isMobile()) closeSidebar();
        render(state.view);
      }, 220);
    });
  }

  function closeSelects() {
    var open = document.querySelectorAll('select');
    for (var i = 0; i < open.length; i++) {
      if (document.activeElement === open[i]) open[i].blur();
    }
  }

  function onDelegated(e) {
    var el = e.target.closest('[data-toggle],[data-edit],[data-del],[data-speak],[data-open-task],[data-open-plan],[data-renew],[data-speak-plan],[data-edit-plan],[data-del-plan],[data-speak-note],[data-pin-note],[data-edit-note],[data-del-note],[data-msg-read],[data-msg-done],[data-add-task],[data-day],[data-edit-field],[data-del-field],[data-archive-task],[data-archive-plan],[data-archive-note],[data-unarchive],[data-trash],[data-restore],[data-purge],[data-send-group],[data-send-group-plan]');
    if (!el) return;

    if (el.hasAttribute('data-add-task')) { taskModal(null); return; }
    if (el.dataset.toggle) { toggleTask(el.dataset.toggle); return; }
    if (el.dataset.edit) { taskModal(Store.getTask(el.dataset.edit)); return; }
    if (el.dataset.del) { deleteTask(el.dataset.del); return; }
    if (el.dataset.speak) { speakTask(el.dataset.speak); return; }
    if (el.dataset.openTask) { openTask(el.dataset.openTask); return; }
    if (el.dataset.openPlan) { planModal(plans().filter(function (p) { return p.id === el.dataset.openPlan; })[0]); return; }
    if (el.dataset.renew) { renewPlan(el.dataset.renew); return; }
    if (el.dataset.speakPlan) { speakPlan(el.dataset.speakPlan); return; }
    if (el.dataset.editPlan) { planModal(plans().filter(function (p) { return p.id === el.dataset.editPlan; })[0]); return; }
    if (el.dataset.delPlan) { deletePlan(el.dataset.delPlan); return; }
    if (el.dataset.speakNote) { speakNote(el.dataset.speakNote); return; }
    if (el.dataset.pinNote) {
      var n = notes().filter(function (x) { return x.id === el.dataset.pinNote; })[0];
      if (n) { Store.updateNote(n.id, { pinned: !n.pinned }); renderNotes(); }
      return;
    }
    if (el.dataset.editNote) { noteModal(notes().filter(function (x) { return x.id === el.dataset.editNote; })[0]); return; }
    if (el.dataset.delNote) { deleteNote(el.dataset.delNote); return; }
    if (el.dataset.msgRead) {
      var m = messages().filter(function (x) { return x.id === el.dataset.msgRead; })[0];
      if (m) { speakText(m.title + '. ' + (m.text || '')); Store.markMessage(m.id, { spoken: true }); }
      return;
    }
    if (el.dataset.msgDone) { toggleTask(el.dataset.msgDone); return; }
    if (el.dataset.editField) {
      fieldModal(customFields().filter(function (f) { return f.id === el.dataset.editField; })[0]);
      return;
    }
    if (el.dataset.delField) { deleteField(el.dataset.delField); return; }
    if (el.dataset.archiveTask) { doArchive('task', el.dataset.archiveTask); return; }
    if (el.dataset.sendGroup) {
      var sgt = Store.getTask(el.dataset.sendGroup);
      if (sgt) sendToParents(buildParentsTask(sgt), { title: 'التنبيه جاهز للمجموعة' });
      return;
    }
    if (el.dataset.sendGroupPlan) {
      var sgp = plansAll().filter(function (x) { return x.id === el.dataset.sendGroupPlan; })[0];
      if (sgp) sendToParents(buildParentsPlan(sgp), { title: 'التنبيه جاهز للمجموعة' });
      return;
    }
    if (el.dataset.archivePlan) { doArchive('plan', el.dataset.archivePlan); return; }
    if (el.dataset.archiveNote) { doArchive('note', el.dataset.archiveNote); return; }
    if (el.dataset.unarchive) {
      var up = el.dataset.unarchive.split(':');
      doUnarchive(up[0], up[1]);
      return;
    }
    if (el.dataset.trash) {
      var tk = el.dataset.trash.split(':');
      var tItem = (KIND_MAP[tk[0]] === 'tasks' ? tasksAll() : KIND_MAP[tk[0]] === 'plans' ? plansAll() : notesAll())
        .filter(function (x) { return x.id === tk[1]; })[0];
      doTrash(tk[0], tk[1], tItem ? tItem.title : '');
      return;
    }
    if (el.dataset.restore) {
      var rs = el.dataset.restore.split(':');
      doRestore(rs[0], rs[1]);
      return;
    }
    if (el.dataset.purge) {
      var pg = el.dataset.purge.split(':');
      var pItem = (KIND_MAP[pg[0]] === 'tasks' ? tasksAll() : KIND_MAP[pg[0]] === 'plans' ? plansAll() : notesAll())
        .filter(function (x) { return x.id === pg[1]; })[0];
      doPurge(pg[0], pg[1], pItem ? pItem.title : '');
      return;
    }
    if (el.dataset.day && !el.dataset.openTask) {
      var iso = el.dataset.day;
      state.dayOffset = Store.daysBetween(today(), iso);
      setHash('day');
    }
  }

  function openTask(id) {
    var t = Store.getTask(id); if (!t) return;
    taskModal(t);
  }

  /* ---------------- messages modal ---------------- */
  function openMessages() {
    var list = messages();
    var body = document.createElement('div');
    if (!list.length) {
      body.innerHTML = '<div class="empty">' + UI.icon('bell') + '<b>لا توجد رسائل</b><span>ستظهر هنا تنبيهات مهامك.</span></div>';
    } else {
      body.innerHTML = '<div class="msgList" style="max-height:56vh">' + list.map(function (m) {
        var ic = m.kind === 'done' ? 'check' : m.kind === 'plan' ? 'plans' : 'bell';
        return '<div class="msg msg--' + esc(m.kind || 'info') + '">' +
          '<div class="msg__ico">' + UI.icon(ic) + '</div><div class="msg__body">' +
          '<div class="msg__title">' + esc(m.title) + '</div>' +
          '<div class="msg__meta">' + esc(m.text || '') + ' · ' + UI.relTime(m.ts) + '</div>' +
          '<div class="msg__acts">' +
          '<button class="btn btn--soft btn--sm" data-msg-read="' + m.id + '">' + UI.icon('speak') + 'اقرأ</button>' +
          (m.taskId ? '<button class="btn btn--soft btn--sm" data-msg-done="' + m.taskId + '">تم</button>' : '') +
          '</div></div></div>';
      }).join('') + '</div>';
    }
    UI.modal({
      title: 'مركز الرسائل', icon: 'bell', body: body,
      buttons: [
        { label: 'تعليم الكل كمقروء', class: 'btn--ghost', onClick: function () { messages().forEach(function (m) { Store.markMessage(m.id, { read: true }); }); renderBadges(); } },
        { label: 'مسح الكل', class: 'btn--danger', onClick: function () { Store.clearMessages(); renderBadges(); renderDashboard(); } },
        { label: 'إغلاق', class: 'btn--primary' }
      ]
    });
  }

  /* ---------------- search ---------------- */
  function openSearch(q) {
    var ql = q.toLowerCase();
    var tRes = tasks().filter(function (t) {
      return (t.title + ' ' + (t.notes || '')).toLowerCase().indexOf(ql) !== -1;
    }).slice(0, 8);
    var nRes = notes().filter(function (n) {
      return (n.title + ' ' + (n.text || '')).toLowerCase().indexOf(ql) !== -1;
    }).slice(0, 5);
    var pRes = plans().filter(function (p) {
      return (p.title + ' ' + (p.note || '')).toLowerCase().indexOf(ql) !== -1;
    }).slice(0, 5);

    var body = document.createElement('div');
    if (!tRes.length && !nRes.length && !pRes.length) {
      body.innerHTML = '<div class="empty">' + UI.icon('search') + '<b>لا نتائج لـ «' + UI.esc(q) + '»</b></div>';
    } else {
      var html = '';
      if (tRes.length) {
        html += '<p class="nav__label" style="padding:0 0 8px">مهام</p>' + tRes.map(function (t) {
          return '<div class="mini" data-open-task="' + t.id + '" style="cursor:pointer"><div class="mini__ico">' + UI.icon('tasks') + '</div>' +
            '<div class="mini__body"><div class="mini__title">' + UI.esc(t.title) + '</div>' +
            '<div class="mini__meta">' + UI.fmtDate(t.date) + (t.time ? ' · ' + t.time : '') + ' · ' + (t.category === 'work' ? 'عمل' : 'شخصي') + '</div></div></div>';
        }).join('');
      }
      if (pRes.length) {
        html += '<p class="nav__label" style="padding:14px 0 8px">خطط</p>' + pRes.map(function (p) {
          return '<div class="mini" data-open-plan="' + p.id + '" style="cursor:pointer"><div class="mini__ico">' + UI.icon('plans') + '</div>' +
            '<div class="mini__body"><div class="mini__title">' + UI.esc(p.title) + '</div>' +
            '<div class="mini__meta">تنتهي في ' + UI.fmtDate(p.expiryDate) + '</div></div></div>';
        }).join('');
      }
      if (nRes.length) {
        html += '<p class="nav__label" style="padding:14px 0 8px">ملاحظات</p>' + nRes.map(function (n) {
          return '<div class="mini" data-open-note="' + n.id + '" style="cursor:pointer"><div class="mini__ico">' + UI.icon('notes') + '</div>' +
            '<div class="mini__body"><div class="mini__title">' + UI.esc(n.title) + '</div>' +
            '<div class="mini__meta">' + UI.esc((n.text || '').slice(0, 60)) + '</div></div></div>';
        }).join('');
      }
      body.innerHTML = '<div class="miniList">' + html + '</div>';
    }

    var m = UI.modal({ title: 'نتائج البحث: ' + q, icon: 'search', body: body, buttons: [{ label: 'إغلاق', class: 'btn--ghost' }] });
    body.addEventListener('click', function (e) {
      var t = e.target.closest('[data-open-task],[data-open-plan],[data-open-note]');
      if (!t) return;
      m.close();
      if (t.dataset.openTask) { openTask(t.dataset.openTask); }
      else if (t.dataset.openPlan) { planModal(plans().filter(function (p) { return p.id === t.dataset.openPlan; })[0]); }
      else if (t.dataset.openNote) { noteModal(notes().filter(function (n) { return n.id === t.dataset.openNote; })[0]); }
    });
  }

  /* ---------------- password change ---------------- */
  function changePassword() {
    var body = document.createElement('div');
    body.innerHTML =
      '<div class="field"><label>كلمة المرور الحالية</label>' +
      '<div class="field__ctrl"><input id="cpOld" type="password" autocomplete="current-password"></div></div>' +
      '<div class="field"><label>كلمة المرور الجديدة</label>' +
      '<div class="field__ctrl"><input id="cpNew" type="password" autocomplete="new-password" placeholder="6 أحرف على الأقل"></div></div>' +
      '<div class="field"><label>تأكيد الجديدة</label>' +
      '<div class="field__ctrl"><input id="cpNew2" type="password" autocomplete="new-password"></div></div>';
    UI.modal({
      title: 'تغيير كلمة المرور', icon: 'lock', body: body,
      buttons: [
        { label: 'إلغاء', class: 'btn--ghost' },
        {
          label: 'تغيير', class: 'btn--primary', onClick: function () {
            var oldP = body.querySelector('#cpOld').value;
            var newP = body.querySelector('#cpNew').value;
            var newP2 = body.querySelector('#cpNew2').value;
            if (newP !== newP2) { UI.toast({ type: 'err', title: 'كلمتا المرور غير متطابقتين' }); return false; }
            if (newP.length < 6) { UI.toast({ type: 'err', title: 'كلمة المرور قصيرة' }); return false; }
            var user = Store.currentUser();
            if (!user) return false;
            return Store.hashPassword(oldP, user.salt).then(function (h) {
              if (h !== user.hash) {
                UI.toast({ type: 'err', title: 'كلمة المرور الحالية غير صحيحة' });
                return false;
              }
              return Store.hashPassword(newP, user.salt).then(function (nh) {
                var all = JSON.parse(localStorage.getItem('secretary:v1:users') || '{}');
                if (all[user.id]) { all[user.id].hash = nh; localStorage.setItem('secretary:v1:users', JSON.stringify(all)); }
                UI.toast({ type: 'ok', title: 'تم تغيير كلمة المرور' });
              });
            });
          }
        }
      ]
    });
  }

  /* ---------------- import / export ---------------- */
  function exportData() {
    var payload = Store.exportData();
    if (!payload) return;
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'secretary-backup-' + today() + '.json';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    UI.toast({ type: 'ok', title: 'تم تصدير نسخة احتياطية' });
  }

  function importData(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(reader.result); }
      catch (err) { UI.toast({ type: 'err', title: 'ملف غير صالح' }); return; }
      UI.confirm({
        title: 'استيراد نسخة', danger: true, confirmLabel: 'استيراد',
        text: 'سيتم استبدال بياناتك الحالية ببيانات الملف. هل أنت متأكد؟'
      }).then(function (ok) {
        if (!ok) return;
        Store.importData(parsed).then(function () {
          renderAll();
          UI.toast({ type: 'ok', title: 'تم الاستيراد بنجاح' });
        }).catch(function (err) {
          UI.toast({ type: 'err', title: 'فشل الاستيراد', text: err.message });
        });
      });
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  /* ---------------- lock / idle ---------------- */
  function lockApp() {
    state.locked = true;
    Voice.stop();
    showLock();
  }

  function resetIdle() {
    state.lastActivity = Date.now();
    if (state.idleTimer) clearTimeout(state.idleTimer);
    if (!Store.currentUser()) return;
    state.idleTimer = setTimeout(function () {
      if (settings().autoLock) lockApp();
    }, 15 * 60 * 1000);
  }

  /* ---------------- sidebar ---------------- */
  function isMobile() { return window.innerWidth <= 1024; }

  function openSidebar() {
    var sb = $('#sidebar');
    if (!sb) return;
    sb.classList.add('is-open');
    sb.setAttribute('aria-hidden', 'false');
    var sc = $('#scrim');
    if (sc) sc.hidden = false;
    document.body.classList.add('drawer-open');
  }
  function closeSidebar() {
    var sb = $('#sidebar');
    if (sb) {
      sb.classList.remove('is-open');
      sb.setAttribute('aria-hidden', 'true');
    }
    var sc = $('#scrim');
    if (sc) sc.hidden = true;
    document.body.classList.remove('drawer-open');
  }
  function toggleSidebar() {
    var sb = $('#sidebar');
    if (!sb) return;
    if (sb.classList.contains('is-open')) closeSidebar();
    else openSidebar();
  }

  /* طيّ / فتح القائمة الجانبية على الشاشات الكبيرة */
  function toggleCollapse(force) {
    var shell = $('.shell');
    if (!shell) return;
    var collapsed = force === undefined ? !shell.classList.contains('is-collapsed') : !!force;
    shell.classList.toggle('is-collapsed', collapsed);
    localStorage.setItem('secretary:v1:collapsed', collapsed ? '1' : '0');
    var btn = $('#collapseBtn');
    if (btn) {
      btn.title = collapsed ? 'فتح القائمة الجانبية' : 'طيّ القائمة الجانبية';
      btn.setAttribute('aria-label', btn.title);
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
    setTimeout(function () { render(state.view); }, 320);
  }
  function restoreCollapse() {
    var saved = localStorage.getItem('secretary:v1:collapsed');
    if (saved === '1') toggleCollapse(true);
    else toggleCollapse(false);
  }

  /* ==========================================================
     seed data
     ========================================================== */
  function seedWelcome() {
    var t = today();
    Store.addTask({
      title: 'مراجعة أهداف اليوم', notes: 'ما أهم ٣ أولويات لهذا اليوم؟',
      date: t, time: '09:00', category: 'personal', priority: 'med', reminder: true, repeat: 'daily'
    });
    Store.addTask({
      title: 'متابعة البريد والردود المعلّقة', date: t, time: '11:30',
      category: 'work', priority: 'high', reminder: true
    });
    Store.addTask({
      title: 'تمارين رياضية', date: t, time: '18:00',
      category: 'personal', priority: 'low', reminder: true, repeat: 'weekly'
    });
    Store.addTask({
      title: 'تقرير المشروع الأسبوعي', date: Store.addDays(t, 1), time: '10:00',
      category: 'work', priority: 'high', reminder: true, repeat: 'weekly'
    });
    Store.addPlan({
      title: 'اشتراك التصميم', category: 'work', startDate: t,
      expiryDate: Store.addDays(t, 12), cycle: 'monthly', autoRenew: true, cost: 249
    });
    Store.addPlan({
      title: 'شهادةebb — تجديد سنوي', category: 'personal', startDate: t,
      expiryDate: Store.addDays(t, 45), cycle: 'yearly', autoRenew: true
    });
    Store.addNote({
      title: 'أفكار شخصية', text: 'دوّن هنا أي فكرة تطرأ لك أثناء التنقل، وسأقرأها لك بصوت مسموع.',
      color: '#0d9488'
    });
  }

  function seedDemo() {
    var t = today();
    var names = [
      ['اجتماع مراجعة الميزانية', 'work', '08:30', 'high', 0],
      ['إرسال تقرير المشروع', 'work', '10:00', 'high', 0],
      ['مكالمة مع العميل', 'work', '13:00', 'med', 0],
      ['تحديث لوحة المهام', 'work', '15:30', 'low', 0],
      ['رياضة و Probablement مشي', 'personal', '17:00', 'med', 0],
      ['قراءة ٣٠ صفحة', 'personal', '21:00', 'low', 0]
    ];
    names.forEach(function (n) {
      Store.addTask({
        title: n[0], category: n[1], date: t, time: n[2], priority: n[3],
        reminder: true, duration: 45
      });
    });
    Store.addTask({
      title: 'اجتماع التخطيط الأسبوعي', category: 'work',
      date: Store.addDays(t, 1), time: '09:30', priority: 'high', reminder: true, repeat: 'weekly'
    });
    Store.addTask({
      title: 'موعد الطبيب', category: 'personal',
      date: Store.addDays(t, 3), time: '12:00', priority: 'high', reminder: true
    });
    Store.addTask({
      title: 'دفع فاتورة الكهرباء', category: 'personal',
      date: Store.addDays(t, 2), time: '19:00', priority: 'med', reminder: true
    });
    Store.addPlan({
      title: 'اشتراك مساحة العمل', category: 'work', startDate: t,
      expiryDate: Store.addDays(t, 5), cycle: 'monthly', autoRenew: true, cost: 350
    });
    Store.addPlan({
      title: 'العضوية السنوية', category: 'personal', startDate: t,
      expiryDate: Store.addDays(t, 9), cycle: 'yearly', autoRenew: true, cost: 120
    });
    Store.addPlan({
      title: 'تجديد بطاقة الهوية', category: 'personal', startDate: t,
      expiryDate: Store.addDays(t, 60), cycle: 'yearly', autoRenew: false
    });
    Store.addNote({
      title: 'قائمة مشتريات', text: 'قهوة، حليب، خبز، تفاح، ماء.',
      color: '#d97706'
    });
    Store.addNote({
      title: 'أهداف الشهر', text: 'إنجاز ٢٠ مهمة عمل.\nقراءة كتابين.\nالرياضة ٣ مرات أسبوعياً.',
      color: '#7c3aed'
    });
    Store.pushMessage({
      title: 'أهلاً بك في سكرتاري', kind: 'info',
      text: 'كل شيء جاهز — جرّب تنبيهات المهام والقراءة الصوتية من الإعدادات.'
    });
  }

  /* ==========================================================
     go
     ========================================================== */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.App = { state: state, render: render, renderAll: renderAll, taskModal: taskModal, planModal: planModal, noteModal: noteModal, speakText: speakText };
})(window);
