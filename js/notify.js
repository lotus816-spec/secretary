/* ============================================================
   سكرتاري | Secretary — Notification Channels
   إرسال التذكيرات عبر واتساب بثلاث طرق:
   1) link      : يفتح محادثة واتساب جاهزة (يعمل فوراً بدون إعدادات)
   2) callmebot : واجهة CallMeBot المجانية (رسالة من رقمك)
   3) meta      : WhatsApp Cloud API من Meta Business
   ============================================================ */
(function (global) {
  'use strict';

  var defaults = {
    enabled: false,
    phone: '',
    provider: 'link',
    lead: 30,
    apikey: '',
    phoneNumberId: '',
    accessToken: '',
    target: 'number',     // number | group
    groupLink: '',        // https://chat.whatsapp.com/XXXX
    groupId: ''           // معرّف المجموعة (Meta Cloud API)
  };

  var cfg = Object.assign({}, defaults);
  var onStatus = [];

  function configure(patch) {
    cfg = Object.assign({}, cfg, patch || {});
    for (var i = 0; i < onStatus.length; i++) {
      try { onStatus[i](cfg); } catch (e) { /* ignore */ }
    }
    return cfg;
  }
  function onChange(cb) { onStatus.push(cb); cb(cfg); }

  function cleanPhone(p) {
    return String(p || '').replace(/[^\d]/g, '');
  }
  function validPhone(p) {
    var d = cleanPhone(p);
    return d.length >= 8 && d.length <= 15;
  }
  function enabled() {
    if (cfg.target === 'group') return !!(cfg.enabled && groupCode());
    return !!(cfg.enabled && validPhone(cfg.phone));
  }

  /* ---------- المجموعات (قروب الأولياء) ---------- */
  function groupCode(link) {
    var s = String(link || cfg.groupLink || '');
    var m = s.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
    if (m) return m[1];
    m = s.match(/^([A-Za-z0-9]{8,})$/);
    return m ? m[1] : '';
  }
  function groupUrl(link) {
    var code = groupCode(link);
    return code ? ('https://chat.whatsapp.com/' + code) : '';
  }
  function groupReady() {
    return !!(cfg.groupLink || cfg.groupId);
  }

  /* ---------- 1) رابط محادثة واتساب ---------- */
  function chatLink(text, phone) {
    var num = cleanPhone(phone || cfg.phone);
    return 'https://wa.me/' + num + '?text=' + encodeURIComponent(text);
  }
  function openChat(text) {
    var url = chatLink(text);
    global.open(url, '_blank', 'noopener');
    return url;
  }

  /* ---------- 2) CallMeBot ---------- */
  function callMeBot(text) {
    if (!cfg.apikey) return Promise.reject(new Error('مفتاح CallMeBot مطلوب.'));
    if (!validPhone(cfg.phone)) return Promise.reject(new Error('رقم واتساب غير صحيح.'));
    var url = 'https://api.callmebot.com/whatsapp.php?phone=' + cleanPhone(cfg.phone) +
      '&text=' + encodeURIComponent(text) + '&apikey=' + encodeURIComponent(cfg.apikey);
    return fetch(url, { cache: 'no-store' })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        if (/not activated|not allowed|invalid apikey/i.test(t)) {
          return Promise.reject(new Error(t));
        }
        return t;
      });
  }

  /* ---------- 3) WhatsApp Cloud API (Meta) ---------- */
  function metaCloud(text) {
    if (!cfg.accessToken || !cfg.phoneNumberId) {
      return Promise.reject(new Error('يلزم Phone Number ID و Access Token من Meta for Developers.'));
    }
    var to = cfg.target === 'group' ? (cfg.groupId || '') : cleanPhone(cfg.phone);
    if (!to) return Promise.reject(new Error('حدّد معرّف المجموعة (Group ID) من Meta.'));
    var payload = {
      messaging_product: 'whatsapp',
      to: to,
      type: 'text',
      text: { body: text }
    };
    if (cfg.target === 'group') payload.recipient_type = 'group';
    var url = 'https://graph.facebook.com/v19.0/' + encodeURIComponent(cfg.phoneNumberId) + '/messages';
    return fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + cfg.accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.text().then(function (t) {
        if (!r.ok) {
          var msg = t;
          try { var j = JSON.parse(t); msg = (j.error && j.error.message) || t; } catch (e) { }
          return Promise.reject(new Error(msg));
        }
        return t;
      });
    });
  }

  /* ---------- الإرسال الموحّد ---------- */
  function send(text, opts) {
    opts = opts || {};
    if (!cfg.enabled) return Promise.resolve({ skipped: true });
    var body = String(text || '').slice(0, 900);

    /* --- مجموعة واتساب (قروب الأولياء) --- */
    if (cfg.target === 'group') {
      if (cfg.provider === 'callmebot') {
        return Promise.reject(new Error('CallMeBot لا يدعم المجموعات — استخدم رابط الدعوة أو Meta Cloud API.'));
      }
      if (cfg.provider === 'meta') return metaCloud(body);
      var url = groupUrl();
      if (!url) return Promise.reject(new Error('أضف رابط دعوة المجموعة (chat.whatsapp.com/...).'));
      return Promise.resolve({ link: url, needTap: true, group: true });
    }

    /* --- رقم فردي --- */
    if (!validPhone(cfg.phone)) return Promise.resolve({ skipped: true });
    if (cfg.provider === 'callmebot') return callMeBot(body);
    if (cfg.provider === 'meta') return metaCloud(body);
    return Promise.resolve({ link: chatLink(body), needTap: true });
  }

  function test() {
    var txt = '✅ هذا اختبار من تطبيق سكرتاري — نظام التذكير يعمل بشكل صحيح.';
    return send(txt);
  }

  global.Notify = {
    configure: configure,
    onChange: onChange,
    get config() { return cfg; },
    enabled: enabled,
    validPhone: validPhone,
    cleanPhone: cleanPhone,
    chatLink: chatLink,
    openChat: openChat,
    groupCode: groupCode,
    groupUrl: groupUrl,
    groupReady: groupReady,
    send: send,
    test: test
  };
})(window);
