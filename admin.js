/* JusticiaCV · pantalla de administrador.
   Lee en tu navegador los 3 PDF de la semana, te enseña un resumen y, si le dices que sí, lo carga en Supabase.
   Los PDF no se suben a ningún sitio. Los nombres del listado se convierten en una huella (un código) en el servidor y se descartan. */
import { analizarArchivos, compararConBase, construirPayload, trozosDeLista, esperadoTrasCargar, resumenDe, Parar, NOMBRE_TIPO, miles } from './jcvpdf.js';

const ACC = window.JCV && window.JCV.acc;
const host = document.getElementById('adm');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root) => (root || document).querySelector(sel);

const CAPITALES = { Alicante: [38.3452, -0.4810], 'Castellón': [39.9864, -0.0513], Valencia: [39.4699, -0.3763] };
const CUERPO_N = { TPA: 'Tramitación', GPA: 'Gestión', AJ: 'Auxilio Judicial', MF: 'Médicos Forenses', FE: 'Facultativos', AL: 'Ayudantes de laboratorio', OTRO: 'Otros' };
const TIPO_N = { vacante: 'Vacantes', sustitucion: 'Sustituciones', refuerzo: 'Refuerzos' };
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fechaCorta = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${+m[3]} ${MESES[+m[2] - 1]} ${m[1]}` : (iso || ''); };

let pdfjs = null;
let S = null, R = null;          // lo leído y la comparación con la base
let ocupado = false;

/* ---------------------------------------------------------------- pantallas ---------------------------------------------------------------- */
function pinta(html) { host.innerHTML = html; }
function mensaje(tipo, txt) { return `<div class="msg ${tipo}" role="${tipo === 'err' ? 'alert' : 'status'}">${txt}</div>`; }

function pantallaSinConfig() {
  pinta(`<section class="card"><h2>La web aún no está conectada a Supabase</h2>
    <p class="hint" style="margin-top:6px">Abre <span class="mono">config.js</span> y pon la URL de tu proyecto y la clave pública (<span class="mono">sb_publishable_…</span>). Después recarga esta página.</p></section>`);
}

function pantallaEntrar(aviso) {
  pinta(`<section class="card" style="max-width:460px;margin-inline:auto">
    <h2>Administración</h2>
    <p class="hint" style="margin-top:6px">Entra con tu cuenta de JusticiaCV. Si todavía no tienes cuenta, créala aquí mismo.</p>
    ${aviso ? mensaje('err', esc(aviso)) : ''}
    <form id="f-entrar" class="form" style="margin-top:14px;display:grid;gap:12px" novalidate>
      <div class="field"><label for="a-mail">Correo</label><input class="input" id="a-mail" type="email" autocomplete="username" required></div>
      <div class="field"><label for="a-pw">Contraseña</label><input class="input" id="a-pw" type="password" autocomplete="current-password" minlength="8" required></div>
      <div class="row"><button class="btn primary" type="submit" id="b-entrar">Entrar</button><button class="btn" type="button" id="b-crear">Crear cuenta</button></div>
      <div id="a-msg" aria-live="polite"></div>
    </form></section>`);
  const f = $('#f-entrar');
  const leer = () => ({ mail: $('#a-mail').value.trim(), pw: $('#a-pw').value });
  const falla = (e) => { $('#a-msg').innerHTML = mensaje('err', esc(e.message || 'No se ha podido completar la operación.')); f.querySelectorAll('button').forEach((b) => { b.disabled = false; }); };
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const { mail, pw } = leer();
    if (!mail || !pw) { $('#a-msg').innerHTML = mensaje('err', 'Escribe el correo y la contraseña.'); return; }
    f.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    ACC.signIn(mail, pw).then(arranca, falla);
  });
  $('#b-crear').addEventListener('click', () => {
    const { mail, pw } = leer();
    if (!mail || pw.length < 8) { $('#a-msg').innerHTML = mensaje('err', 'Escribe un correo y una contraseña de al menos 8 caracteres.'); return; }
    f.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    ACC.signUp(mail, pw).then((r) => {
      if (r.confirmed) return arranca();
      pantallaEntrar();
      $('#a-msg').innerHTML = mensaje('ok', 'Cuenta creada. Revisa tu correo y pulsa el enlace de confirmación; después vuelve aquí y entra.');
    }, falla);
  });
}

function pantallaNoAdmin() {
  const mail = ACC.email();
  const sql = `insert into public.admins (user_id)\nselect id from auth.users where email = '${mail.replace(/'/g, "''")}'\non conflict do nothing;`;
  pinta(`<section class="card" style="max-width:640px;margin-inline:auto">
    <h2>Tu cuenta todavía no es administradora</h2>
    <p class="hint" style="margin-top:6px">Has entrado como <b>${esc(mail)}</b>. Para darle permiso de administrador, hazlo una sola vez en Supabase:</p>
    <ol class="hint" style="margin:10px 0 0;padding-left:20px;display:grid;gap:6px">
      <li>Abre Supabase, tu proyecto, <b>SQL Editor</b> y una consulta nueva (<b>New query</b>).</li>
      <li>Pega esto y pulsa <b>Run</b>. Debe salir «Success».</li>
    </ol>
    <pre class="sqlbox" id="sql-box">${esc(sql)}</pre>
    <div class="row" style="margin-top:12px"><button class="btn" type="button" id="b-copia">Copiar</button><button class="btn primary" type="button" id="b-otra">Ya lo he hecho, comprobar</button><button class="btn" type="button" id="b-salir">Salir</button></div>
    <div id="a-msg" aria-live="polite" style="margin-top:10px"></div></section>`);
  $('#b-copia').addEventListener('click', () => {
    const ok = () => { $('#a-msg').innerHTML = mensaje('ok', 'Copiado.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(sql).then(ok, () => { $('#a-msg').innerHTML = mensaje('err', 'No se ha podido copiar. Selecciona el texto y cópialo a mano.'); });
    else $('#a-msg').innerHTML = mensaje('err', 'No se ha podido copiar. Selecciona el texto y cópialo a mano.');
  });
  $('#b-otra').addEventListener('click', arranca);
  $('#b-salir').addEventListener('click', () => { ACC.signOut().then(() => pantallaEntrar()); });
}

function pantallaAdmin() {
  pinta(`
  <section class="card" id="c-subir">
    <div class="sec-h"><div><h2>Subir los PDF de la semana</h2>
      <p class="hint" style="margin-top:4px"><b>Viernes</b>: elige solo el PDF <b>2</b> (listado provisional de ofertas). <b>Martes</b>, a partir de las 13:30: elige los 3 a la vez, el <b>5</b> (listado definitivo de ofertas), el <b>7</b> (puestos adjudicados) y el <b>8</b> (listado completo). Los reconoce por su contenido, no por el nombre. (El robot lo hace solo; esta pantalla es el plan B.)</p></div>
      <div class="row"><span class="pill">${esc(ACC.email())}</span><button class="btn small" type="button" id="b-salir">Salir</button></div></div>
    <div class="drop" id="drop" tabindex="0" role="button" aria-label="Elegir los PDF de la semana">
      <input type="file" id="f-pdf" accept=".pdf,application/pdf" multiple hidden>
      <b>Elegir los PDF</b><span class="hint">o arrástralos hasta aquí</span>
    </div>
    <ul class="files" id="lista-ficheros" aria-live="polite"></ul>
    <p class="hint" style="margin-top:10px">Los PDF no se suben a ningún sitio: se leen aquí, en tu navegador. A la base de datos solo llegan los datos leídos, y de cada nombre se guarda únicamente un código (huella); el nombre se descarta.</p>
    <div class="row" style="margin-top:12px"><button class="btn primary" type="button" id="b-leer" disabled>Leer los PDF</button><button class="btn" type="button" id="b-limpia" hidden>Empezar de nuevo</button></div>
    <div id="progreso" aria-live="polite"></div>
  </section>
  <div id="resultado"></div>
  <section class="card" id="c-cargas" style="margin-top:16px"><div class="sec-h"><h2>Últimas cargas</h2><button class="btn small" type="button" id="b-recarga">Actualizar</button></div><div id="cargas"><p class="hint" style="margin-top:8px">Cargando…</p></div></section>`);
  $('#b-salir').addEventListener('click', () => { ACC.signOut().then(() => pantallaEntrar()); });
  const drop = $('#drop'), inp = $('#f-pdf');
  drop.addEventListener('click', () => inp.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('on'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('on'); }));
  drop.addEventListener('drop', (e) => { elegidos(Array.from(e.dataTransfer.files || [])); });
  inp.addEventListener('change', () => { elegidos(Array.from(inp.files || [])); inp.value = ''; });
  $('#b-leer').addEventListener('click', leer);
  $('#b-limpia').addEventListener('click', () => { ficheros = []; S = R = null; $('#resultado').innerHTML = ''; $('#progreso').innerHTML = ''; pintaFicheros(); });
  $('#b-recarga').addEventListener('click', cargarCargas);
  ficheros = [];
  pintaFicheros();
  cargarCargas();
}

