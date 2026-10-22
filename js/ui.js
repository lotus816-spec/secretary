/* ============================================================
   سكرتاري | Secretary — UI Kit
   Toasts, modals, confirm dialogs, formatters, icons.
   ============================================================ */
(function (global) {
  'use strict';

  var toastHost, modalHost;

  function host() {
    if (!toastHost) toastHost = document.getElementById('toastHost');
    return toastHost;
  }
  function mhost() {
    if (!modalHost) modalHost = document.getElementById('modalHost');
    return modalHost;
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function icon(name, cls) {
    return '<svg viewBox="0 0 24 24"' + (cls ? ' class="' + cls + '"' : '') + '><use href="#i-' + name + '"/></svg>';
  }

  /* ---------------- toast ---------------- */
  function toast(opts) {
    opts = opts || {};
    var h = host(); if (!h) return null;
    var type = opts.type || 'info';
    var icons = { info: 'bell', ok: 'check', warn: 'flame', err: 'x' };
    var ttl = opts.duration === undefined ? (type === 'err' ? 7000 : 4800) : opts.duration;

    var el = document.createElement('div');
    el.className = 'toast toast--' + type;
    el.setAttribute('role', type === 'err' ? 'alert' : 'status');

    var acts = '';
    if (opts.actions && opts.actions.length) {
      acts = '<div class="toast__acts"></div>';
    }
    el.innerHTML =
      '<div class="toast__ico">' + icon(icons[type] || 'bell') + '</div>' +
      '<div class="toast__body">' +
      (opts.title ? '<div class="toast__title">' + esc(opts.title) + '</div>' : '') +
      (opts.text ? '<div class="toast__text">' + esc(opts.text) + '</div>' : '') +
      acts +
      '</div>' +
      '<button class="toast__x" aria-label="إغلاق">' + icon('x') + '</button>';

    if (opts.actions && opts.actions.length) {
      var box = el.querySelector('.toast__acts');
      opts.actions.forEach(function (a) {
        var b = document.createElement('button');
        b.className = 'btn btn--soft btn--sm';
        b.textContent = a.label;
        b.addEventListener('click', function () {
          if (a.onClick) a.onClick();
          close();
        });
        box.appendChild(b);
      });
    }

    function close() {
      if (!el.parentNode) return;
      el.classList.add('is-out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    }
    el.querySelector('.toast__x').addEventListener('click', close);
    h.appendChild(el);
    if (ttl > 0) setTimeout(close, ttl);
    return { close: close, el: el };
  }

  /* ---------------- modal ---------------- */
  var openModals = [];
  function modal(opts) {
    opts = opts || {};
    var host = mhost(); if (!host) return null;

    var wrap = document.createElement('div');
    wrap.className = 'modalHost';
    wrap.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal__head">' +
      '<h3>' + (opts.icon ? icon(opts.icon) : '') + '<span>' + esc(opts.title || '') + '</span></h3>' +
      '<button class="iconBtn" data-close aria-label="إغلاق">' + icon('x') + '</button>' +
      '</div>' +
      '<div class="modal__body"></div>' +
      '<div class="modal__foot"></div>' +
      '</div>';

    var body = wrap.querySelector('.modal__body');
    if (typeof opts.body === 'string') body.innerHTML = opts.body;
    else if (opts.body) body.appendChild(opts.body);

    var foot = wrap.querySelector('.modal__foot');
    var api = { el: wrap, body: body, close: close };

    (opts.buttons || []).forEach(function (b) {
      var btn = document.createElement('button');
      btn.className = 'btn ' + (b.class || 'btn--ghost');
      btn.textContent = b.label;
      btn.addEventListener('click', function () {
        if (b.onClick) {
          var res = b.onClick(api);
          if (res === false) return;
        }
        if (b.keepOpen !== true) close();
      });
      foot.appendChild(btn);
    });

    function close() {
      if (!wrap.parentNode) return;
      // إغلاق أي قائمة <select> مفتوحة داخل النافذة
      var sels = wrap.querySelectorAll('select');
      for (var i = 0; i < sels.length; i++) { if (document.activeElement === sels[i]) sels[i].blur(); }
      wrap.parentNode.removeChild(wrap);
      openModals = openModals.filter(function (m) { return m !== api; });
      if (!openModals.length) {
        document.body.classList.remove('is-locked');
        host.hidden = true;              // إخفاء طبقة التعتيم بعد إغلاق آخر نافذة
      }
      if (opts.onClose) opts.onClose();
    }
    api.close = close;

    wrap.querySelector('[data-close]').addEventListener('click', close);
    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) close(); });

    host.hidden = false;
    host.appendChild(wrap);
    document.body.classList.add('is-locked');
    openModals.push(api);

    setTimeout(function () {
      var f = wrap.querySelector('input,textarea,select');
      if (f && !opts.noFocus) f.focus();
    }, 60);

    return api;
  }

  function confirmDialog(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var settled = false;
      modal({
        title: opts.title || 'تأكيد',
        icon: opts.icon || 'flame',
        body: '<p style="font-size:14px;line-height:1.9;color:var(--text-2)">' + (opts.html || esc(opts.text || '')) + '</p>',
        buttons: [
          { label: opts.cancelLabel || 'إلغاء', class: 'btn--ghost', onClick: function () { settled = true; resolve(false); } },
          {
            label: opts.confirmLabel || 'تأكيد', class: opts.danger ? 'btn--danger' : 'btn--primary',
            onClick: function () { settled = true; resolve(true); }
          }
        ],
        onClose: function () { if (!settled) resolve(false); }
      });
    });
  }

  function promptDialog(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var settled = false;
      var body = document.createElement('div');
      body.innerHTML =
        '<div class="field"><label>' + esc(opts.label || 'القيمة') + '</label>' +
        '<div class="field__ctrl"><input id="__promptInput" type="' + (opts.type || 'text') + '" value="' + esc(opts.value || '') + '" placeholder="' + esc(opts.placeholder || '') + '"></div></div>' +
        (opts.hint ? '<small class="hint">' + esc(opts.hint) + '</small>' : '');
      modal({
        title: opts.title || 'إدخال',
        icon: opts.icon || 'edit',
        body: body,
        buttons: [
          { label: 'إلغاء', class: 'btn--ghost', onClick: function () { settled = true; resolve(null); } },
          {
            label: opts.confirmLabel || 'حفظ', class: 'btn--primary', onClick: function (api) {
              var v = body.querySelector('#__promptInput').value;
              settled = true; resolve(v);
            }
          }
        ],
        onClose: function () { if (!settled) resolve(null); }
      });
    });
  }

  /* ---------------- formatters ---------------- */
  var MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  var DAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var DAYS_SHORT = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];

  function fmtDate(iso, opts) {
    opts = opts || {};
    var p = String(iso || '').split('-');
    if (p.length < 3) return '—';
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    if (isNaN(d.getTime())) return '—';
    var out = d.getDate() + ' ' + MONTHS_AR[d.getMonth()];
    if (opts.year !== false) out += ' ' + d.getFullYear();
    if (opts.weekday) out = DAYS_AR[d.getDay()] + '، ' + out;
    return out;
  }
  function fmtDateShort(iso) {
    var p = String(iso || '').split('-');
    if (p.length < 3) return '—';
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return d.getDate() + '/' + (d.getMonth() + 1);
  }
  function weekdayName(iso, short) {
    var p = String(iso || '').split('-');
    if (p.length < 3) return '';
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return short ? DAYS_SHORT[d.getDay()] : DAYS_AR[d.getDay()];
  }
  function fmtTime(hhmm) {
    if (!hhmm) return '';
    var p = String(hhmm).split(':');
    var h = parseInt(p[0], 10), m = p[1] || '00';
    var ap = h >= 12 ? 'م' : 'ص';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ':' + m + ' ' + ap;
  }
  function relDay(iso) {
    var diff = Store.daysBetween(Store.todayISO(), iso);
    if (diff === 0) return 'اليوم';
    if (diff === 1) return 'غداً';
    if (diff === 2) return 'بعد غد';
    if (diff === -1) return 'أمس';
    if (diff < 0) return 'متأخر ' + Math.abs(diff) + ' يوم';
    if (diff <= 7) return 'بعد ' + diff + ' أيام';
    if (diff <= 30) return 'بعد ' + Math.round(diff / 7) + ' أسابيع';
    return fmtDate(iso);
  }
  function relTime(ts) {
    var diff = Date.now() - ts;
    if (diff < 60000) return 'الآن';
    if (diff < 3600000) return 'قبل ' + Math.floor(diff / 60000) + ' دقيقة';
    if (diff < 86400000) return 'قبل ' + Math.floor(diff / 3600000) + ' ساعة';
    if (diff < 172800000) return 'أمس';
    var d = new Date(ts);
    return d.getDate() + ' ' + MONTHS_AR[d.getMonth()];
  }
  function plural(n, one, two, few, many) {
    if (n === 1) return one;
    if (n === 2) return two;
    if (n >= 3 && n <= 10) return few;
    return many;
  }
  function daysLabel(n) {
    if (n < 0) return 'منتهٍ منذ ' + Math.abs(n) + ' يوم';
    if (n === 0) return 'ينتهي اليوم';
    if (n === 1) return 'يتبقى يوم واحد';
    if (n === 2) return 'يتبقى يومان';
    if (n <= 10) return 'يتبقى ' + n + ' أيام';
    return 'يتبقى ' + Math.round(n / 30) + ' شهر تقريباً';
  }
  function initials(name) {
    var parts = String(name || '؟').trim().split(/\s+/);
    if (parts.length > 1) return (parts[0].charAt(0) + parts[1].charAt(0)).slice(0, 2).toUpperCase();
    return String(name || '؟').charAt(0).toUpperCase();
  }

  global.UI = {
    toast: toast, modal: modal, confirm: confirmDialog, prompt: promptDialog,
    esc: esc, icon: icon,
    fmtDate: fmtDate, fmtDateShort: fmtDateShort, fmtTime: fmtTime,
    weekdayName: weekdayName, relDay: relDay, relTime: relTime,
    daysLabel: daysLabel, initials: initials, plural: plural,
    MONTHS_AR: MONTHS_AR, DAYS_AR: DAYS_AR, DAYS_SHORT: DAYS_SHORT
  };
})(window);
