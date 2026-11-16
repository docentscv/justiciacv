/* JusticiaCV · bloques "Instala la app" en Inicio (Android: APK directo · iPhone: añadir a pantalla de inicio).
   No toca app.js: se engancha a #view y se vuelve a poner cada vez que la web repinta el Inicio.
   Para actualizar el APK: sube el nuevo JusticiaCV.apk con el mismo nombre. */
(function () {
'use strict';
var APK = 'JusticiaCV.apk';
var ua = navigator.userAgent || '';
var ANDROID = /Android/i.test(ua);
var IOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
var INSTALADA = navigator.standalone === true || /^android-app:\/\//.test(document.referrer || '') ||
  (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
if (INSTALADA) return;                                   /* ya está dentro de la app: no se enseña nada */

var view = document.getElementById('view');
if (!view) return;

var st = document.createElement('style');
st.textContent =
  '#jcv-install{display:grid;gap:14px}' +
  '#jcv-install .inst-grid{display:grid;gap:22px;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))}' +
  '#jcv-install .inst-card{display:grid;gap:10px;align-content:start}' +
  '#jcv-install .inst-top{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}' +
  '#jcv-install ol{margin:2px 0 0;padding:0;list-style:none;display:grid;gap:10px;counter-reset:paso}' +
  '#jcv-install li{counter-increment:paso;display:grid;grid-template-columns:28px 1fr;gap:10px;align-items:start;font-size:15px;line-height:1.4}' +
  '#jcv-install li::before{content:counter(paso);width:28px;height:28px;border-radius:50%;background:var(--tint);color:var(--brand);font-weight:800;font-size:14px;display:grid;place-items:center}' +
  '#jcv-install .ico{display:inline-block;vertical-align:-4px;margin:0 2px}';
document.head.appendChild(st);

var SHARE = '<svg class="ico" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>';
var DOWN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/></svg>';

function tuMovil(si) { return si ? '<span class="pill ok">Tu móvil</span>' : ''; }

function cardAndroid() {
  return '<div class="card inst-card" id="inst-android">' +
    '<div class="inst-top"><p class="eyebrow">Android</p>' + tuMovil(ANDROID) + '</div>' +
    '<h3>Descarga directa de la app</h3>' +
    '<p class="hint">Todavía no está en Google Play, así que la descargas desde esta web. Pesa unos 2 MB.</p>' +
    '<div class="row"><a class="btn primary" id="inst-apk" href="' + APK + '" download="' + APK + '" type="application/vnd.android.package-archive">' + DOWN + 'Descargar JusticiaCV (APK)</a></div>' +
    '<ol>' +
      '<li><span>Pulsa el botón y espera a que termine la descarga. Si el navegador avisa de que el archivo puede ser dañino, es el aviso habitual con cualquier APK: elige conservarlo.</span></li>' +
      '<li><span>Ábrelo desde la notificación de la descarga o desde la carpeta Descargas.</span></li>' +
      '<li><span>Si Android te pide permiso para instalar apps desde esta fuente, concédeselo a tu navegador y pulsa Instalar. Si Play Protect muestra un aviso porque la app aún no está en Google Play, puedes seguir con la instalación.</span></li>' +
    '</ol>' +
    '<p class="hint">Descarga el APK siempre desde esta página. Cuando esté en Google Play, pondremos aquí el enlace.</p></div>';
}
function cardIos() {
  return '<div class="card inst-card" id="inst-ios">' +
    '<div class="inst-top"><p class="eyebrow">iPhone y iPad</p>' + tuMovil(IOS) + '</div>' +
    '<h3>Ponla en tu pantalla de inicio</h3>' +
    '<p class="hint">Apple no deja descargar apps fuera de la App Store, pero puedes añadir la web a tu pantalla de inicio: se abre a pantalla completa, con su icono, como una app.</p>' +
    '<ol>' +
      '<li><span>Abre esta página en <b>Safari</b>. Si estás dentro de WhatsApp, Instagram o Telegram, pulsa «Abrir en Safari» o copia el enlace con el botón de abajo y pégalo en Safari.</span></li>' +
      '<li><span>Pulsa el botón Compartir ' + SHARE + ' (abajo en el centro; en iPad, arriba a la derecha).</span></li>' +
      '<li><span>Desliza el menú hacia abajo, elige <b>«Añadir a pantalla de inicio»</b> y pulsa Añadir.</span></li>' +
    '</ol>' +
    '<p class="hint">Ábrela siempre desde ese icono: así funciona como una app y podrás activar los avisos.</p>' +
    '<div class="row"><button class="btn small" type="button" id="inst-copy">Copiar enlace de la web</button></div>' +
    '<div id="inst-msg" role="status" aria-live="polite"></div></div>';
}

function enlace() {
  var u = location.origin + location.pathname, c = '';
  try { c = JSON.parse(localStorage.getItem('jcv.inv') || '""') || ''; } catch (e) {}
  return /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(c) ? u + '?inv=' + c : u;   /* conserva la invitación si aún no se ha usado */
}
function copiar(txt, ok, ko) {
  var viejo = function () {
    try { var t = document.createElement('input'); t.value = txt; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); t.setSelectionRange(0, 999);
      var r = document.execCommand('copy'); document.body.removeChild(t); r ? ok() : ko(); } catch (e) { ko(); }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, viejo); else viejo();
}

function bloque() {
  var s = document.createElement('section');
  s.id = 'jcv-install'; s.setAttribute('aria-labelledby', 'jcv-inst-h'); s.setAttribute('aria-live', 'off');
  s.innerHTML = '<div><p class="eyebrow">Instala la app</p><h2 id="jcv-inst-h" style="margin-top:4px">JusticiaCV en tu móvil, con su icono</h2>' +
    '<p class="hint" style="margin-top:4px">Más rápida de abrir y a pantalla completa. Elige tu teléfono.</p></div>' +
    '<div class="inst-grid">' + (IOS ? cardIos() + cardAndroid() : cardAndroid() + cardIos()) + '</div>';
  var b = s.querySelector('#inst-copy');
  if (b) b.addEventListener('click', function () {
    var m = s.querySelector('#inst-msg');
    copiar(enlace(), function () { m.innerHTML = '<div class="msg ok">Enlace copiado. Pégalo en Safari.</div>'; },
      function () { m.innerHTML = '<div class="msg err">No se ha podido copiar. Copia la dirección desde la barra del navegador.</div>'; });
  });
  return s;
}

function poner() {
  var h = location.hash || '#inicio';
  if (h !== '#inicio' && h !== '#' && h !== '') return;                      /* solo en Inicio */
  if (!view.querySelector('#pulse')) return;                                 /* el Inicio aún no se ha pintado */
  if (view.querySelector('#jcv-install')) return;
  var g = view.querySelector('section.grid2');                               /* debajo de «Próxima convocatoria» y «Tus zonas» */
  var s = bloque();
  if (g && g.parentNode === view) g.insertAdjacentElement('afterend', s); else view.appendChild(s);
}
new MutationObserver(poner).observe(view, { childList: true });
poner();
})();
