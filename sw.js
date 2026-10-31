/* JusticiaCV · service worker. Primero la red (así las actualizaciones llegan enseguida) y, si no hay conexión, lo último guardado.
   Solo guarda archivos de la propia web. Nunca guarda la base de datos, el inicio de sesión ni los mapas. */
var V = 'jcv-v1', BASE = ['./', 'index.html', 'app.js', 'supa.js', 'snapshot.js', 'boot.js', 'config.js', 'pwa.js', 'manifest.webmanifest', 'icons/icon-192.png', 'politica-privacidad.html', 'aviso-legal.html'];
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