/* ---------------------------------------------------------------- elegir y leer ---------------------------------------------------------------- */
let ficheros = [];
function elegidos(lista) {
  if (ocupado) return;
  const pdfs = lista.filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  if (!pdfs.length) { $('#progreso').innerHTML = mensaje('err', 'Eso no son PDF.'); return; }
  const nombres = new Set(ficheros.map((f) => f.name + f.size));
  pdfs.forEach((f) => { if (!nombres.has(f.name + f.size)) ficheros.push(f); });
  S = R = null; $('#resultado').innerHTML = ''; $('#progreso').innerHTML = '';
  pintaFicheros();
}
function pintaFicheros() {
  $('#lista-ficheros').innerHTML = ficheros.map((f) => `<li><span>${esc(f.name)}</span><span class="muted num">${miles(Math.round(f.size / 1024))} KB</span></li>`).join('');
  $('#b-leer').disabled = !ficheros.length || ocupado;
  $('#b-limpia').hidden = !ficheros.length;
}

async function cargarPdfjs() {
  if (pdfjs) return pdfjs;
  const m = await import('./vendor/pdf.min.js');
  m.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.js', import.meta.url).href;
  pdfjs = m;
  return m;
}

function barra(texto, hecho, total) {
  const pc = total ? Math.min(100, Math.round(100 * hecho / total)) : 0;
  $('#progreso').innerHTML = `<div class="bar-t"><span>${esc(texto)}</span><span class="num">${total > 1 ? pc + ' %' : ''}</span></div><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pc}"><i style="width:${pc}%"></i></div>`;
}

