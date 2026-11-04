/* JusticiaCV · service worker. Primero la red (así las actualizaciones llegan enseguida) y, si no hay conexión, lo último guardado.
   Solo guarda archivos de la propia web. Nunca guarda la base de datos, el inicio de sesión ni los mapas. */
var V = 'jcv-v2', BASE = ['./', 'index.html', 'app.js', 'supa.js', 'snapshot.js', 'boot.js', 'config.js', 'pwa.js', 'manifest.webmanifest', 'icons/icon-192.png', 'politica-privacidad.html', 'aviso-legal.html'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(V).then(function (c) { return c.addAll(BASE); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (k) { return Promise.all(k.filter(function (x) { return x !== V; }).map(function (x) { return caches.delete(x); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(r).then(function (res) {
    if (res && res.ok) { var cp = res.clone(); caches.open(V).then(function (c) { c.put(r, cp); }); }
    return res;
  }).catch(function () { return caches.match(r).then(function (m) { return m || caches.match('index.html'); }); }));
});

/* Avisos (Web Push). El texto lo prepara el robot; aquí solo se muestra y, al pulsarlo, se abre la web. */
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'JusticiaCV', {
    body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    tag: 'jcv-' + (d.title || 'aviso'), data: { url: d.url || self.registration.scope }
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  try { if (new URL(url, self.registration.scope).origin !== self.location.origin) url = self.registration.scope; } catch (_) { url = self.registration.scope; }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url.indexOf(self.registration.scope) === 0 && 'focus' in list[i]) {
        return list[i].focus().then(function (c) { return c && 'navigate' in c ? c.navigate(url) : null; });
      }
    }
    return self.clients.openWindow(url);
  }));
});
