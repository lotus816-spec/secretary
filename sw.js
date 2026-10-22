/* سكرتاري | Secretary — Service Worker
   Offline-first: يخدم ملفات التطبيق من الكاش عند انقطاع الاتصال.
   ملفات المستخدم (localStorage) لا تُمسّ أبداً. */
const VERSION = 'secretary-v4';
const CORE = [
  './',
  './index.html',
  './css/styles.css',
  './js/store.js',
  './js/voice.js',
  './js/charts.js',
  './js/ui.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION)
      .then(function (c) { return c.addAll(CORE); })
      .then(function () { return self.skipWaiting(); })
      .catch(function () { /* some assets may be unavailable */ })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== VERSION; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  if (url.origin === self.location.origin) {
    // الشبكة أولاً: يضمن أحدث نسخة دائماً، مع الكاش كبديل عند انقطاع الاتصال
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) {
            if (req.mode === 'navigate') c.put('./index.html', copy);
            else c.put(req, copy);
          });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          if (hit) return hit;
          if (req.mode === 'navigate') {
            return caches.match('./index.html').then(function (idx) { return idx || caches.match('./'); });
          }
          return new Response('', { status: 504, statusText: 'Offline' });
        });
      })
    );
    return;
  }

  if (FONT_HOSTS.indexOf(url.hostname) !== -1) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res && (res.ok || res.type === 'opaque')) {
            var copy = res.clone();
            caches.open(VERSION).then(function (c) { c.put(req, copy); });
          }
          return res;
        }).catch(function () { return new Response('', { status: 504 }); });
      })
    );
  }
});
