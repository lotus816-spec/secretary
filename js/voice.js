/* ============================================================
   سكرتاري | Secretary — Voice Engine
   Web Speech API (speechSynthesis) + Arabic naturalisation of
   numbers, times and dates so reminders sound human.
   ============================================================ */
(function (global) {
  'use strict';

  var synth = global.speechSynthesis || null;
  var hasUtterance = typeof global.SpeechSynthesisUtterance === 'function';
  var voices = [];
  var chosenURI = '';
  var rate = 1, pitch = 1;
  var arabicNumbers = true;
  var currentUtterance = null;
  var queue = [];
  var onEndCb = null;
  var voiceListeners = [];
  var audioCtx = null;

  /* ---------------- voices ---------------- */
  function refresh() {
    if (!synth) return;
    try { voices = synth.getVoices() || []; } catch (e) { voices = []; }
    for (var i = 0; i < voiceListeners.length; i++) {
      try { voiceListeners[i](voices); } catch (e) { /* ignore */ }
    }
  }
  if (synth) {
    refresh();
    if (typeof synth.addEventListener === 'function') {
      synth.addEventListener('voiceschanged', refresh);
    } else {
      synth.onvoiceschanged = refresh;
    }
    // Some browsers populate voices slightly after load.
    setTimeout(refresh, 350);
    setTimeout(refresh, 1200);
  }

  function onVoices(cb) { voiceListeners.push(cb); cb(voices); }
  function list() { refresh(); return voices; }

  function pickVoice(lang) {
    lang = lang || 'ar';
    if (!voices.length) refresh();
    if (chosenURI) {
      for (var i = 0; i < voices.length; i++) if (voices[i].voiceURI === chosenURI) return voices[i];
    }
    var pref = [
      'Microsoft Hoda', 'Microsoft Hoda Speech', 'Google العربية', 'Google ar-SA',
      'Microsoft Arabic', 'Microsoft Isis', 'Microsoft Salma', 'Microsoft Amel',
      'Samantha', 'Karen', 'Daniel'
    ];
    for (var p = 0; p < pref.length; p++) {
      for (var j = 0; j < voices.length; j++) {
        if (voices[j].name && voices[j].name.indexOf(pref[p]) !== -1) return voices[j];
      }
    }
    for (var k = 0; k < voices.length; k++) {
      if (voices[k].lang && voices[k].lang.toLowerCase().indexOf(lang) === 0) return voices[k];
    }
    for (var m = 0; m < voices.length; m++) {
      if (voices[m].lang && voices[m].lang.toLowerCase().indexOf(lang.slice(0, 2)) !== -1) return voices[m];
    }
    return voices[0] || null;
  }

  function setVoice(uri) { chosenURI = uri || ''; }
  function setRate(r) { rate = Math.min(2, Math.max(0.5, parseFloat(r) || 1)); }
  function setPitch(p) { pitch = Math.min(2, Math.max(0.5, parseFloat(p) || 1)); }
  function setArabicNumbers(v) { arabicNumbers = !!v; }
  function available() { return !!(synth && hasUtterance); }

  /* ---------------- Arabic number words ---------------- */
  var ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
    'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  var TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];

  function numToArabic(n) {
    n = Math.floor(Math.abs(n));
    if (n < 20) return ONES[n];
    if (n < 100) {
      var t = Math.floor(n / 10), o = n % 10;
      if (o === 0) return TENS[t];
      if (t === 2) return 'اثنان و' + TENS[t];
      if (t === 3) return 'ثلاثة و' + TENS[t];
      if (t === 4) return 'أربعة و' + TENS[t];
      if (t === 5) return 'خمسة و' + TENS[t];
      if (t === 6) return 'ستة و' + TENS[t];
      if (t === 7) return 'سبعة و' + TENS[t];
      if (t === 8) return 'ثمانية و' + TENS[t];
      return 'تسعة و' + TENS[t];
    }
    if (n < 1000) {
      var h = Math.floor(n / 100), r = n % 100;
      var hPart = h === 1 ? 'مئة' : h === 2 ? 'مئتان' : numToArabic(h) + ' مئة';
      return r ? hPart + ' و' + numToArabic(r) : hPart;
    }
    return String(n);
  }

  var HOURS = ['', 'الواحدة', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة',
    'الثامنة', 'التاسعة', 'العاشرة', 'الحادية عشرة', 'الثانية عشرة'];

  function timeToArabic(hhmm) {
    if (!hhmm) return '';
    var p = String(hhmm).split(':');
    var h = parseInt(p[0], 10), m = parseInt(p[1] || '0', 10);
    if (isNaN(h)) return '';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    var hourWord = HOURS[h12];
    var part = '';
    if (m === 0) part = hourWord;
    else if (m === 15) part = hourWord + ' والربع';
    else if (m === 30) part = hourWord + ' والنصف';
    else if (m === 45) part = hourWord + ' وثلاثة أرباع';
    else if (m < 10) part = hourWord + ' و' + ONES[m] + ' دقائق';
    else part = hourWord + ' و' + numToArabic(m) + ' دقيقة';

    var period = '';
    if (h < 12) period = 'صباحاً';
    else if (h < 17) period = 'ظهراً';
    else if (h < 20) period = 'مساءً';
    else period = 'ليلاً';
    return 'الساعة ' + part + ' ' + period;
  }

  var MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  var DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  function dateToArabic(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    if (p.length < 3) return '';
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    if (isNaN(d.getTime())) return '';
    var s = DAYS[d.getDay()] + ' ' + numToArabic(d.getDate()) + ' ' + MONTHS[d.getMonth()];
    if (+p[0] !== d.getFullYear()) s += ' ' + numToArabic(+p[0]);
    return s;
  }

  /* ---------------- naturalisation ---------------- */
  function naturalize(text) {
    if (!text) return '';
    var s = String(text);
    if (!arabicNumbers) return s;

    // HH:MM -> الساعة ... (يتجنّب تكرار كلمة "الساعة" إن سبقت الوقت)
    s = s.replace(/(الساعة\s*)?\b([01]?\d|2[0-3]):([0-5]\d)\b/g, function (m, pre, h, mm) {
      var phrase = timeToArabic(h + ':' + mm);
      return pre ? pre + phrase.replace(/^الساعة\s*/, '') : phrase;
    });
    // dates YYYY-MM-DD -> Arabic
    s = s.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, function (m, y, mo, d) {
      return dateToArabic(y + '-' + mo + '-' + d);
    });
    // standalone numbers
    s = s.replace(/\b(\d{1,4})\b/g, function (m) {
      // skip anything already inside an Arabic word
      return numToArabic(parseInt(m, 10));
    });
    return s;
  }

  /* ---------------- speaking ---------------- */
  function speak(text, opts) {
    opts = opts || {};
    if (!synth || !hasUtterance || !text) { if (opts.onend) opts.onend(); return false; }
    if (opts.queue !== false) { queue.push({ text: text, opts: opts }); }
    if (!currentUtterance) runNext();
    return true;
  }

  function runNext() {
    if (!synth || !hasUtterance) { queue = []; currentUtterance = null; return; }
    if (!queue.length) {
      currentUtterance = null;
      if (onEndCb) { var cb = onEndCb; onEndCb = null; try { cb(); } catch (e) { /* ignore */ } }
      return;
    }
    var item = queue.shift();
    var u;
    try { u = new global.SpeechSynthesisUtterance(item.text); }
    catch (e) { currentUtterance = null; if (item.opts && item.opts.onend) item.opts.onend(); runNext(); return; }
    var v = pickVoice('ar');
    if (v) { u.voice = v; u.lang = v.lang; }
    else u.lang = 'ar-SA';
    u.rate = (item.opts && item.opts.rate) || rate;
    u.pitch = (item.opts && item.opts.pitch) || pitch;
    u.volume = 1;
    currentUtterance = u;
    u.onend = function () {
      currentUtterance = null;
      if (item.opts && item.opts.onend) { try { item.opts.onend(); } catch (e) { /* ignore */ } }
      runNext();
    };
    u.onerror = function () {
      currentUtterance = null;
      if (item.opts && item.opts.onend) { try { item.opts.onend(); } catch (e) { /* ignore */ } }
      runNext();
    };
    try { synth.speak(u); } catch (e) { currentUtterance = null; runNext(); }
  }

  function stop() {
    queue = [];
    currentUtterance = null;
    onEndCb = null;
    if (synth) { try { synth.cancel(); } catch (e) { /* ignore */ } }
  }

  function speaking() { return !!(synth && (synth.speaking || synth.pending)); }

  function speakList(items, done) {
    if (!items || !items.length) { if (done) done(); return; }
    onEndCb = done || null;
    stop();
    for (var i = 0; i < items.length; i++) {
      queue.push({ text: items[i], opts: { rate: rate, pitch: pitch } });
    }
    runNext();
  }

  /* ---------------- chime (notification sound) ---------------- */
  function chime() {
    try {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var now = audioCtx.currentTime;
      var notes = [[880, 0], [1174.66, 0.16]];
      for (var i = 0; i < notes.length; i++) {
        var osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = notes[i][0];
        gain.gain.setValueAtTime(0.0001, now + notes[i][1]);
        gain.gain.exponentialRampToValueAtTime(0.22, now + notes[i][1] + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + notes[i][1] + 0.42);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(now + notes[i][1]);
        osc.stop(now + notes[i][1] + 0.45);
      }
    } catch (e) { /* ignore */ }
  }

  global.Voice = {
    available: available, list: list, onVoices: onVoices, pickVoice: pickVoice,
    setVoice: setVoice, setRate: setRate, setPitch: setPitch, setArabicNumbers: setArabicNumbers,
    speak: speak, speakList: speakList, stop: stop, speaking: speaking, chime: chime,
    naturalize: naturalize, numToArabic: numToArabic, timeToArabic: timeToArabic, dateToArabic: dateToArabic,
    get rate() { return rate; }, get pitch() { return pitch; }
  };
})(window);
