/* ============================================================
   سكرتاري | Secretary — Charts
   Lightweight dependency-free canvas charts (RTL aware).
   ============================================================ */
(function (global) {
  'use strict';

  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name);
      return (v && v.trim()) || fallback;
    } catch (e) { return fallback; }
  }
  function theme() {
    return {
      text: cssVar('--text-2', '#334155'),
      muted: cssVar('--muted', '#64748b'),
      grid: cssVar('--border', '#e3e8f0'),
      surface: cssVar('--surface', '#fff'),
      brand: cssVar('--brand-500', '#2f5ff0'),
      teal: cssVar('--teal-500', '#0d9488'),
      amber: cssVar('--amber-500', '#f59e0b'),
      rose: cssVar('--rose-500', '#f43f5e'),
      green: cssVar('--green-500', '#10b981'),
      violet: cssVar('--violet-500', '#8b5cf6')
    };
  }
  function hex(c) {
    if (!c) return '#2f5ff0';
    c = c.trim();
    if (c.charAt(0) === '#') {
      if (c.length === 4) return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
      return c;
    }
    return '#2f5ff0';
  }
  function withAlpha(hexColor, a) {
    var c = hex(hexColor);
    var r = parseInt(c.substr(1, 2), 16), g = parseInt(c.substr(3, 2), 16), b = parseInt(c.substr(5, 2), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function setup(canvas) {
    if (!canvas) return null;
    var dpr = global.devicePixelRatio || 1;
    var parent = canvas.parentNode;
    var w = (parent && parent.clientWidth) || canvas.clientWidth || 320;
    if (w < 40) w = 320;
    var h = parseInt(canvas.style.height, 10) || parseInt(canvas.getAttribute('height'), 10) || 220;
    canvas.style.width = '100%';
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function truncate(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    var t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
    return t + '…';
  }

  /* ---------- Horizontal bars (plans remaining days) ---------- */
  function bars(canvas, items, opts) {
    opts = opts || {};
    var s = setup(canvas); if (!s) return;
    var ctx = s.ctx, t = theme();
    if (!items || !items.length) { empty(ctx, s.w, s.h, t, opts.emptyText || 'لا توجد بيانات'); return; }

    var labelH = 22, padTop = 6;
    var rowH = opts.rowH || 46;
    var need = padTop + items.length * rowH + 10;
    if (s.h < need) {
      s.h = need; canvas.style.height = need + 'px';
      canvas.height = Math.round(need * (global.devicePixelRatio || 1));
      ctx.setTransform(global.devicePixelRatio || 1, 0, 0, global.devicePixelRatio || 1, 0, 0);
    }
    var max = 1;
    for (var i = 0; i < items.length; i++) max = Math.max(max, items[i].value);

    items.forEach(function (it, idx) {
      var y = padTop + idx * rowH;
      var pct = Math.max(0.02, it.value / max);
      var color = hex(it.color || t.brand);

      ctx.fillStyle = t.text;
      ctx.font = '700 13px ' + cssVar('--ff', 'Cairo, sans-serif');
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(truncate(ctx, it.label, s.w * 0.62), s.w - 2, y + 13);

      ctx.fillStyle = t.muted;
      ctx.font = '600 11.5px ' + cssVar('--ff', 'Cairo, sans-serif');
      ctx.textAlign = 'left';
      ctx.fillText(it.valueText || String(it.value), 2, y + 13);

      var barY = y + labelH;
      var barH = 10;
      ctx.fillStyle = cssVar('--surface-3', '#f1f5f9');
      roundRect(ctx, 0, barY, s.w, barH, barH / 2);
      ctx.fill();

      var g = ctx.createLinearGradient(s.w - (s.w * pct), 0, s.w, 0);
      g.addColorStop(0, withAlpha(color, 0.65));
      g.addColorStop(1, color);
      ctx.fillStyle = g;
      roundRect(ctx, s.w - (s.w * pct), barY, s.w * pct, barH, barH / 2);
      ctx.fill();
    });
  }

  /* ---------- Vertical columns (weekly load) ---------- */
  function columns(canvas, items, opts) {
    opts = opts || {};
    var s = setup(canvas); if (!s) return;
    var ctx = s.ctx, t = theme();
    if (!items || !items.length) { empty(ctx, s.w, s.h, t, 'لا توجد بيانات'); return; }

    var padB = 26, padT = 14;
    var n = items.length;
    var slot = s.w / n;
    var barW = Math.min(38, slot * 0.56);
    var max = 1;
    for (var i = 0; i < items.length; i++) max = Math.max(max, items[i].value);

    ctx.strokeStyle = t.grid;
    ctx.lineWidth = 1;
    for (var g2 = 1; g2 <= 3; g2++) {
      var gy = padT + (s.h - padT - padB) * (g2 / 4);
      ctx.beginPath(); ctx.moveTo(0, gy + .5); ctx.lineTo(s.w, gy + .5); ctx.stroke();
    }

    items.forEach(function (it, idx) {
      var cx = s.w - (idx * slot) - (slot / 2);   // RTL order: first item on the right
      var h = ((s.h - padT - padB) * it.value) / max;
      var color = hex(it.color || t.brand);
      var y = s.h - padB - h;

      var grad = ctx.createLinearGradient(0, y, 0, s.h - padB);
      grad.addColorStop(0, color);
      grad.addColorStop(1, withAlpha(color, 0.45));
      ctx.fillStyle = grad;
      roundRect(ctx, cx - barW / 2, y, barW, Math.max(h, 3), 7);
      ctx.fill();

      ctx.fillStyle = t.text;
      ctx.font = '700 12px ' + cssVar('--ff', 'Cairo, sans-serif');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(it.label, cx, s.h - padB + 7);

      if (it.value) {
        ctx.fillStyle = t.muted;
        ctx.font = '700 11px ' + cssVar('--ff', 'Cairo, sans-serif');
        ctx.textBaseline = 'bottom';
        ctx.fillText(String(it.value), cx, y - 4);
      }
    });
  }

  /* ---------- Donut ---------- */
  function donut(canvas, segments, opts) {
    opts = opts || {};
    var s = setup(canvas); if (!s) return;
    var ctx = s.ctx, t = theme();
    var total = 0;
    for (var i = 0; i < segments.length; i++) total += segments[i].value;

    var cx = s.w / 2, cy = s.h / 2;
    var R = Math.min(s.w, s.h) / 2 - 8;
    var r = R * 0.62;

    if (!total) {
      ctx.beginPath(); ctx.arc(cx, cy, (R + r) / 2, 0, Math.PI * 2);
      ctx.strokeStyle = cssVar('--surface-3', '#f1f5f9'); ctx.lineWidth = R - r; ctx.stroke();
      ctx.fillStyle = t.muted; ctx.font = '700 13px ' + cssVar('--ff', 'Cairo, sans-serif');
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(opts.emptyText || 'لا توجد بيانات', cx, cy);
      return;
    }

    var start = -Math.PI / 2;
    for (var j = 0; j < segments.length; j++) {
      var seg = segments[j];
      if (!seg.value) continue;
      var ang = (seg.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, (R + r) / 2, start, start + ang);
      ctx.strokeStyle = hex(seg.color || t.brand);
      ctx.lineWidth = R - r;
      ctx.lineCap = 'butt';
      ctx.stroke();
      start += ang;
    }

    ctx.fillStyle = t.text;
    ctx.font = '900 26px ' + cssVar('--ff', 'Cairo, sans-serif');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(opts.centerValue !== undefined ? String(opts.centerValue) : String(total), cx, cy - 8);
    if (opts.centerLabel) {
      ctx.fillStyle = t.muted;
      ctx.font = '600 12px ' + cssVar('--ff', 'Cairo, sans-serif');
      ctx.fillText(opts.centerLabel, cx, cy + 15);
    }
  }

  /* ---------- Area / line (7-day productivity) ---------- */
  function area(canvas, points, opts) {
    opts = opts || {};
    var s = setup(canvas); if (!s) return;
    var ctx = s.ctx, t = theme();
    if (!points || !points.length) { empty(ctx, s.w, s.h, t, 'لا توجد بيانات'); return; }

    var padB = 24, padT = 16, padX = 12;
    var max = 1;
    for (var i = 0; i < points.length; i++) max = Math.max(max, points[i].value);

    var step = (s.w - padX * 2) / Math.max(1, points.length - 1);
    function X(i) { return s.w - padX - (i * step); }   // RTL: index 0 on the right

    ctx.strokeStyle = t.grid; ctx.lineWidth = 1;
    for (var g = 1; g <= 3; g++) {
      var gy = padT + (s.h - padT - padB) * (g / 4);
      ctx.beginPath(); ctx.moveTo(0, gy + .5); ctx.lineTo(s.w, gy + .5); ctx.stroke();
    }

    // area fill
    ctx.beginPath();
    ctx.moveTo(X(0), s.h - padB);
    points.forEach(function (p, i) { ctx.lineTo(X(i), s.h - padB - ((s.h - padT - padB) * p.value) / max); });
    ctx.lineTo(X(points.length - 1), s.h - padB);
    ctx.closePath();
    var grad = ctx.createLinearGradient(0, padT, 0, s.h - padB);
    grad.addColorStop(0, withAlpha(t.brand, 0.28));
    grad.addColorStop(1, withAlpha(t.brand, 0.02));
    ctx.fillStyle = grad; ctx.fill();

    // line
    ctx.beginPath();
    points.forEach(function (p, i) {
      var x = X(i), y = s.h - padB - ((s.h - padT - padB) * p.value) / max;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = t.brand; ctx.lineWidth = 2.4; ctx.lineJoin = 'round'; ctx.stroke();

    // points + labels
    points.forEach(function (p, i) {
      var x = X(i), y = s.h - padB - ((s.h - padT - padB) * p.value) / max;
      ctx.beginPath(); ctx.arc(x, y, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = t.surface; ctx.fill();
      ctx.lineWidth = 2.2; ctx.strokeStyle = t.brand; ctx.stroke();

      ctx.fillStyle = t.muted;
      ctx.font = '600 11px ' + cssVar('--ff', 'Cairo, sans-serif');
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(p.label, x, s.h - padB + 6);
    });
  }

  function empty(ctx, w, h, t, text) {
    ctx.fillStyle = t.muted;
    ctx.font = '700 13px ' + cssVar('--ff', 'Cairo, sans-serif');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text || 'لا توجد بيانات', w / 2, h / 2);
  }

  global.Charts = { bars: bars, columns: columns, donut: donut, area: area, theme: theme };
})(window);
