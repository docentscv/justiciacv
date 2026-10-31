/* JusticiaCV · registro del service worker (permite instalar la web como app y verla sin conexión) */
if ('serviceWorker' in navigator) { window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); }); }
