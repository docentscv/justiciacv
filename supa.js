/* JusticiaCV · conexión con Supabase (sin librerías externas).
   Habla con la API REST de Supabase (PostgREST) y con su servicio de usuarios (Auth).
   Solo usa la clave PÚBLICA (publishable). Nunca pongas aquí la clave secret. */
(function () {
  'use strict';
  var CFG = window.JCV_CONFIG || {};
  var URL_ = String(CFG.url || '').replace(/\/+$/, '');
  var KEY = String(CFG.key || '');
  var ENABLED = /^https?:\/\//.test(URL_) && KEY.length > 20 && !/TU-PROYECTO|PEGA/i.test(URL_ + KEY);
  var SKEY = 'jcv.sb';
  var session = null, refreshing = null;

  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function now() { return Math.floor(Date.now() / 1000); }

  /* ---------- mensajes de error en español ---------- */
  var ERR = {
    invalid_credentials: 'Correo o contraseña incorrectos.',
    user_already_exists: 'Ya hay una cuenta con ese correo. Prueba a entrar.',
    email_exists: 'Ya hay una cuenta con ese correo. Prueba a entrar.',
    email_not_confirmed: 'Falta confirmar el correo. Abre el mensaje que te hemos enviado y pulsa el enlace.',
    weak_password: 'La contraseña es demasiado débil. Usa al menos 8 caracteres.',
    over_email_send_rate_limit: 'Se han enviado demasiados correos. Espera unos minutos.',
    over_request_rate_limit: 'Demasiados intentos. Espera unos minutos.',
    signup_disabled: 'El registro está cerrado por ahora.',
    validation_failed: 'Revisa el correo y la contraseña.',
    otp_expired: 'El enlace ha caducado. Pide uno nuevo.',
    same_password: 'La nueva contraseña debe ser distinta de la anterior.'
  };
  function fail(code, body) {
    var key = body && (body.error_code || body.code), msg = null;
    if (body && ERR[body.error_code]) msg = ERR[body.error_code];
    else if (body && ERR[body.code]) msg = ERR[body.code];
    else if (body && body.code === 'P0001' && typeof body.message === 'string') msg = body.message; // mensajes propios de las funciones SQL
    else if (code === 401 || code === 403) msg = 'Tu sesión ha caducado o no tienes permiso. Vuelve a entrar.';
    var e = new Error(msg || 'No se ha podido completar la operación. Inténtalo de nuevo.');
    e.status = code; e.code = key; e.raw = body; e.sinAcceso = !!(body && body.message === 'sin_acceso'); return e;
  }

  /* ---------- HTTP ---------- */
  function http(method, path, opt) {
    opt = opt || {};
    var h = { apikey: KEY };
    if (opt.json !== undefined) h['Content-Type'] = 'application/json';
    if (opt.token) h.Authorization = 'Bearer ' + opt.token;
    if (opt.prefer) h.Prefer = opt.prefer;
    return fetch(URL_ + path, { method: method, headers: h, body: opt.json !== undefined ? JSON.stringify(opt.json) : undefined })
      .then(function (r) {
        return r.text().then(function (t) {
          var b = null; if (t) { try { b = JSON.parse(t); } catch (e) { b = { message: t }; } }
          if (!r.ok) throw fail(r.status, b);
          return b;
        });
      }, function () { var e = new Error('No hay conexión con el servidor. Comprueba tu conexión a internet.'); e.offline = true; throw e; });
  }

  /* ---------- sesión ---------- */
  function setSession(s) {
    if (s && s.access_token) {
      session = { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || (now() + (s.expires_in || 3600)), user: s.user || (session && session.user) || null };
    } else session = null;
    lsSet(SKEY, session);
  }
  function loadSession() { session = lsGet(SKEY); if (session && !session.access_token) session = null; }
  function token() {
    if (!session) return Promise.resolve(null);
    if (session.expires_at - now() > 60) return Promise.resolve(session.access_token);
    if (!refreshing) {
      refreshing = http('POST', '/auth/v1/token?grant_type=refresh_token', { json: { refresh_token: session.refresh_token } })
        .then(function (s) { setSession(s); return session && session.access_token; })
        .catch(function (e) { if (e.status >= 400 && e.status < 500) setSession(null); throw e; })
        .then(function (t) { refreshing = null; return t; }, function (e) { refreshing = null; throw e; });
    }
    return refreshing;
  }
  function authed(method, path, opt) {
    return token().then(function (t) { opt = opt || {}; opt.token = t; return http(method, path, opt); });
  }
  function pub(method, path, opt) { // lectura pública: si hay sesión la usamos, si no, solo la clave
    return (session ? token().catch(function () { return null; }) : Promise.resolve(null)).then(function (t) { opt = opt || {}; opt.token = t; return http(method, path, opt); });
  }
  function uid() { return session && session.user && session.user.id; }

  /* Enlaces de correo (confirmar cuenta, recuperar contraseña): llegan en la parte # de la dirección */
  var hashInfo = { recovery: false, error: null, confirmed: false }, hashDone = Promise.resolve();
  function readHash() {
    var h = String(location.hash || '');
    if (h.indexOf('access_token=') < 0 && h.indexOf('error_code=') < 0 && h.indexOf('error_description=') < 0) return Promise.resolve();
    var p = {}; h.replace(/^#/, '').split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) p[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); });
    try { history.replaceState(null, '', location.pathname + location.search + '#cuenta'); } catch (e) { location.hash = '#cuenta'; }
    if (p.error_code || p.error_description) { hashInfo.error = ERR[p.error_code] || 'El enlace no es válido o ha caducado. Pide uno nuevo.'; return Promise.resolve(); }
    if (!p.access_token) return Promise.resolve();
    setSession({ access_token: p.access_token, refresh_token: p.refresh_token, expires_in: +p.expires_in || 3600, expires_at: +p.expires_at || 0 });
    hashInfo.recovery = p.type === 'recovery'; hashInfo.confirmed = p.type === 'signup' || p.type === 'email_change' || p.type === 'invite';
    return http('GET', '/auth/v1/user', { token: session.access_token }).then(function (u) { session.user = { id: u.id, email: u.email }; lsSet(SKEY, session); }, function () { setSession(null); });
  }

  /* ---------- datos públicos → mismo formato que la versión incluida ---------- */
  function page(path) {
    var out = [], off = 0, size = 1000;
    function next() {
      return pub('GET', path + (path.indexOf('?') < 0 ? '?' : '&') + 'limit=' + size + '&offset=' + off).then(function (rows) {
        out = out.concat(rows); if (rows.length < size) return out; off += size; return next();
      });
    }
    return next();
  }
  var CUERPOS = ['TPA', 'GPA', 'AJ', 'MF', 'FE', 'AL', 'OTRO'], TIPOS = { vacante: 0, sustitucion: 1, refuerzo: 2 };
  function build(raw) {
    var pobs = [], xy = [], provs = [], pid = [], pix = {};
    raw.poblaciones.slice().sort(function (a, b) { return a.id - b.id; }).forEach(function (p) {
      pix[p.id] = pobs.length; pobs.push(p.nombre_visible); xy.push([+p.lat, +p.lon]); provs.push(p.provincia); pid.push(p.id);
    });
    var centros = [], ci = {}, obs = [], oi = {};
    function idx(v, lst, d) { if (!(v in d)) { d[v] = lst.length; lst.push(v); } return d[v]; }
    var of = raw.ofertas.map(function (r) {
      var a = r.adjudicada_grupo == null ? -1 : +r.adjudicada_grupo;
      return [r.convocatoria, +r.n_puesto, CUERPOS.indexOf(r.cuerpo), idx(r.centro, centros, ci), pix[r.poblacion_id], TIPOS[r.tipo], idx(r.observaciones || '', obs, oi), a];
    });
    var idToNum = {}; raw.convocatorias.forEach(function (c) { idToNum[c.id] = c.numero; });
    var cortes = raw.cortes.map(function (k) {
      return [idToNum[k.convocatoria_id], k.cuerpo, k.grupo, k.personas, k.piden_ofertas, k.adjudicados, k.ultima_pos_adjudicada, k.ultima_pos_que_pide];
    }).sort(function (a, b) { return a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) || a[2] - b[2]; });
    var adjCortes = {}, hasCortes = {};
    cortes.forEach(function (k) { adjCortes[k[0]] = (adjCortes[k[0]] || 0) + k[5]; hasCortes[k[0]] = 1; });
    var sem = raw.semanas.slice().sort(function (a, b) { return a.convocatoria - b.convocatoria; }).map(function (w) {
      var adj = w.adjudicadas != null ? +w.adjudicadas : (hasCortes[w.convocatoria] ? adjCortes[w.convocatoria] : null);
      return { c: w.convocatoria, f: w.fecha, prov: !!w.provisional, of: +w.ofertas, v: +w.vacantes, s: +w.sustituciones, r: +w.refuerzos, adj: adj,
        adjPdf: w.adjudicadas != null, filas: w.filas_en_listas != null ? +w.filas_en_listas : null, part: w.piden_ofertas != null ? +w.piden_ofertas : null };
    });
    return { generado: sem.length ? sem[sem.length - 1].f : '', pobs: pobs, xy: xy, provs: provs, pid: pid, centros: centros, obs: obs, of: of, sem: sem, cortes: cortes, fuente: 'supabase' };
  }
  function loadData() {
    return Promise.all([
      page('/rest/v1/poblaciones?select=id,nombre_visible,provincia,lat,lon&order=id'),
      page('/rest/v1/v_ofertas?select=convocatoria,n_puesto,cuerpo,centro,poblacion_id,tipo,observaciones,adjudicada_grupo&order=id'),
      page('/rest/v1/v_semanas?select=convocatoria,fecha,ofertas,vacantes,sustituciones,refuerzos,adjudicadas,piden_ofertas,filas_en_listas,provisional&order=convocatoria')
        .catch(function () { return page('/rest/v1/v_semanas?select=convocatoria,fecha,ofertas,vacantes,sustituciones,refuerzos,adjudicadas,piden_ofertas,filas_en_listas&order=convocatoria'); }),   // por si aún no se ha ejecutado 06_provisional.sql
      page('/rest/v1/cortes?select=convocatoria_id,cuerpo,grupo,personas,piden_ofertas,adjudicados,ultima_pos_adjudicada,ultima_pos_que_pide&order=convocatoria_id,cuerpo,grupo'),
      page('/rest/v1/convocatorias?select=id,numero&order=id')
    ]).then(function (r) { return build({ poblaciones: r[0], ofertas: r[1], semanas: r[2], cortes: r[3], convocatorias: r[4] }); });
  }

  /* ---------- cuenta ---------- */
  var ACC = {
    ready: ENABLED,
    whenReady: function () { return hashDone; },
    consumeHash: function () { var h = hashInfo; hashInfo = { recovery: false, error: null, confirmed: false }; return h; },
    peekHash: function () { return hashInfo; },
    loggedIn: function () { return !!session; },
    email: function () { return session && session.user && session.user.email || ''; },
    signIn: function (email, pw) {
      return http('POST', '/auth/v1/token?grant_type=password', { json: { email: email, password: pw } }).then(function (s) { setSession(s); return session; });
    },
    signUp: function (email, pw) {
      return http('POST', '/auth/v1/signup', { json: { email: email, password: pw } }).then(function (s) {
        if (s && s.access_token) { setSession(s); return { confirmed: true }; }
        return { confirmed: false };
      });
    },
    signOut: function () {
      var t = session && session.access_token; setSession(null);
      return t ? http('POST', '/auth/v1/logout', { token: t }).catch(function () {}) : Promise.resolve();
    },
    recover: function (email) { return http('POST', '/auth/v1/recover', { json: { email: email } }); },
    setPassword: function (pw) { return authed('PUT', '/auth/v1/user', { json: { password: pw } }); },
    buscar: function (nombre) { return authed('POST', '/rest/v1/rpc/buscar_mi_fila', { json: { p_nombre: nombre } }); },
    confirmar: function (nombre, cuerpo, orden) { return authed('POST', '/rest/v1/rpc/confirmar_mi_fila', { json: { p_nombre: nombre, p_cuerpo: cuerpo, p_orden: orden } }); },
    posicion: function () { return authed('POST', '/rest/v1/rpc/mi_posicion', { json: {} }); },
    historial: function () { return authed('POST', '/rest/v1/rpc/mi_historial', { json: {} }); },
    borrar: function () { return authed('POST', '/rest/v1/rpc/borrar_mi_cuenta', { json: {} }).then(function () { setSession(null); }); },
    guardarNombre: function (n) { return authed('POST', '/rest/v1/rpc/guardar_mi_nombre', { json: { p_nombre: n } }); },
    miInvitacion: function () { return authed('POST', '/rest/v1/rpc/mi_invitacion', { json: {} }).then(function (r) { return (r && r[0]) || null; }); },
    usarInvitacion: function (c) { return authed('POST', '/rest/v1/rpc/usar_invitacion', { json: { p_codigo: c } }); },
    me: function () {
      return Promise.all([
        authed('GET', '/rest/v1/mis_listas?select=cuerpo,confirmada'),
        authed('GET', '/rest/v1/suscripciones?select=prueba_inicio,prueba_fin,pagado_hasta,curso'),
        authed('GET', '/rest/v1/perfiles?select=poblacion_base_id,radio_km,nombre')['catch'](function () { return authed('GET', '/rest/v1/perfiles?select=poblacion_base_id,radio_km'); }),
        authed('GET', '/rest/v1/zonas_interes?select=poblacion_id')
      ]).then(function (r) { return { listas: r[0], suscripcion: r[1][0] || null, perfil: r[2][0] || null, zonas: r[3].map(function (z) { return z.poblacion_id; }) }; });
    },
    saveProfile: function (p) {
      return authed('POST', '/rest/v1/perfiles?on_conflict=user_id', { json: { user_id: uid(), poblacion_base_id: p.poblacion_base_id, radio_km: p.radio_km }, prefer: 'resolution=merge-duplicates,return=minimal' });
    },
    /* ----- administración (solo funciona si tu cuenta está en la tabla admins; si no, el servidor lo rechaza) ----- */
    init: function () { loadSession(); hashDone = ENABLED ? readHash() : Promise.resolve(); return hashDone; },
    esAdmin: function () { return authed('POST', '/rest/v1/rpc/soy_admin', { json: {} }).then(function (r) { return r === true; }); },
    adminBase: function () {
      return Promise.all([
        page('/rest/v1/poblaciones?select=id,nombre,provincia&order=id'),
        page('/rest/v1/convocatorias?select=id,anio,numero,fecha_publicacion,adjudicados_cargados,listado_cargado,provisional&order=id'),
        page('/rest/v1/centros?select=nombre,poblacion_id&order=id')
      ]).then(function (r) { return { poblaciones: r[0], convocatorias: r[1], centros: r[2] }; });
    },
    adminPreparar: function (p) { return authed('POST', '/rest/v1/rpc/admin_preparar_semana', { json: { p: p } }); },
    adminSubirLista: function (cid, filas) { return authed('POST', '/rest/v1/rpc/admin_subir_lista', { json: { p_convocatoria: cid, p_filas: filas } }); },
    adminCerrar: function (cid, lista, avisos) { return authed('POST', '/rest/v1/rpc/admin_cerrar_semana', { json: { p_convocatoria: cid, p_lista: !!lista, p_avisos: avisos || [] } }); },
    anadirCuerpos: function () { return authed('POST', '/rest/v1/rpc/anadir_mis_cuerpos', { json: {} }); },
    adminReiniciar: function () { return authed('POST', '/rest/v1/rpc/admin_reiniciar_mi_cuenta', { json: {} }); },
    alertas: function () { return authed('GET', '/rest/v1/alertas?select=nuevas_ofertas,cerca_del_corte,resumen_martes').then(function (r) { return r[0] || { nuevas_ofertas: true, cerca_del_corte: true, resumen_martes: false }; }); },
    setAlertas: function (a) {
      return authed('POST', '/rest/v1/alertas?on_conflict=user_id', { json: { user_id: uid(), nuevas_ofertas: !!a.nuevas_ofertas, cerca_del_corte: !!a.cerca_del_corte, resumen_martes: !!a.resumen_martes }, prefer: 'resolution=merge-duplicates,return=minimal' });
    },
    pushRegistrar: function (endpoint, p256dh, auth) { return authed('POST', '/rest/v1/rpc/registrar_push', { json: { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth } }); },
    pushQuitar: function (endpoint) { return authed('POST', '/rest/v1/rpc/quitar_push', { json: { p_endpoint: endpoint } }); },
    adminCargas: function () { return authed('POST', '/rest/v1/rpc/admin_ultimas_cargas', { json: {} }); },
    setZona: function (pid, on) {
      if (on) return authed('POST', '/rest/v1/zonas_interes?on_conflict=user_id,poblacion_id', { json: { user_id: uid(), poblacion_id: pid }, prefer: 'resolution=ignore-duplicates,return=minimal' });
      return authed('DELETE', '/rest/v1/zonas_interes?poblacion_id=eq.' + encodeURIComponent(pid));
    }
  };

  /* ---------- arranque ---------- */
  function loadScript(src) {
    return new Promise(function (ok, ko) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { ko(new Error('No se pudo cargar ' + src)); }; document.head.appendChild(s); });
  }
  function start(opt) {
    var host = document.getElementById('view');
    if (host) host.innerHTML = '<div class="card empty" role="status">Cargando datos…</div>';
    window.JCV_ACC = ENABLED ? ACC : null;
    var snap = window.JCV_SNAPSHOT || null, banner = '';
    var go = function (D, note) { window.JCV_D = D; window.JCV_NOTE = note || ''; return loadScript(opt.app); };
    loadSession();
    var ready = ENABLED ? (hashDone = readHash()) : Promise.resolve();
    return ready.then(function () {
      if (!ENABLED) { if (!snap) throw new Error('Falta la configuración (config.js).'); return go(snap, 'Datos incluidos en la web. Aún no está conectada a la base de datos.'); }
      return loadData().then(function (D) { if (!D.sem.length) throw new Error('La base de datos está vacía.'); return go(D, ''); }, function (e) {
        if (!snap) throw e;
        return go(snap, 'No se ha podido conectar con la base de datos. Mostrando los datos guardados en la web (hasta la convocatoria ' + snap.sem[snap.sem.length - 1].c + ').');
      });
    }).catch(function (e) {
      if (host) host.innerHTML = '<div class="card empty" role="alert"><b>No se ha podido cargar la web.</b><br>' + String(e && e.message || e).replace(/[<>&]/g, '') + '<br><button class="btn" type="button" id="jcv-retry" style="margin-top:12px">Reintentar</button></div>';
      var rb = document.getElementById('jcv-retry'); if (rb) rb.addEventListener('click', function () { location.reload(); });
    });
  }
  /* Si el enlace del correo se abre en la misma pestaña (solo cambia la parte # de la dirección) */
  window.addEventListener('hashchange', function () { if (ENABLED && /access_token=|error_code=|error_description=/.test(location.hash)) hashDone = readHash(); });
  window.JCV = { start: start, build: build, enabled: ENABLED, acc: ACC };
})();