async function leer() {
  if (ocupado || !ficheros.length) return;
  ocupado = true; S = R = null;
  $('#resultado').innerHTML = '';
  $('#b-leer').disabled = true;
  try {
    barra('Preparando el lector de PDF…', 0, 1);
    const lib = await cargarPdfjs();
    const archivos = [];
    for (const f of ficheros) archivos.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
    S = await analizarArchivos(lib, archivos, (p) => barra(p.texto, p.hecho, p.total));
    barra('Comparando con la base de datos…', 1, 1);
    const base = await ACC.adminBase();
    R = compararConBase(S, base);
    $('#progreso').innerHTML = '';
    pintaResultado();
  } catch (e) {
    S = R = null;
    $('#progreso').innerHTML = mensaje('err', e instanceof Parar ? esc(e.message) : 'No se han podido leer los PDF: ' + esc(e && e.message || e));
  } finally { ocupado = false; pintaFicheros(); }
}

/* ---------------------------------------------------------------- resumen antes de cargar ---------------------------------------------------------------- */
function tabla(cab, filas) {
  return `<div class="tbl-wrap"><table class="t"><thead><tr>${cab.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${filas.map((f) => `<tr>${f.map((c) => `<td class="num">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function pintaResultado() {
  const r = resumenDe(S);
  const errores = S.errores.concat(R.errores);
  const avisos = S.avisos.concat(R.avisos);
  const faltan = S.faltaNumero || S.faltaFecha;
  const tipos = ['ofertas', 'adjudicados', 'completo'].map((t) => `<li class="${S.archivos[t] ? 'si' : 'no'}"><b>${esc(NOMBRE_TIPO[t])}</b><span>${S.archivos[t] ? esc(S.archivos[t]) : 'no está'}</span></li>`).join('');
  let h = `<section class="card" style="margin-top:16px"><div class="sec-h"><div><p class="eyebrow">Esto es lo que he leído</p>
    <h2 style="margin-top:2px">Convocatoria ${S.numero == null ? '¿?' : S.numero}/${S.anio} · ${S.fecha ? fechaCorta(S.fecha) : '¿fecha?'}</h2></div>
    ${R.ya ? '<span class="pill warn">Ya estaba cargada: se sustituirá</span>' : '<span class="pill ok">Semana nueva</span>'}</div>
    <ul class="files tipos" style="margin-top:10px">${tipos}</ul>`;
  if (faltan) {
    h += `<div class="row" style="margin-top:12px">${S.faltaNumero ? '<div class="field" style="max-width:150px"><label for="x-num">Convocatoria nº</label><input class="input" id="x-num" inputmode="numeric" placeholder="37"></div>' : ''}${S.faltaFecha ? '<div class="field" style="max-width:190px"><label for="x-fecha">Fecha (AAAA-MM-DD)</label><input class="input" id="x-fecha" placeholder="2026-11-03"></div>' : ''}</div>`;
  }
  h += `<div class="kpis" style="margin-top:14px">`;
  h += `<div class="kpi"><b class="num">${r.ofertas}</b><span>ofertas</span></div>`;
  if (r.adjudicados != null) h += `<div class="kpi"><b class="num">${r.adjudicados}</b><span>adjudicadas</span></div>`;
  if (r.lista) h += `<div class="kpi"><b class="num">${miles(r.lista)}</b><span>filas del listado</span></div>`;
  h += `</div>`;
  h += `<div class="grid2" style="margin-top:12px"><div><h3 style="font-size:15px">Ofertas</h3>${tabla(['Cuerpo', 'Ofertas'], Object.entries(r.porCuerpo).map(([k, v]) => [CUERPO_N[k] || k, v]))}${tabla(['Tipo', 'Ofertas'], Object.entries(r.porTipo).map(([k, v]) => [TIPO_N[k] || k, v]))}</div>`;
  h += `<div>`;
  if (r.adjPorGrupo) h += `<h3 style="font-size:15px">Adjudicadas por grupo</h3>${tabla(['Grupo', 'Adjudicadas'], Object.entries(r.adjPorGrupo).sort().map(([k, v]) => ['Grupo ' + k, v]))}`;
  if (r.listaPorCuerpo) h += `<h3 style="font-size:15px;margin-top:12px">Listado completo</h3>${tabla(['Cuerpo', 'Personas', 'Piden', 'Adjudicadas'], Object.entries(r.listaPorCuerpo).map(([k, v]) => [CUERPO_N[k] || k, miles(v.personas), v.piden, v.adjudicadas]))}`;
  h += `</div></div>`;
  if (R.nuevasPoblaciones.length) {
    h += `<div class="aviso-b" style="margin-top:14px"><h3 style="font-size:15px">Poblaciones nuevas (${R.nuevasPoblaciones.length})</h3>
      <p class="hint">No estaban en la base de datos. Elige su provincia. Las coordenadas son opcionales: si las dejas vacías se usa la capital de la provincia y la distancia a esa población será aproximada (se puede corregir más tarde).</p>
      <div class="pobs">${R.nuevasPoblaciones.map((p, i) => `<div class="pob"><b>${esc(p.nombre)}</b>
        <select class="input" data-pob="${i}" data-k="prov" aria-label="Provincia de ${esc(p.nombre)}"><option value="">Provincia…</option>${['Alicante', 'Castellón', 'Valencia'].map((x) => `<option${p.provincia === x ? ' selected' : ''}>${x}</option>`).join('')}</select>
        <input class="input" data-pob="${i}" data-k="lat" inputmode="decimal" placeholder="Latitud (opcional)" aria-label="Latitud de ${esc(p.nombre)}">
        <input class="input" data-pob="${i}" data-k="lon" inputmode="decimal" placeholder="Longitud (opcional)" aria-label="Longitud de ${esc(p.nombre)}"></div>`).join('')}</div></div>`;
  }
  if (R.centrosNuevos.length) h += `<details style="margin-top:12px"><summary class="hint" style="cursor:pointer">Centros nuevos: ${R.centrosNuevos.length}</summary><ul class="hint" style="margin:6px 0 0;padding-left:20px">${R.centrosNuevos.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></details>`;
  if (avisos.length) h += `<div style="margin-top:14px">${mensaje('warn', '<b>Avisos</b> (léelos, pero no impiden cargar)<ul>' + avisos.map((a) => `<li>${esc(a)}</li>`).join('') + '</ul>')}</div>`;
  if (errores.length) h += `<div style="margin-top:14px">${mensaje('err', '<b>Hay que arreglar esto antes de cargar</b><ul>' + errores.map((a) => `<li>${esc(a)}</li>`).join('') + '</ul><p style="margin:8px 0 0">No se ha tocado nada en la base de datos. Si el formato del PDF ha cambiado, avísame; mientras tanto el importador de siempre sigue funcionando.</p>')}</div>`;
  h += `<div class="row" style="margin-top:16px"><button class="btn primary" type="button" id="b-cargar"${errores.length ? ' disabled' : ''}>Cargar en la base de datos</button><span class="hint">${errores.length ? 'No se puede cargar con errores.' : 'Repetir una carga es seguro: sustituye los datos de esa semana, no los duplica.'}</span></div>
    <div id="carga-estado" aria-live="polite"></div></section>`;
  $('#resultado').innerHTML = h;
  const b = $('#b-cargar');
  if (b) b.addEventListener('click', cargar);
  $('#resultado').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------------------------------------------------------------- cargar ---------------------------------------------------------------- */
function poblacionesDelFormulario() {
  const out = [];
  for (let i = 0; i < R.nuevasPoblaciones.length; i++) {
    const p = R.nuevasPoblaciones[i];
    const prov = $(`[data-pob="${i}"][data-k="prov"]`).value;
    if (!prov) throw new Parar(`Elige la provincia de «${p.nombre}».`);
    const num = (k) => { const v = $(`[data-pob="${i}"][data-k="${k}"]`).value.trim().replace(',', '.'); return v === '' ? null : Number(v); };
    let lat = num('lat'), lon = num('lon');
    if ((lat === null) !== (lon === null)) throw new Parar(`En «${p.nombre}» pon las dos coordenadas o ninguna.`);
    if (lat === null) { lat = CAPITALES[prov][0]; lon = CAPITALES[prov][1]; }
    if (!(lat >= 37.5 && lat <= 41 && lon >= -2.3 && lon <= 1)) throw new Parar(`Las coordenadas de «${p.nombre}» no parecen de la Comunitat Valenciana (latitud entre 37,5 y 41; longitud entre −2,3 y 1).`);
    out.push({ nombre: p.nombre, nombre_visible: p.nombre, provincia: prov, lat, lon });
  }
  return out;
}

function pasos(estado) {   // estado: [[texto, 'hecho'|'ahora'|'espera'|'error', detalle?]]
  return `<ol class="pasos">${estado.map(([t, e, d]) => `<li class="${e}"><span class="mk" aria-hidden="true">${e === 'hecho' ? '✓' : e === 'error' ? '✕' : e === 'ahora' ? '…' : '·'}</span><span>${esc(t)}${d ? ` <span class="muted num">${esc(d)}</span>` : ''}</span></li>`).join('')}</ol>`;
}

const esperaMs = (ms) => new Promise((r) => setTimeout(r, ms));
async function conReintentos(f, intentos = 3) {
  let ult;
  for (let i = 0; i < intentos; i++) {
    try { return await f(); } catch (e) {
      ult = e;
      if (!(e && e.offline) && !(e && e.status >= 500)) throw e;       // solo se repite si fue un corte de red o un fallo del servidor
      await esperaMs(1500 * (i + 1));
    }
  }
  throw ult;
}

const avisarSalida = (e) => { e.preventDefault(); e.returnValue = ''; };

async function cargar() {
  if (ocupado) return;
  const est = $('#carga-estado');
  let pobs;
  try {
    if (S.faltaNumero) { const v = parseInt($('#x-num').value, 10); if (!(v > 0)) throw new Parar('Escribe el número de convocatoria.'); S.numero = v; }
    if (S.faltaFecha) { const v = $('#x-fecha').value.trim(); if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) throw new Parar('Escribe la fecha así: 2026-11-03.'); S.fecha = v; }
    pobs = poblacionesDelFormulario();
  } catch (e) { est.innerHTML = mensaje('err', esc(e.message)); return; }
  ocupado = true;
  $('#b-cargar').disabled = true; $('#b-leer').disabled = true;
  window.addEventListener('beforeunload', avisarSalida);
  const hayLista = !!(S.lista && S.lista.length);
  const trozos = hayLista ? trozosDeLista(S.lista, 500) : [];
  const total = S.lista ? S.lista.length : 0;
  const st = [['Ofertas y adjudicados', 'espera'], ['Listado completo', hayLista ? 'espera' : 'hecho', hayLista ? '' : 'no hay'], ['Cierre y comprobación', 'espera']];
  const draw = () => { est.innerHTML = pasos(st); };
  let cid = null;
  try {
    st[0][1] = 'ahora'; draw();
    cid = await conReintentos(() => ACC.adminPreparar(construirPayload(S, pobs)));
    if (typeof cid !== 'number') throw new Error('Respuesta inesperada del servidor.');
    st[0][1] = 'hecho'; draw();
    if (hayLista) {
      st[1][1] = 'ahora';
      let hechas = 0;
      for (const t of trozos) {
        st[1][2] = `${miles(hechas)} / ${miles(total)}`; draw();
        await conReintentos(() => ACC.adminSubirLista(cid, t));
        hechas += t.length;
      }
      st[1][1] = 'hecho'; st[1][2] = `${miles(total)} filas`; draw();
    }
    st[2][1] = 'ahora'; draw();
    const avisos = S.avisos.concat(R.avisos);
    const res = await conReintentos(() => ACC.adminCerrar(cid, hayLista, avisos));
    st[2][1] = 'hecho'; draw();
    const esp = esperadoTrasCargar(S);
    const claves = [['ofertas', 'Ofertas'], ['adjudicaciones', 'Adjudicaciones'], ['lista_filas', 'Filas del listado'], ['huellas', 'Huellas (nombres convertidos)'], ['cortes', 'Cortes por cuerpo y grupo']];
    const filas = claves.filter(([k]) => k in esp).map(([k, n]) => [n, miles(res[k]), miles(esp[k]), Number(res[k]) === Number(esp[k]) ? 'OK' : 'NO COINCIDE']);
    const todoOk = filas.every((f) => f[3] === 'OK');
    est.innerHTML = pasos(st) + `<h3 style="font-size:15px;margin-top:14px">Comprobación en la base de datos</h3>` + tabla(['', 'Guardado', 'Esperado', ''], filas) +
      (todoOk ? mensaje('ok', `<b>Hecho.</b> La convocatoria ${S.numero}/${S.anio} ya está en la web. <a href="./">Ver la web</a> (si la tenías abierta, recárgala).`)
        : mensaje('err', '<b>Algo no coincide.</b> Pulsa «Cargar» otra vez: repetirlo es seguro. Si sigue igual, pásame una captura de esta tabla.'));
    cargarCargas();
  } catch (e) {
    const i = st.findIndex((x) => x[1] === 'ahora'); if (i >= 0) st[i][1] = 'error';
    est.innerHTML = pasos(st) + mensaje('err', `<b>La carga se ha interrumpido.</b> ${esc(e && e.message || e)}<br>No pasa nada: la semana puede quedar a medias, pero repetir la carga es seguro y la deja bien. Pulsa «Cargar» otra vez.`);
    $('#b-cargar').disabled = false;
  } finally {
    ocupado = false; $('#b-leer').disabled = !ficheros.length;
    window.removeEventListener('beforeunload', avisarSalida);
  }
}

/* ---------------------------------------------------------------- últimas cargas ---------------------------------------------------------------- */
async function cargarCargas() {
  const dest = $('#cargas');
  if (!dest) return;
  try {
    const rows = await ACC.adminCargas();
    if (!rows.length) { dest.innerHTML = '<p class="hint" style="margin-top:8px">Todavía no se ha cargado ninguna semana desde esta pantalla.</p>'; return; }
    dest.innerHTML = tabla(['Cuándo', 'Convocatoria', 'Ofertas', 'Adjudicadas', 'Filas del listado', 'Avisos'],
      rows.map((r) => [new Date(r.hecha).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }), `${r.numero}/${r.anio} · ${fechaCorta(r.fecha_publicacion)}`, r.ofertas, r.adjudicaciones, miles(r.lista_filas), (r.avisos || []).length]));
  } catch (e) { dest.innerHTML = mensaje('err', esc(e.message)); }
}

/* ---------------------------------------------------------------- arranque ---------------------------------------------------------------- */
async function arranca() {
  if (!ACC) { pantallaSinConfig(); return; }
  pinta('<div class="card empty" role="status">Cargando…</div>');
  try {
    await ACC.init();
    if (!ACC.loggedIn()) { pantallaEntrar(); return; }
    const admin = await ACC.esAdmin();
    if (admin) pantallaAdmin(); else pantallaNoAdmin();
  } catch (e) {
    if (e && (e.status === 401 || e.status === 403)) { pantallaEntrar('Tu sesión ha caducado. Vuelve a entrar.'); return; }
    pinta(`<section class="card">${mensaje('err', esc(e && e.message || e))}<div class="row" style="margin-top:12px"><button class="btn" type="button" id="b-reint">Reintentar</button></div></section>`);
    $('#b-reint').addEventListener('click', arranca);
  }
}
arranca();
