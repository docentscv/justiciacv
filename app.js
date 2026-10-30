(function () {
'use strict';
var D = window.JCV_D;
var ACC = window.JCV_ACC || null, NOTE = window.JCV_NOTE || '';

/* ---------- utilidades ---------- */
var $ = function (s, el) { return (el || document).querySelector(s); };
var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
var MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
var MESL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function fmtD(iso) { var p = iso.split('-').map(Number); return p[2] + ' ' + MES[p[1] - 1] + ' ' + p[0]; }
function fmtDL(dt) { return DIAS[dt.getDay()] + ' ' + dt.getDate() + ' de ' + MESL[dt.getMonth()]; }
function addDays(iso, n) { var d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d; }
function norm(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function sentence(s) { s = s.toLowerCase().replace(/\b(vsm|rpt|ccoo|tsj|sct|laj|stto|ti)\b/g, function (m) { return m.toUpperCase(); }); return s.charAt(0).toUpperCase() + s.slice(1); }
function pct(a, b) { return b ? Math.round(100 * a / b) : 0; }
var store = {
  get: function (k, d) { try { var v = localStorage.getItem('jcv.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set: function (k, v) { try { localStorage.setItem('jcv.' + k, JSON.stringify(v)); } catch (e) {} }
};
function debounce(f, ms) { var t; return function () { clearTimeout(t); t = setTimeout(f, ms); }; }

/* ---------- datos ---------- */
var CUN = ['Tramitación', 'Gestión', 'Auxilio Judicial', 'Médicos Forenses', 'Facultativos', 'Ayudantes de laboratorio', 'Otros'];
var CUC = ['TPA', 'GPA', 'AJ', 'MF', 'FE', 'AL', 'OTRO'];
var CUCHIPS = [[0, 'Tramitación'], [1, 'Gestión'], [2, 'Auxilio'], [3, 'Forenses']];
var TIP = [{ n: 'Vacante', cls: 'vac', v: '--c-vac' }, { n: 'Sustitución', cls: 'sus', v: '--c-sus' }, { n: 'Refuerzo', cls: 'ref', v: '--c-ref' }];
var offers = D.of.map(function (r) {
  var o = { c: r[0], id: r[1], cu: r[2], centro: D.centros[r[3]], pob: D.pobs[r[4]], pi: r[4], prov: D.provs[r[4]], tipo: r[5], obs: D.obs[r[6]], a: r[7] };
  o.s = norm(o.pob + ' ' + o.centro + ' ' + o.obs + ' ' + o.id + ' ' + o.prov);
  o.pob = o.pob.replace('Castelló de la Plana/Castellón de la Plana', 'Castelló de la Plana');
  return o;
});
var weeks = D.sem, last = weeks[weeks.length - 1];
var wk = {}; weeks.forEach(function (w) { wk[w.c] = w; });
var PROVS = ['Alicante', 'Castellón', 'Valencia'];
var STATS = {
  tipos: [{ i: 1, n: 279, v: 68 }, { i: 0, n: 186, v: 15 }, { i: 2, n: 52, v: 0 }],
  grupos: [{ g: 1, n: 127, v: 16 }, { g: 2, n: 109, v: 13 }, { g: 3, n: 178, v: 32 }, { g: 4, n: 118, v: 27 }],
  casos: 536, salen: 532, vuelven: 88, g34: 59, g34aG2: 51,
  pidenAlguna: 861, personas: 5395, regulares: 165
};
var favs = new Set(store.get('favs', []));
function saveFavs() { store.set('favs', Array.from(favs)); }
var F = { conv: 'last', cu: 'all', prov: 'all', tipo: 'all', q: '', mine: false, pob: null, shown: 24 };
var Z = { win: 8, cu: 'all', all: false };
var P = store.get('pos', { cu: 2, g: 3, pos: 300, per: 'todas' });

/* ---------- tooltip y gráficos ---------- */
var tip = $('#tip'), redraws = [];
function showTip(html, x, y) {
  tip.innerHTML = html; tip.style.opacity = 1;
  var r = tip.getBoundingClientRect(), L = x + 14, T = y + 14;
  if (L + r.width > innerWidth - 8) L = x - r.width - 14;
  if (T + r.height > innerHeight - 8) T = y - r.height - 14;
  tip.style.left = Math.max(8, L) + 'px'; tip.style.top = Math.max(8, T) + 'px';
}
function hideTip() { tip.style.opacity = 0; }
window.addEventListener('scroll', hideTip, { passive: true });
function nice(max) {
  var steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000], t = 1000;
  for (var i = 0; i < steps.length; i++) { if (max / steps[i] <= 4) { t = steps[i]; break; } }
  return { t: t, m: Math.ceil(max / t) * t };
}
function stackChart(host, o) {
  function draw() {
    var W = Math.max(260, host.clientWidth), H = o.h || 210, m = { l: 36, r: 4, t: 8, b: 24 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b, n = o.data.length, st = iw / n, bw = Math.max(3, Math.min(26, st * 0.72));
    var tot = function (d) { return o.series.reduce(function (s, x) { return s + (x.v(d) || 0); }, 0); };
    var nm = nice(Math.max(1, Math.max.apply(null, o.data.map(tot))));
    var y = function (v) { return m.t + ih - (v / nm.m) * ih; };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.label) + '">';
    for (var v = 0; v <= nm.m; v += nm.t) {
      s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)"/><text x="' + (m.l - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v + '</text>';
    }
    o.data.forEach(function (d, i) {
      var x = m.l + st * i + (st - bw) / 2, acc = 0;
      o.series.forEach(function (se) {
        var val = se.v(d) || 0; if (val <= 0) return;
        var y0 = y(acc + val), h = y(acc) - y0; acc += val;
        s += '<rect x="' + x.toFixed(1) + '" y="' + y0.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, h - 1.5).toFixed(1) + '" rx="2" style="fill:var(' + se.c + ')"/>';
      });
      var lb = o.xl(i, d);
      if (lb) s += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + lb + '</text>';
      s += '<rect class="hit" data-i="' + i + '" x="' + (m.l + st * i).toFixed(1) + '" y="' + m.t + '" width="' + st.toFixed(1) + '" height="' + ih + '" fill="transparent"/>';
    });
    host.innerHTML = s + '</svg>';
    $$('.hit', host).forEach(function (r) {
      var i = +r.dataset.i, go = function (e) { showTip(o.tip(o.data[i]), e.clientX, e.clientY); };
      r.addEventListener('pointermove', go); r.addEventListener('pointerdown', go); r.addEventListener('pointerleave', hideTip);
    });
  }
  draw(); redraws.push(draw);
}
function legend(items) {
  return '<div class="legend">' + items.map(function (i) { return '<span><i class="sw" style="background:var(' + i.c + ')"></i>' + esc(i.n) + '</span>'; }).join('') + '</div>';
}
function tableToggle(id, head, rows) {
  var t = '<div class="tbl-wrap"><table class="t"><thead><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
    rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td class="num">' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  return '<button class="btn small" type="button" data-tbl="' + id + '" aria-expanded="false" style="margin-top:10px">Ver como tabla</button><div id="' + id + '" hidden>' + t + '</div>';
}
function bindTables(root) {
  $$('button[data-tbl]', root).forEach(function (b) {
    b.addEventListener('click', function () {
      var el = document.getElementById(b.dataset.tbl), open = el.hidden;
      el.hidden = !open; b.setAttribute('aria-expanded', open); b.textContent = open ? 'Ocultar tabla' : 'Ver como tabla';
    });
  });
}
function tipRows(rows) { return rows.map(function (r) { return '<div class="tr"><span>' + r[0] + '</span><b class="num">' + r[1] + '</b></div>'; }).join(''); }

/* ---------- piezas comunes ---------- */
function pillTipo(i) { var t = TIP[i]; return '<span class="pill"><i class="dot d-' + t.cls + '"></i>' + t.n + '</span>'; }
function starBtn(pob) {
  var on = favs.has(pob);
  return '<button class="star" type="button" data-fav="' + esc(pob) + '" aria-pressed="' + on + '" aria-label="' + (on ? 'Quitar ' : 'Marcar ') + esc(pob) + ' como mi zona" title="Mi zona"><svg width="20" height="20" viewBox="0 0 24 24" fill="' + (on ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg></button>';
}
function bindFavs(root, rerender) {
  $$('button[data-fav]', root).forEach(function (b) {
    b.addEventListener('click', function () {
      var p = b.dataset.fav; if (favs.has(p)) favs['delete'](p); else favs.add(p); saveFavs(); pushFav(p, favs.has(p)); rerender();
    });
  });
}
function offerCard(o, extra) {
  var det = o.obs ? sentence(o.obs) : '';
  if (o.tipo === 2) { var m = o.obs.match(/(\d{2})-(\d{2})-(\d{4})/); if (m) det = 'Hasta el ' + m[1] + '/' + m[2] + '/' + m[3] + ', con posibles prórrogas'; }
  var res = o.a > 0 ? '<span class="pill ok">Adjudicada · grupo ' + o.a + '</span>' : o.a === 0 ? '<span class="pill warn">Sin cubrir</span>' : '<span class="pill">Sin dato de adjudicación</span>';
  return '<article class="offer"><div class="row" style="justify-content:space-between;flex-wrap:nowrap"><div class="row">' + pillTipo(o.tipo) + '<span class="pill">' + CUN[o.cu] + '</span></div>' + starBtn(o.pob) + '</div>' +
    '<h3>' + esc(o.centro) + '</h3><div class="where"><span>' + esc(o.pob) + '</span>' + (o.prov !== 'Sin provincia' ? '<span>· ' + o.prov + '</span>' : '') + (extra ? '<span>· ' + extra + '</span>' : '') + '</div>' +
    (det ? '<p class="hint">' + esc(det) + '</p>' : '') +
    '<div class="foot"><span>' + res + '</span><span class="num">Conv. ' + o.c + '/2026 · <span class="mono">' + o.id + '</span></span></div></article>';
}

/* ---------- vistas ---------- */
function pulseChart(host) {
  function draw() {
    var W = Math.max(240, host.clientWidth), H = 74, n = weeks.length, st = W / n, bw = Math.max(2, st * 0.62);
    var mx = Math.max.apply(null, weeks.map(function (w) { return w.of; }));
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Ofertas por semana, convocatorias 1 a ' + last.c + '">';
    weeks.forEach(function (w, i) {
      var h = Math.max(3, (w.of / mx) * (H - 14)), x = st * i + (st - bw) / 2, cur = i === n - 1;
      s += '<rect x="' + x.toFixed(1) + '" y="' + (H - 12 - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" style="fill:' + (cur ? 'var(--c-sus)' : 'var(--brand)') + ';opacity:' + (cur ? 1 : 0.28 + 0.5 * (i / n)) + '"/>';
    });
    s += '<text x="0" y="' + (H - 1) + '">sem. 1</text><text x="' + W + '" y="' + (H - 1) + '" text-anchor="end">sem. ' + last.c + '</text></svg>';
    host.innerHTML = s;
  }
  draw(); redraws.push(draw);
}
function nextConv() {
  var d = new Date(last.f + 'T12:00:00'), add = (5 - d.getDay() + 7) % 7 || 7; // próximo viernes
  var pub = addDays(last.f, add), lun = new Date(pub); lun.setDate(lun.getDate() + 3); var mar = new Date(pub); mar.setDate(mar.getDate() + 4);
  var now = new Date(), dias = Math.round((new Date(mar.getFullYear(), mar.getMonth(), mar.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000); // días naturales hasta el martes de la convocatoria
  return { n: last.c + 1, pub: pub, lun: lun, mar: mar, dias: dias };
}
function viewInicio() {
  var w = last, cub = w.adj, sin = w.of - cub;
  var nx = nextConv();
  var cd = nx.dias > 1 ? 'Faltan ' + nx.dias + ' días' : nx.dias === 1 ? 'Es mañana' : nx.dias === 0 ? 'Es hoy' : 'Debería estar publicada';
  var segs = [[w.v, 'vac'], [w.s, 'sus'], [w.r, 'ref']].filter(function (x) { return x[0] > 0; }).map(function (x) { return '<i class="s-' + x[1] + '" style="flex:' + x[0] + '"></i>'; }).join('');
  var mine = Array.from(favs);
  var mineOffers = offers.filter(function (o) { return o.c === last.c && favs.has(o.pob); });
  var mineHtml = mine.length ? (mineOffers.length ? '<div class="offers" style="margin-top:12px">' + mineOffers.map(function (o) { return offerCard(o); }).join('') + '</div>' : '<p class="hint" style="margin-top:8px">Esta semana no hay ofertas en ' + mine.map(esc).join(', ') + '.</p>') : '<p class="hint" style="margin-top:8px">Marca con la estrella una población en <a href="#ofertas">Ofertas</a> o <a href="#zonas">Zonas</a> y verás aquí sus ofertas de la semana.</p>';
  return '<section class="hero"><div class="hero-t"><p class="eyebrow">Justicia · Comunitat Valenciana</p>' +
    '<h1>Qué hay esta semana y hasta dónde llega la lista</h1>' +
    '<p class="lead">Ofertas y adjudicaciones reales de los listados oficiales, ordenadas para consultarlas en un minuto. Sin nombres ni DNI.</p>' +
    '<div class="row"><a class="btn primary" href="#ofertas">Ver las ofertas de la semana</a><a class="btn" href="#mi-posicion">Calcular mi posición</a></div>' +
    '<div><div class="chart" id="pulse" style="max-width:520px"></div><p class="hint">Ofertas de cada una de las ' + weeks.length + ' semanas con datos</p></div></div>' +
    '<div class="card"><div class="week-h"><h2>Convocatoria ' + w.c + '/2026</h2><span class="muted num">' + fmtD(w.f) + '</span></div>' +
    '<p class="hint">La última publicada con adjudicación</p>' +
    '<div class="kpis"><div class="kpi"><b class="num">' + w.of + '</b><span>ofertas</span></div><div class="kpi"><b class="num">' + cub + '</b><span>adjudicadas</span></div><div class="kpi"><b class="num">' + sin + '</b><span>sin cubrir</span></div></div>' +
    '<div class="seg" aria-hidden="true">' + segs + '</div>' +
    '<div class="legend" style="margin-top:10px"><span><i class="dot d-vac"></i>Vacantes ' + w.v + '</span><span><i class="dot d-sus"></i>Sustituciones ' + w.s + '</span><span><i class="dot d-ref"></i>Refuerzos ' + w.r + '</span></div>' +
    '<div style="margin-top:14px"><a class="btn small" href="#ofertas">Ver las ' + w.of + ' ofertas</a></div></div></section>' +
    '<section class="grid2"><div class="card"><p class="eyebrow">Próxima convocatoria (estimación)</p><div class="next-d" style="margin-top:6px">' + nx.n + '/2026 · ' + fmtDL(nx.mar) + '</div><p class="hint">' + cd + '. No hay calendario oficial por adelantado: la fecha sale del ritmo de las últimas semanas.</p>' +
    '<div class="cycle"><div><b>' + fmtDL(nx.pub).split(' ')[0] + ' por la tarde</b>Listado provisional de ofertas</div><div><b>' + fmtDL(nx.lun).split(' ')[0] + ' 10:00 a ' + fmtDL(nx.mar).split(' ')[0] + ' 9:59</b>Peticiones en Némesis con certificado digital</div><div><b>' + fmtDL(nx.mar).split(' ')[0] + '</b>Adjudicación por orden de lista</div></div></div>' +
    '<div class="card"><div class="sec-h"><h2>Tus zonas</h2><a class="btn small" href="#zonas">Elegir zonas</a></div>' + mineHtml + '</div></section>';
}
function afterInicio() { pulseChart($('#pulse')); bindFavs($('#view'), function () { render(); }); }

function filtered() {
  var q = norm(F.q).split(/\s+/).filter(Boolean);
  return offers.filter(function (o) {
    if (F.conv === 'last' ? o.c !== last.c : F.conv !== 'all' && o.c !== +F.conv) return false;
    if (F.cu !== 'all' && o.cu !== +F.cu) return false;
    if (F.prov !== 'all' && o.prov !== F.prov) return false;
    if (F.tipo !== 'all' && o.tipo !== +F.tipo) return false;
    if (F.pob && o.pob !== F.pob) return false;
    if (F.mine && !favs.has(o.pob)) return false;
    for (var i = 0; i < q.length; i++) if (o.s.indexOf(q[i]) < 0) return false;
    return true;
  }).sort(function (a, b) { return b.c - a.c || a.pob.localeCompare(b.pob); });
}
function chipRow(name, items, cur) {
  return '<div class="row" role="group" aria-label="' + name + '">' + items.map(function (it) {
    return '<button class="chip" type="button" data-k="' + name + '" data-v="' + it[0] + '" aria-pressed="' + (String(cur) === String(it[0])) + '">' + (it[2] || '') + esc(it[1]) + '</button>';
  }).join('') + '</div>';
}
function viewOfertas() {
  var convOpts = '<option value="last"' + (F.conv === 'last' ? ' selected' : '') + '>Última · ' + last.c + '/2026 (' + fmtD(last.f) + ')</option><option value="all"' + (F.conv === 'all' ? ' selected' : '') + '>Todas las semanas</option>' +
    weeks.slice().reverse().map(function (w) { return '<option value="' + w.c + '"' + (String(F.conv) === String(w.c) ? ' selected' : '') + '>' + w.c + '/2026 · ' + fmtD(w.f) + '</option>'; }).join('');
  var list = filtered(), shown = list.slice(0, F.shown);
  return '<section class="card filters"><div class="sec-h"><h2>Ofertas</h2><span class="hint" id="count"></span></div>' +
    '<div class="grid2" style="gap:12px"><div class="field"><label for="f-conv">Semana</label><select class="input" id="f-conv">' + convOpts + '</select></div>' +
    '<div class="field"><label for="f-q">Buscar</label><input class="input" id="f-q" type="search" placeholder="Población, juzgado, causa…" value="' + esc(F.q) + '" autocomplete="off"></div></div>' +
    '<div class="field"><label>Cuerpo</label>' + chipRow('cu', [['all', 'Todos']].concat(CUCHIPS), F.cu) + '</div>' +
    '<div class="field"><label>Provincia</label>' + chipRow('prov', [['all', 'Todas']].concat(PROVS.map(function (p) { return [p, p]; })), F.prov) + '</div>' +
    '<div class="field"><label>Tipo de oferta</label>' + chipRow('tipo', [['all', 'Todos']].concat(TIP.map(function (t, i) { return [i, t.n, '<i class="dot d-' + t.cls + '"></i>']; })), F.tipo) + '</div>' +
    '<div class="row"><button class="chip" type="button" id="f-mine" aria-pressed="' + F.mine + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>Solo mis zonas' + (favs.size ? ' (' + favs.size + ')' : '') + '</button>' +
    (F.pob ? '<button class="chip" type="button" id="f-pob" aria-pressed="true">Población: ' + esc(F.pob) + ' ✕</button>' : '') +
    '<button class="chip" type="button" id="f-reset">Limpiar filtros</button></div></section>' +
    '<section id="results"></section>';
}
function renderResults() {
  var list = filtered(), shown = list.slice(0, F.shown), host = $('#results');
  if (!host) return;
  $('#count').textContent = list.length + (list.length === 1 ? ' oferta' : ' ofertas');
  host.innerHTML = list.length ? '<div class="offers">' + shown.map(function (o) { return offerCard(o); }).join('') + '</div>' + (list.length > shown.length ? '<div class="row" style="justify-content:center;margin-top:16px"><button class="btn" id="more">Mostrar más (' + (list.length - shown.length) + ' restantes)</button></div>' : '') : '<div class="card empty">No hay ofertas con estos filtros. Prueba con otra semana o quita algún filtro.</div>';
  var more = $('#more'); if (more) more.addEventListener('click', function () { F.shown += 24; renderResults(); });
  bindFavs(host, function () { renderResults(); });
}
function afterOfertas() {
  var v = $('#view');
  $('#f-conv').addEventListener('change', function (e) { F.conv = e.target.value; F.shown = 24; renderResults(); });
  $('#f-q').addEventListener('input', debounce(function () { F.q = $('#f-q').value; F.shown = 24; renderResults(); }, 150));
  $$('.chip[data-k]', v).forEach(function (b) {
    b.addEventListener('click', function () {
      F[b.dataset.k] = b.dataset.v; F.shown = 24;
      $$('.chip[data-k="' + b.dataset.k + '"]', v).forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.v) === String(F[b.dataset.k])); });
      renderResults();
    });
  });
  $('#f-mine').addEventListener('click', function () { F.mine = !F.mine; $('#f-mine').setAttribute('aria-pressed', F.mine); renderResults(); });
  var pb = $('#f-pob'); if (pb) pb.addEventListener('click', function () { F.pob = null; render(); });
  $('#f-reset').addEventListener('click', function () { F = { conv: 'last', cu: 'all', prov: 'all', tipo: 'all', q: '', mine: false, pob: null, shown: 24 }; render(); });
  renderResults();
}

function zonaStats() {
  var from = Z.win >= 99 ? 0 : last.c - Z.win + 1, m = {};
  offers.forEach(function (o) {
    if (o.c < from) return; if (Z.cu !== 'all' && o.cu !== +Z.cu) return;
    var z = m[o.pob] || (m[o.pob] = { n: o.pob, prov: o.prov, t: [0, 0, 0], tot: 0 });
    z.t[o.tipo]++; z.tot++;
  });
  return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.tot - a.tot || a.n.localeCompare(b.n); });
}
function viewZonas() {
  var rows = zonaStats(), mx = rows.length ? rows[0].tot : 1, totW = Z.win >= 99 ? weeks.length : Z.win;
  var shown = Z.all ? rows : rows.slice(0, 20);
  var provT = PROVS.map(function (p) { var t = [0, 0, 0]; rows.forEach(function (r) { if (r.prov === p) r.t.forEach(function (v, i) { t[i] += v; }); }); return { p: p, t: t, tot: t[0] + t[1] + t[2] }; });
  var pm = Math.max.apply(null, provT.map(function (x) { return x.tot; })) || 1;
  var bar = function (t, m) { return '<div class="zbar">' + t.map(function (v, i) { return v ? '<i style="flex:' + v + ';background:var(' + TIP[i].v + ')"></i>' : ''; }).join('') + '</div>'; };
  return '<section class="card"><div class="sec-h"><div><h2>Dónde salen ofertas</h2><p class="hint">Número de ofertas por población. Pulsa una población para ver sus ofertas; la estrella la guarda como zona tuya.</p></div></div>' +
    '<div class="field" style="margin-top:12px"><label>Periodo</label><div class="row" role="group" aria-label="Periodo">' + [[4, 'Últimas 4 semanas'], [8, 'Últimas 8'], [16, 'Últimas 16'], [99, 'Todo']].map(function (x) { return '<button class="chip" type="button" data-z="win" data-v="' + x[0] + '" aria-pressed="' + (Z.win === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div></div>' +
    '<div class="field" style="margin-top:12px"><label>Cuerpo</label><div class="row" role="group" aria-label="Cuerpo">' + [['all', 'Todos']].concat(CUCHIPS).map(function (x) { return '<button class="chip" type="button" data-z="cu" data-v="' + x[0] + '" aria-pressed="' + (String(Z.cu) === String(x[0])) + '">' + x[1] + '</button>'; }).join('') + '</div></div></section>' +
    '<section class="grid2"><div class="card"><h3>Por provincia</h3><div style="margin-top:8px">' + provT.map(function (p) { return '<div class="zrow"><div class="zname"><b>' + p.p + '</b></div>' + '<div class="zbar" style="width:' + Math.max(6, 100 * p.tot / pm) + '%">' + p.t.map(function (v, i) { return v ? '<i style="flex:' + v + ';background:var(' + TIP[i].v + ')"></i>' : ''; }).join('') + '</div><div class="zn num">' + p.tot + '</div></div>'; }).join('') + '</div>' + legend(TIP.map(function (t) { return { n: t.n, c: t.v }; })) + '</div>' +
    '<div class="card"><h3>Ritmo medio</h3><p class="hint" style="margin-top:4px">Ofertas por semana en ' + (Z.win >= 99 ? 'todo el periodo' : 'el periodo elegido') + '</p><div class="kpis"><div class="kpi"><b class="num">' + (rows.reduce(function (s, r) { return s + r.tot; }, 0) / totW).toFixed(0) + '</b><span>ofertas/semana</span></div><div class="kpi"><b class="num">' + rows.length + '</b><span>poblaciones</span></div><div class="kpi"><b class="num">' + rows.reduce(function (s, r) { return s + r.tot; }, 0) + '</b><span>ofertas en total</span></div></div></div></section>' +
    '<section class="card"><h3>Poblaciones</h3><div style="margin-top:6px">' + shown.map(function (r) {
      return '<div class="zrow"><div class="zname">' + starBtn(r.n) + '<button class="lnk" type="button" data-pob="' + esc(r.n) + '">' + esc(r.n) + '</button></div><div class="zbar" style="width:' + Math.max(6, 100 * r.tot / mx) + '%">' + r.t.map(function (v, i) { return v ? '<i style="flex:' + v + ';background:var(' + TIP[i].v + ')" title="' + TIP[i].n + ': ' + v + '"></i>' : ''; }).join('') + '</div><div class="zn num">' + r.tot + '</div></div>';
    }).join('') + '</div>' + (rows.length > 20 ? '<div class="row" style="justify-content:center;margin-top:12px"><button class="btn small" id="zall">' + (Z.all ? 'Ver solo las 20 primeras' : 'Ver las ' + rows.length) + '</button></div>' : '') + '</section>';
}
function afterZonas() {
  var v = $('#view');
  $$('button[data-z]', v).forEach(function (b) { b.addEventListener('click', function () { Z[b.dataset.z] = b.dataset.z === 'win' ? +b.dataset.v : b.dataset.v; render(); }); });
  $$('button[data-pob]', v).forEach(function (b) { b.addEventListener('click', function () { F = { conv: 'all', cu: 'all', prov: 'all', tipo: 'all', q: '', mine: false, pob: b.dataset.pob, shown: 24 }; location.hash = '#ofertas'; }); });
  var za = $('#zall'); if (za) za.addEventListener('click', function () { Z.all = !Z.all; render(); });
  bindFavs(v, function () { render(); });
}

/* ---- Mi posición ---- */
function groupsFor(cu) {
  var s = {}; D.cortes.forEach(function (r) { if (r[1] === cu) s[r[2]] = 1; });
  return Object.keys(s).map(Number).sort();
}
var CUKEYS = [['AJ', 'Auxilio Judicial'], ['TPA', 'Tramitación Procesal y Administrativa'], ['GPA', 'Gestión Procesal y Administrativa'], ['MF', 'Médicos Forenses']];
function viewPos() {
  if (typeof P.cu !== 'string') P.cu = 'AJ';
  var gs = groupsFor(P.cu); if (gs.indexOf(+P.g) < 0) P.g = gs[0];
  return '<section class="card"><h2>Mi posición</h2><p class="hint">Compara tu posición con hasta dónde han llegado las adjudicaciones de tu grupo cada semana.</p>' +
    '<div class="grid2" style="gap:12px;margin-top:14px"><div class="field"><label for="p-cu">Cuerpo</label><select class="input" id="p-cu">' + CUKEYS.map(function (k) { return '<option value="' + k[0] + '"' + (P.cu === k[0] ? ' selected' : '') + '>' + k[1] + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label for="p-g">Mi grupo</label><select class="input" id="p-g">' + gs.map(function (g) { return '<option value="' + g + '"' + (+P.g === g ? ' selected' : '') + '>Grupo ' + g + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label for="p-pos">Mi posición dentro del grupo</label><input class="input" id="p-pos" type="number" inputmode="numeric" min="1" step="1" value="' + esc(P.pos) + '"></div>' +
    '<div class="field"><label>Periodo</label><div class="row" role="group" aria-label="Periodo">' + [['todas', 'Desde la 18'], ['22', 'Desde la 22']].map(function (x) { return '<button class="chip" type="button" data-per="' + x[0] + '" aria-pressed="' + (P.per === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div></div></div></section>' +
    '<section id="pos-out" class="grid2" style="align-items:start"></section>' +
    '<section class="callout"><b>¿Cómo sé mi posición?</b> El listado oficial no numera las filas. Dentro de tu cuerpo, las personas van en bloques por grupo (1, 2, 3 y 4). Tu posición es el lugar que ocupas contando solo desde el principio de tu grupo. Es la parte más manual de la consulta. Con el área personal no hace falta contar: la web encuentra tu fila. <a href="#cuenta">Ver cómo será</a>.</section>';
}
function cutChart(host, rows, pos) {
  function draw() {
    if (!host || !host.isConnected) return;
    var Wd = Math.max(260, host.clientWidth), H = 230, m = { l: 40, r: 8, t: 10, b: 26 }, iw = Wd - m.l - m.r, ih = H - m.t - m.b;
    var top = Math.max(pos, 10, Math.max.apply(null, rows.map(function (r) { return r[6] == null ? 0 : r[6]; }))), nm = nice(top), n = rows.length, st = iw / n;
    var y = function (v) { return m.t + ih - (v / nm.m) * ih; };
    var s = '<svg viewBox="0 0 ' + Wd + ' ' + H + '" role="img" aria-label="Última posición adjudicada por semana en tu grupo, comparada con tu posición">';
    for (var v = 0; v <= nm.m; v += nm.t) s += '<line x1="' + m.l + '" x2="' + (Wd - m.r) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)"/><text x="' + (m.l - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v + '</text>';
    s += '<line x1="' + m.l + '" x2="' + (Wd - m.r) + '" y1="' + y(Math.min(pos, nm.m)) + '" y2="' + y(Math.min(pos, nm.m)) + '" stroke="var(--c-sus)" stroke-width="2" stroke-dasharray="5 4"/>';
    rows.forEach(function (r, i) {
      var x = m.l + st * i + st / 2, lb = ((n - 1 - i) % Math.ceil(n / 8) === 0) ? r[0] : '';
      if (lb !== '') s += '<text x="' + x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + lb + '</text>';
      if (r[6] != null) s += '<circle cx="' + x.toFixed(1) + '" cy="' + y(r[6]).toFixed(1) + '" r="5" style="fill:' + (r[6] >= pos ? 'var(--brand)' : 'var(--c-none)') + '" stroke="var(--surface)" stroke-width="2"/>';
      else s += '<line x1="' + (x - 4) + '" x2="' + (x + 4) + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="var(--c-none)" stroke-width="3" stroke-linecap="round"/>';
      s += '<rect class="hit" data-i="' + i + '" x="' + (m.l + st * i).toFixed(1) + '" y="' + m.t + '" width="' + st.toFixed(1) + '" height="' + ih + '" fill="transparent"/>';
    });
    host.innerHTML = s + '</svg>';
    $$('.hit', host).forEach(function (el) {
      var i = +el.dataset.i, r = rows[i], go = function (e) { showTip('<b>Conv. ' + r[0] + '/2026</b>' + tipRows([['Última posición', r[6] == null ? '—' : r[6]], ['Piden ofertas', r[4]], ['Adjudicadas', r[5]]]), e.clientX, e.clientY); };
      el.addEventListener('pointermove', go); el.addEventListener('pointerdown', go); el.addEventListener('pointerleave', hideTip);
    });
  }
  draw(); redraws.push(draw);
}
function renderPos() {
  var out = $('#pos-out'); if (!out) return;
  var pos = Math.max(1, Math.floor(+P.pos) || 1), minC = P.per === '22' ? 22 : 18;
  var rows = D.cortes.filter(function (r) { return r[1] === P.cu && r[2] === +P.g && r[0] >= minC; }).sort(function (a, b) { return a[0] - b[0]; });
  if (!rows.length) { out.innerHTML = '<div class="card empty">No hay datos de este cuerpo y grupo.</div>'; return; }
  var lastR = rows[rows.length - 1], size = lastR[3];
  var W = rows.length, withAdj = rows.filter(function (r) { return r[6] != null; }), K = withAdj.filter(function (r) { return r[6] >= pos; }).length;
  var cuts = withAdj.map(function (r) { return r[6]; }).sort(function (a, b) { return a - b; });
  var med = cuts.length ? cuts[Math.floor(cuts.length / 2)] : null;
  var share = W ? K / W : 0;
  var label = K === 0 ? 'Aún no se ha alcanzado' : share >= 0.7 ? 'Se alcanzó casi siempre' : share >= 0.3 ? 'Se alcanzó a veces' : 'Se alcanzó pocas veces';
  var cls = share >= 0.7 ? 'ok' : share >= 0.3 ? '' : 'warn';
  var lastTxt = lastR[6] != null ? 'La última semana (' + lastR[0] + '/2026), la última persona adjudicada de tu grupo estaba en la posición <b class="num">' + lastR[6] + '</b>.' : 'La última semana (' + lastR[0] + '/2026) no hubo adjudicaciones en tu grupo.';
  var over = pos > size ? '<p class="hint" style="color:var(--warn)">Tu posición supera el tamaño actual del grupo (' + size + ' personas).</p>' : '';
  out.innerHTML = '<div class="card"><span class="pill ' + cls + '">' + label + '</span>' +
    '<p class="verdict" style="margin-top:10px">En <em class="num">' + K + ' de ' + W + ' semanas</em> hubo adjudicaciones en tu grupo en tu posición o más abajo.</p>' +
    '<p style="margin-top:8px">' + lastTxt + (med != null ? ' Mediana de las semanas con adjudicación: <b class="num">' + med + '</b>.' : '') + '</p>' + over +
    '<div class="kpis"><div class="kpi"><b class="num">' + size + '</b><span>personas en el grupo</span></div><div class="kpi"><b class="num">' + lastR[4] + '</b><span>piden ofertas esta semana</span></div><div class="kpi"><b class="num">' + lastR[5] + '</b><span>adjudicadas esta semana</span></div></div>' +
    '<p class="hint" style="margin-top:12px">Orientativo. Adjudicar a alguien por debajo de ti no significa que a ti te hubiera tocado: depende de qué ofertas pidió cada persona y de las zonas. Una semana sin adjudicaciones en tu grupo cuenta como semana sin alcanzar tu posición.</p></div>' +
    '<div class="card"><h3>Última posición adjudicada cada semana</h3><p class="hint">Dentro de tu grupo. La línea discontinua es tu posición. Los valores iniciales (grupo 3, posición 300) son un ejemplo: cámbialos arriba.</p><div class="chart" id="cutchart" style="margin-top:8px"></div>' +
    '<div class="legend" style="margin-top:6px"><span><i class="sw" style="background:var(--brand);border-radius:50%"></i>Tu posición o más abajo</span><span><i class="sw" style="background:var(--c-none);border-radius:50%"></i>Por encima de ti</span><span><i class="sw" style="background:transparent;border:1.5px dashed var(--c-sus);height:0;width:16px;border-radius:0"></i>Tu posición</span></div>' +
    tableToggle('tbl-cut', ['Convocatoria', 'Personas', 'Piden ofertas', 'Adjudicadas', 'Última posición'], rows.map(function (r) { return [r[0] + '/2026', r[3], r[4], r[5], r[6] == null ? '—' : r[6]]; })) + '</div>';
  bindTables(out);
  cutChart($('#cutchart'), rows, pos);
}
function afterPos() {
  var v = $('#view');
  $('#p-cu').addEventListener('change', function (e) { P.cu = e.target.value; store.set('pos', P); render(); });
  $('#p-g').addEventListener('change', function (e) { P.g = +e.target.value; store.set('pos', P); redraws.length = 0; renderPos(); });
  $('#p-pos').addEventListener('input', function (e) { P.pos = e.target.value; store.set('pos', P); redraws.length = 0; renderPos(); });
  $$('button[data-per]', v).forEach(function (b) { b.addEventListener('click', function () { P.per = b.dataset.per; store.set('pos', P); render(); }); });
  renderPos();
}


/* ---- Cuenta (vista previa) ---- */
var C = store.get('acc', { home: 'València', rad: 30, per: 8 });
function dpob(p) { return p.replace('Castelló de la Plana/Castellón de la Plana', 'Castelló de la Plana'); }
function rad(x) { return x * Math.PI / 180; }
function km(a, b) {
  var dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
function homeIdx() { for (var i = 0; i < D.pobs.length; i++) if (dpob(D.pobs[i]) === C.home) return i; return 14; }
function accData(S) {
  var pos = Math.max(1, Math.floor(+S.pos) || 1), g = +S.g;
  var cs = D.cortes.filter(function (r) { return r[1] === S.cu; });
  var lastC = Math.max.apply(null, cs.map(function (r) { return r[0]; }));
  var lw = cs.filter(function (r) { return r[0] === lastC; }).sort(function (a, b) { return a[2] - b[2]; });
  var off = 0, tot = 0, partAhead = 0;
  lw.forEach(function (r) { tot += r[3]; if (r[2] < g) { off += r[3]; partAhead += r[4]; } });
  return { pos: pos, g: g, lastC: lastC, lw: lw, off: off, tot: tot, partAhead: partAhead, mine: lw.filter(function (r) { return r[2] === g; })[0] };
}
function viewCuenta() {
  if (ACC) return '<section id="acc-root" aria-live="polite"><div class="card empty">Cargando tu cuenta…</div></section>';
  if (typeof P.cu !== 'string') P.cu = 'AJ';
  var gs = groupsFor(P.cu); if (gs.indexOf(+P.g) < 0) P.g = gs[0];
  var homes = D.pobs.map(function (p, i) { return { i: i, n: dpob(p) }; }).sort(function (a, b) { return a.n.localeCompare(b.n, 'es'); });
  return '<section class="hero"><div class="hero-t"><p class="eyebrow">Área personal · vista previa</p>' +
    '<h1>Tu puesto, quién tienes delante y dónde hay plazas cerca</h1>' +
    '<p class="lead">Escribes tu nombre una vez y la web encuentra tu fila en el listado oficial. Tú confirmas que eres tú, y nadie más ve tu nombre.</p>' +
    '<div class="row"><button class="btn primary" type="button" disabled>Crear cuenta · próximamente</button><button class="btn" id="goDemo" type="button">Ver cómo será</button></div></div>' +
    '<div class="card"><p class="eyebrow">Precio previsto</p><div class="price-n" style="margin-top:6px"><b class="num">7 días</b> gratis</div>' +
    '<p style="margin-top:8px">Después, <b class="num">9,99 €</b> por curso, sin renovación automática.</p>' +
    '<p class="hint" style="margin-top:8px">Ver ofertas, zonas y datos, y calcular tu posición a mano, sigue siendo gratis.</p></div></section>' +
    '<section class="card"><h2>Cómo se empieza</h2><div class="steps3" style="margin-top:12px"><div><b>1. Escribes tu nombre y eliges tu población</b>El nombre, como aparece en el listado oficial.</div><div><b>2. Confirmas tu fila</b>La web te muestra tu cuerpo, grupo y puesto, y confirmas que eres tú.</div><div><b>3. Empiezas la prueba</b>Siete días con todo el área personal, sin pagar.</div></div></section>' +
    '<section class="card" id="demo"><div class="sec-h"><div><h2>Así se verá tu cuenta</h2><p class="hint">Persona ficticia. Cambia cuerpo, grupo y puesto para probarlo: las cifras salen de los listados reales de la última semana.</p></div><span class="pill warn">Datos de ejemplo</span></div>' +
    '<div class="grid2" style="gap:12px;margin-top:14px"><div class="field"><label for="c-cu">Cuerpo</label><select class="input" id="c-cu">' + CUKEYS.map(function (k) { return '<option value="' + k[0] + '"' + (P.cu === k[0] ? ' selected' : '') + '>' + k[1] + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label for="c-g">Grupo</label><select class="input" id="c-g">' + gs.map(function (g) { return '<option value="' + g + '"' + (+P.g === g ? ' selected' : '') + '>Grupo ' + g + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label for="c-pos">Puesto dentro del grupo</label><input class="input" id="c-pos" type="number" inputmode="numeric" min="1" step="1" value="' + esc(P.pos) + '"></div>' +
    '<div class="field"><label for="c-home">Mi población</label><select class="input" id="c-home">' + homes.map(function (h) { return '<option value="' + esc(h.n) + '"' + (h.n === C.home ? ' selected' : '') + '>' + esc(h.n) + '</option>'; }).join('') + '</select></div></div></section>' +
    '<section id="acc-out" style="display:grid;gap:22px"></section>' +
    '<section class="card"><div class="sec-h"><h3>Alertas</h3><span class="pill">Próximamente</span></div><p class="hint">Avisos por correo, para no tener que entrar cada semana.</p>' +
    '<label class="alrt"><input type="checkbox" checked disabled> Ofertas nuevas en mis poblaciones y mi cuerpo, cuando se publica el listado del viernes.</label>' +
    '<label class="alrt"><input type="checkbox" checked disabled> Aviso cuando el último corte se acerque a mi puesto.</label>' +
    '<label class="alrt"><input type="checkbox" disabled> Resumen del martes con las adjudicaciones de mi grupo.</label></section>' +
    '<section class="callout"><b>Tu nombre.</b> Se usa solo para encontrar tu fila en el listado oficial. No se publica ni lo ve nadie más, y podrás borrar tu cuenta y tus datos cuando quieras. Por delante de ti se muestran cifras, nunca nombres de otras personas.</section>';
}
var curAcc = null;
function rerenderAcc() { if (!curAcc) return; renderCuenta(curAcc.out, curAcc.S); }
function renderCuenta(out, S) {
  if (!out) return;
  curAcc = { out: out, S: S };
  var d = accData(S), pos = d.pos, mine = d.mine;
  if (!mine) { out.innerHTML = '<div class="card empty">No hay datos de este cuerpo y grupo.</div>'; return; }
  var ahead = d.off + pos - 1, maxN = Math.max.apply(null, d.lw.map(function (r) { return r[3]; }));
  var rowsAll = D.cortes.filter(function (r) { return r[1] === S.cu && r[2] === d.g && r[0] >= 18; }).sort(function (a, b) { return a[0] - b[0]; });
  var rowsC = C.per === 8 ? rowsAll.slice(-8) : rowsAll;
  var withCut = rowsAll.filter(function (r) { return r[6] != null; });
  var lastCut = withCut.length ? withCut[withCut.length - 1] : null;
  var recent = rowsAll.slice(-8).filter(function (r) { return r[6] != null; }).map(function (r) { return r[6]; }).sort(function (a, b) { return a - b; });
  var med8 = recent.length ? recent[Math.floor(recent.length / 2)] : null;
  var cutTxt = lastCut ? (lastCut[6] >= pos ? 'En la última semana con adjudicaciones en tu grupo (conv. ' + lastCut[0] + '), el corte llegó a tu puesto o más allá.' : 'En la última semana con adjudicaciones en tu grupo (conv. ' + lastCut[0] + '), el corte estaba en el puesto <b class="num">' + lastCut[6] + '</b>: te faltaban <b class="num">' + (pos - lastCut[6]) + '</b> puestos.') : 'Tu grupo no tiene adjudicaciones en las semanas con datos.';
  var grp = d.lw.map(function (r) {
    var own = r[2] === d.g, tag = own ? 'tu grupo' : r[2] < d.g ? 'por delante' : 'por detrás';
    var col = own ? 'var(--brand)' : r[2] < d.g ? 'var(--c-vac)' : 'var(--c-none)';
    return '<div class="grow"><div class="gh"><b>Grupo ' + r[2] + ' <span class="pill' + (own ? ' ok' : '') + '">' + tag + '</span></b><span class="muted num">' + r[3].toLocaleString('es-ES') + ' personas</span></div>' +
      '<div class="gbar" aria-hidden="true"><i style="width:' + Math.max(1, 100 * r[3] / maxN) + '%;background:' + col + '"></i>' + (own ? '<u style="left:calc(' + (100 * Math.min(pos, r[3]) / maxN) + '% - 1px)" title="Tu puesto"></u>' : '') + '</div>' +
      '<p class="hint">Esta semana: ' + r[4] + ' piden ofertas, ' + r[5] + ' adjudicadas' + (r[6] != null ? ', último puesto adjudicado ' + r[6] : '') + '.</p></div>';
  }).join('');
  var hi = homeIdx(), home = D.xy[hi], from = last.c - 7, near = {}, lastNear = [];
  offers.forEach(function (o) {
    if (CUC[o.cu] !== S.cu) return;
    var dist = km(home, D.xy[o.pi]); if (dist > C.rad) return;
    if (o.c >= from) { var z = near[o.pi] || (near[o.pi] = { n: o.pob, d: dist, t: [0, 0, 0], tot: 0 }); z.t[o.tipo]++; z.tot++; }
    if (o.c === last.c) lastNear.push({ o: o, d: dist });
  });
  var nearRows = Object.keys(near).map(function (k) { return near[k]; }).sort(function (a, b) { return a.d - b.d; }), maxT = Math.max.apply(null, nearRows.map(function (z) { return z.tot; }).concat([1]));
  lastNear.sort(function (a, b) { return a.d - b.d; });
  var kmTxt = function (x) { return x < 1 ? 'en tu población' : '≈ ' + Math.round(x) + ' km'; };
  var cuName = CUKEYS.filter(function (k) { return k[0] === S.cu; })[0][1];
  out.innerHTML =
    '<div class="card"><div class="week-h"><h2>Tu ficha</h2><span class="muted num">Listado de la conv. ' + d.lastC + '/2026</span></div><p class="hint">' + cuName + ' · grupo ' + d.g + ' · puesto ' + pos + '</p>' +
    '<div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(135px,1fr))"><div class="kpi"><b class="num">' + pos + '</b><span>puesto en tu grupo, de ' + mine[3].toLocaleString('es-ES') + '</span></div>' +
    '<div class="kpi"><b class="num">' + (d.off + pos).toLocaleString('es-ES') + '</b><span>puesto en el cuerpo, de ' + d.tot.toLocaleString('es-ES') + '</span></div>' +
    '<div class="kpi"><b class="num">' + ahead.toLocaleString('es-ES') + '</b><span>personas por delante</span></div>' +
    '<div class="kpi"><b class="num">' + d.partAhead + '</b><span>de grupos anteriores piden ofertas esta semana</span></div></div>' +
    (pos > mine[3] ? '<p class="hint" style="color:var(--warn);margin-top:10px">Tu puesto supera el tamaño actual del grupo (' + mine[3] + ' personas).</p>' : '') + '</div>' +
    '<div class="grid2" style="align-items:start"><div class="card"><h3>Quién tienes delante</h3><p class="hint">Cifras por grupo, sin nombres. El orden del listado es grupo 1, 2, 3 y 4. La marca naranja es tu puesto. En cada grupo solo piden ofertas algunas personas cada semana, y muchas solo piden las cercanas a donde viven.</p><div style="margin-top:8px">' + grp + '</div></div>' +
    '<div class="card"><h3>Tu puesto frente al corte</h3><p class="hint">Última posición adjudicada de tu grupo cada semana. La línea discontinua es tu puesto.</p>' +
    '<div class="row" role="group" aria-label="Periodo" style="margin-top:10px">' + [[8, 'Últimas 8 semanas'], [0, 'Desde la 18']].map(function (x) { return '<button class="chip" type="button" data-cper="' + x[0] + '" aria-pressed="' + (C.per === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>' +
    '<div class="chart" id="accchart" style="margin-top:8px"></div>' +
    '<div class="legend" style="margin-top:6px"><span><i class="sw" style="background:var(--brand);border-radius:50%"></i>Tu puesto o más abajo</span><span><i class="sw" style="background:var(--c-none);border-radius:50%"></i>Por encima de ti</span></div>' +
    '<p style="margin-top:12px">' + cutTxt + (med8 != null ? ' Mediana de las últimas semanas con adjudicación: <b class="num">' + med8 + '</b>.' : '') + '</p><p class="hint" style="margin-top:6px">Es lo que ha pasado, no una predicción: el corte depende de las ofertas que salgan y de lo que pida cada persona.</p></div></div>' +
    '<div class="card"><div class="sec-h"><div><h3>Cerca de ti</h3><p class="hint">Ofertas de ' + cuName + ' desde ' + esc(C.home) + '. Distancia aproximada en línea recta. Muchas personas solo piden ofertas cerca de donde viven, por eso cuentan las de tu zona.</p></div></div>' +
    '<div class="row" role="group" aria-label="Distancia máxima" style="margin-top:10px">' + [[15, '15 km'], [30, '30 km'], [60, '60 km'], [100, '100 km'], [999, 'Toda la Comunitat']].map(function (x) { return '<button class="chip" type="button" data-crad="' + x[0] + '" aria-pressed="' + (C.rad === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>' +
    '<div class="grid2" style="align-items:start;margin-top:14px"><div><h3 style="font-size:15px">Poblaciones, últimas 8 semanas</h3>' +
    (nearRows.length ? '<div style="margin-top:6px">' + nearRows.slice(0, 12).map(function (z) {
      return '<div class="zrow"><div class="zname" style="flex-direction:column;align-items:flex-start;gap:0"><b>' + esc(z.n) + '</b><span class="muted" style="font-size:13px">' + kmTxt(z.d) + '</span></div><div class="zbar" style="width:' + Math.max(6, 100 * z.tot / maxT) + '%">' + z.t.map(function (v, i) { return v ? '<i style="flex:' + v + ';background:var(' + TIP[i].v + ')" title="' + TIP[i].n + ': ' + v + '"></i>' : ''; }).join('') + '</div><div class="zn num">' + z.tot + '</div></div>';
    }).join('') + '</div>' : '<p class="hint" style="margin-top:8px">No ha habido ofertas de tu cuerpo a esta distancia en las últimas 8 semanas.</p>') + '</div>' +
    '<div><h3 style="font-size:15px">Ofertas de esta semana (conv. ' + last.c + ')</h3>' +
    (lastNear.length ? '<div class="offers" style="margin-top:8px;grid-template-columns:1fr">' + lastNear.slice(0, 5).map(function (x) { return offerCard(x.o, kmTxt(x.d)); }).join('') + '</div>' + (lastNear.length > 5 ? '<p class="hint" style="margin-top:8px">Y ' + (lastNear.length - 5) + ' más en <a href="#ofertas">Ofertas</a>.</p>' : '') : '<p class="hint" style="margin-top:8px">Esta semana no hay ofertas de tu cuerpo a esta distancia.</p>') + '</div></div></div>';
  cutChart($('#accchart'), rowsC, pos);
  bindCuenta(out);
}
function afterCuenta() {
  if (ACC) { accBoot(); return; }
  var v = $('#view');
  $('#goDemo').addEventListener('click', function () { var el = $('#demo'); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $('#c-cu').addEventListener('change', function (e) { P.cu = e.target.value; store.set('pos', P); render(); });
  $('#c-g').addEventListener('change', function (e) { P.g = +e.target.value; store.set('pos', P); rerenderAcc(); });
  $('#c-pos').addEventListener('input', function (e) { P.pos = e.target.value; store.set('pos', P); rerenderAcc(); });
  $('#c-home').addEventListener('change', function (e) { C.home = e.target.value; store.set('acc', C); rerenderAcc(); });
  renderCuenta($('#acc-out'), P);
}
function bindCuenta(v) {
  $$('button[data-cper]', v).forEach(function (b) { b.addEventListener('click', function () { C.per = +b.dataset.cper; store.set('acc', C); rerenderAcc(); }); });
  $$('button[data-crad]', v).forEach(function (b) { b.addEventListener('click', function () { C.rad = +b.dataset.crad; store.set('acc', C); onProfile(); rerenderAcc(); }); });
}
var onProfile = function () {};

/* ---- Cuenta real (con Supabase) ---- */
var A = { mode: 'in', me: null, pos: null, hist: null, sel: 0, nombre: '' };
var ESTADO = { no_pide: 'No pides ofertas esta semana', pide_sin_plaza: 'Has pedido ofertas esta semana y no te ha tocado ninguna', adjudicada: 'Te han adjudicado una oferta esta semana', adjudicada_otro_cuerpo: 'Tenías ya una adjudicación en otro cuerpo' };
function cuNombre(c) { var k = CUKEYS.filter(function (x) { return x[0] === c; })[0]; return k ? k[1] : c; }
function accRoot() { return $('#acc-root'); }
function msg(f) { return f ? '<div class="msg ' + (f.err ? 'err' : 'ok') + '" role="' + (f.err ? 'alert' : 'status') + '">' + esc(f.err || f.ok) + '</div>' : ''; }
function pidOfName(n) { if (!D.pid) return null; for (var i = 0; i < D.pobs.length; i++) if (dpob(D.pobs[i]) === n) return D.pid[i]; return null; }
function pushFav(name, on) { if (ACC && ACC.loggedIn() && A.me) { var id = pidOfName(name); if (id != null) ACC.setZona(id, on)['catch'](function () {}); } }
var saveProfileSoon = debounce(function () {
  if (!ACC || !ACC.loggedIn() || !A.me) return;
  var id = pidOfName(C.home); if (id == null) return;
  ACC.saveProfile({ poblacion_base_id: id, radio_km: C.rad })['catch'](function () {});
}, 600);
onProfile = saveProfileSoon;

function pricing() {
  return '<div class="card"><p class="eyebrow">Precio</p><div class="price-n" style="margin-top:6px"><b class="num">7 días</b> gratis</div>' +
    '<p style="margin-top:8px">Después, <b class="num">9,99 €</b> por curso, sin renovación automática.</p>' +
    '<p class="hint" style="margin-top:8px">La prueba empieza cuando confirmas tu fila. Ver ofertas, zonas y datos, y calcular tu posición a mano, sigue siendo gratis.</p></div>';
}
function accFatal(e) {
  var r = accRoot(); if (!r) return;
  if (e && (e.status === 401 || e.status === 403)) { ACC.signOut(); A.me = null; return accAuth({ err: 'Tu sesión ha caducado. Vuelve a entrar.' }); }
  r.innerHTML = '<div class="card empty" role="alert"><b>No se ha podido cargar tu cuenta.</b><br>' + esc(e && e.message || 'Error desconocido') + '<br><button class="btn" id="a-retry" type="button" style="margin-top:12px">Reintentar</button></div>';
  $('#a-retry').addEventListener('click', accLoad);
}
function accBoot() {
  ACC.whenReady().then(function () {
    var h = ACC.consumeHash(), flash = null;
    if (h.error) flash = { err: h.error };
    else if (h.confirmed) flash = { ok: 'Correo confirmado. Ya puedes seguir.' };
    if (h.recovery && ACC.loggedIn()) return accRecovery();
    if (!ACC.loggedIn()) return accAuth(flash);
    accLoad(flash);
  });
}
function submitForm(form, fn) {
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var btn = $('button[type=submit]', form); if (btn.disabled) return;
    btn.disabled = true; var t = btn.textContent; btn.textContent = 'Un momento…';
    var done = function () { if (btn.isConnected) { btn.disabled = false; btn.textContent = t; } };
    Promise.resolve().then(function () { return fn(); }).then(done, function (e) { done(); var m = $('#f-msg', form); if (m) m.innerHTML = msg({ err: e && e.message || 'Error' }); });
  });
}
function accAuth(flash) {
  var r = accRoot(); if (!r) return;
  var up = A.mode === 'up', forgot = A.mode === 'forgot';
  var form = '<div class="row" role="group" aria-label="Entrar o crear cuenta">' +
    [['in', 'Entrar'], ['up', 'Crear cuenta']].map(function (x) { return '<button class="chip" type="button" data-amode="' + x[0] + '" aria-pressed="' + (A.mode === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>' +
    '<form class="form" id="auth-f" novalidate style="margin-top:14px">' +
    '<div class="field"><label for="a-email">Correo electrónico</label><input class="input" id="a-email" type="email" autocomplete="email" inputmode="email" required></div>' +
    (forgot ? '' : '<div class="field"><label for="a-pw">Contraseña' + (up ? ' (mínimo 8 caracteres)' : '') + '</label><input class="input" id="a-pw" type="password" autocomplete="' + (up ? 'new-password' : 'current-password') + '" required></div>') +
    '<div id="f-msg">' + msg(flash) + '</div>' +
    '<button class="btn primary" type="submit">' + (forgot ? 'Enviarme un enlace' : up ? 'Crear cuenta' : 'Entrar') + '</button>' +
    (A.mode === 'in' ? '<button class="linkbtn" type="button" id="a-forgot">He olvidado la contraseña</button>' : forgot ? '<button class="linkbtn" type="button" id="a-back">Volver</button>' : '') +
    '</form>';
  r.innerHTML = '<section class="hero"><div class="hero-t"><p class="eyebrow">Área personal</p><h1>' + (forgot ? 'Recupera tu contraseña' : 'Tu puesto, quién tienes delante y dónde hay plazas cerca') + '</h1>' +
    '<p class="lead">Crea tu cuenta, escribe tu nombre una vez y la web encuentra tu fila en el listado oficial. Tú confirmas que eres tú, y nadie más ve tu nombre.</p></div><div class="card">' + form + '</div></section>' +
    pricing() +
    '<section class="card"><h2>Cómo se empieza</h2><div class="steps3" style="margin-top:12px"><div><b>1. Creas tu cuenta</b>Con tu correo y una contraseña.</div><div><b>2. Confirmas tu fila</b>Escribes tu nombre y la web te muestra tu cuerpo, grupo y puesto.</div><div><b>3. Empiezas la prueba</b>Siete días con todo el área personal, sin pagar.</div></div></section>' +
    '<section class="callout"><b>Tu nombre.</b> Se usa solo para encontrar tu fila en el listado oficial. La web no guarda tu nombre: guarda un código que no se puede deshacer y que sirve para reconocer tu fila. Por delante de ti se muestran cifras, nunca nombres de otras personas. Puedes borrar tu cuenta y tus datos cuando quieras.</section>';
  $$('button[data-amode]', r).forEach(function (b) { b.addEventListener('click', function () { A.mode = b.dataset.amode; accAuth(); }); });
  var fg = $('#a-forgot'); if (fg) fg.addEventListener('click', function () { A.mode = 'forgot'; accAuth(); });
  var bk = $('#a-back'); if (bk) bk.addEventListener('click', function () { A.mode = 'in'; accAuth(); });
  submitForm($('#auth-f'), function () {
    var email = $('#a-email').value.trim(), pw = $('#a-pw') ? $('#a-pw').value : '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Escribe un correo válido.');
    if (forgot) return ACC.recover(email).then(function () { $('#f-msg').innerHTML = msg({ ok: 'Si hay una cuenta con ese correo, te llegará un enlace para elegir una contraseña nueva.' }); });
    if (!pw) throw new Error('Escribe la contraseña.');
    if (up) {
      if (pw.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
      return ACC.signUp(email, pw).then(function (res) {
        if (res.confirmed) return accLoad({ ok: 'Cuenta creada.' });
        $('#auth-f').innerHTML = msg({ ok: 'Te hemos enviado un correo a ' + email + '. Pulsa el enlace para confirmar la cuenta y vuelve aquí. Si no llega, mira en spam.' });
      });
    }
    return ACC.signIn(email, pw).then(function () { accLoad(); });
  });
}
function accRecovery() {
  var r = accRoot(); if (!r) return;
  r.innerHTML = '<section class="card"><h2>Elige una contraseña nueva</h2><form class="form" id="rec-f" novalidate style="margin-top:12px"><div class="field"><label for="r-pw">Contraseña nueva (mínimo 8 caracteres)</label><input class="input" id="r-pw" type="password" autocomplete="new-password" required></div><div id="f-msg"></div><button class="btn primary" type="submit">Guardar contraseña</button></form></section>';
  submitForm($('#rec-f'), function () {
    var pw = $('#r-pw').value; if (pw.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
    return ACC.setPassword(pw).then(function () { accLoad({ ok: 'Contraseña cambiada.' }); });
  });
}
function accLoad(flash) {
  var r = accRoot(); if (!r) return;
  r.innerHTML = '<div class="card empty" role="status">Cargando tu cuenta…</div>';
  ACC.me().then(function (me) {
    A.me = me; applyMe(me);
    if (!me.listas.length) return accAlta(flash);
    accDash(flash);
  }, accFatal);
}
function applyMe(me) {
  if (me.perfil) {
    var i = D.pid ? D.pid.indexOf(me.perfil.poblacion_base_id) : -1;
    if (i >= 0) C.home = dpob(D.pobs[i]);
    if (me.perfil.radio_km) C.rad = me.perfil.radio_km;
  }
  if (D.pid) {
    var server = {}; me.zonas.forEach(function (id) { var i = D.pid.indexOf(id); if (i >= 0) { var n = dpob(D.pobs[i]); server[n] = 1; favs.add(n); } });
    favs.forEach(function (n) { if (!server[n]) { var id = pidOfName(n); if (id != null) ACC.setZona(id, true)['catch'](function () {}); } });
    saveFavs();
  }
}

/* paso 1 y 2 del alta: buscar las filas y confirmarlas (se puede estar en varios cuerpos a la vez) */
function accAlta(flash, opts) {
  var r = accRoot(); if (!r) return;
  var add = !!(opts && opts.add);
  var lw = weeks.filter(function (w) { return w.filas != null; }).pop();
  var homesHtml = add ? '' : '<div class="field"><label for="n-home">Tu población</label><select class="input" id="n-home">' + D.pobs.map(function (p) { return { n: dpob(p) }; }).sort(function (a, b) { return a.n.localeCompare(b.n, 'es'); }).map(function (h) { return '<option value="' + esc(h.n) + '"' + (h.n === C.home ? ' selected' : '') + '>' + esc(h.n) + '</option>'; }).join('') + '</select><p class="hint" style="margin-top:6px">Donde vives o desde donde te mueves. Se usa para ordenar las ofertas por distancia. Podrás cambiarla cuando quieras.</p></div>';
  r.innerHTML = '<section class="card"><div class="sec-h"><div><h2>' + (add ? 'Buscar otra vez tu nombre' : 'Encuentra tu fila') + '</h2><p class="hint">Escribe tu nombre y apellidos como salen en el listado oficial. Se busca en el último listado completo' + (lw ? ' (convocatoria ' + lw.c + '/2026)' : '') + '.</p></div></div>' +
    msg(flash) +
    '<form class="form" id="n-f" novalidate style="margin-top:12px"><div class="field"><label for="n-nombre">Nombre y apellidos</label><input class="input" id="n-nombre" type="text" autocomplete="name" placeholder="Por ejemplo: María García López" required></div>' + homesHtml + '<div id="f-msg"></div><div class="row"><button class="btn primary" type="submit">Buscar mi fila</button>' + (add ? '<button class="btn" type="button" id="n-cancel">Cancelar</button>' : '') + '</div></form>' +
    '<div id="n-out" style="margin-top:14px;display:grid;gap:10px"></div></section>' +
    '<section class="callout"><b>Tu nombre no se guarda en nuestros servidores.</b> Se convierte en un código que no se puede deshacer y se descarta; solo lo recuerda tu navegador, para mostrarlo en tu pantalla. Puedes escribirlo con o sin acentos y con los apellidos en cualquier orden. Solo aparecen los cuerpos que tuvieron ofertas esa semana. Tienes un máximo de 20 búsquedas al día.</section>' +
    accCard(true);
  bindAccCard();
  if (add) $('#n-cancel').addEventListener('click', function () { accLoad(); });
  var tienes = {}; if (A.me && A.me.listas) A.me.listas.forEach(function (l) { tienes[l.cuerpo] = 1; });
  submitForm($('#n-f'), function () {
    var nombre = $('#n-nombre').value.trim(); A.nombre = nombre; $('#n-out').innerHTML = '';
    if (nombre.length < 6) throw new Error('Escribe nombre y apellidos.');
    return ACC.buscar(nombre).then(function (rows) {
      $('#f-msg').innerHTML = '';
      if (!rows.length) { $('#n-out').innerHTML = '<div class="msg">No hemos encontrado ese nombre en el último listado. Prueba con los dos apellidos, o revisa cómo sale escrito en el PDF. Si tu cuerpo no tuvo ofertas esa semana, no aparece en el listado.</div>'; return; }
      $('#n-out').innerHTML = '<p class="hint">' + (rows.length > 1 ? 'Esto es lo que hemos encontrado. Puedes estar en varios cuerpos a la vez: deja marcadas todas las filas que sean tuyas.' : 'Esto es lo que hemos encontrado. Confirma que eres tú:') + '</p>' + rows.map(function (x, i) {
        var ya = !!tienes[x.cuerpo];
        return '<label class="cand"><span class="candck"><input type="checkbox" data-ck="' + i + '" checked' + (ya ? ' disabled' : '') + '><span><b>' + esc(cuNombre(x.cuerpo)) + ' · grupo ' + x.grupo + '</b><span class="muted">Puesto ' + x.posicion_en_grupo + ' de ' + x.personas_en_grupo + ' en tu grupo (convocatoria ' + x.convocatoria + '/2026)</span></span></span>' + (ya ? '<span class="pill ok">Ya la tienes</span>' : '') + '</label>';
      }).join('') + '<div class="row"><button class="btn primary" type="button" id="n-ok">' + (rows.length > 1 ? 'Soy yo en las filas marcadas' : 'Soy yo') + '</button></div>';
      var cks = $$('input[data-ck]', $('#n-out')), okb = $('#n-ok');
      function marcadas() { return rows.filter(function (x, i) { return cks[i].checked && !cks[i].disabled; }); }
      function refresca() { okb.disabled = !marcadas().length; }
      cks.forEach(function (c) { c.addEventListener('change', refresca); }); refresca();
      okb.addEventListener('click', function () {
        var elegidas = marcadas(); if (!elegidas.length) return;
        okb.disabled = true; okb.textContent = 'Un momento…';
        elegidas.reduce(function (p, x) { return p.then(function () { return ACC.confirmar(A.nombre, x.cuerpo, x.orden); }); }, Promise.resolve()).then(function () {
          guardaNombre(A.nombre); A.nombre = ''; var h = $('#n-home'); if (h && h.value) { C.home = h.value; store.set('acc', C); }
          var id = pidOfName(C.home), g = (!add && id != null) ? ACC.saveProfile({ poblacion_base_id: id, radio_km: C.rad }) : Promise.resolve();
          return g['catch'](function () {}).then(function () { accLoad({ ok: add ? 'Listo. Hemos añadido tus filas.' : 'Listo. Empieza tu prueba gratuita de 7 días.' }); });
        }, function (e) { okb.disabled = false; okb.textContent = rows.length > 1 ? 'Soy yo en las filas marcadas' : 'Soy yo'; $('#f-msg').innerHTML = msg({ err: e.message }); });
      });
    });
  });
}

/* El nombre solo se guarda en ESTE navegador (localStorage), nunca en el servidor: el servidor solo conoce la huella. */
function nombreGuardado() { var m = store.get('nom', {}); return (ACC && m[ACC.email()]) || ''; }
function guardaNombre(n) { n = (n || '').replace(/\s+/g, ' ').trim(); if (!n || !ACC) return; var m = store.get('nom', {}); m[ACC.email()] = n; store.set('nom', m); }
function olvidaNombre() { if (!ACC) return; var m = store.get('nom', {}); delete m[ACC.email()]; store.set('nom', m); }
function bonito(n) {
  if (n !== n.toUpperCase() && n !== n.toLowerCase()) return n;
  return n.toLowerCase().replace(/(^|[\s,\-'])(\S)/g, function (m, a, b) { return a + b.toUpperCase(); }).replace(/\s(De|Del|La|Las|Los|Y|E)(?=[\s,])/g, function (m, w) { return ' ' + w.toLowerCase(); });
}

/* área personal */
function accCard(withDelete) {
  return '<section class="card"><h3>Mi cuenta</h3><p class="hint">Sesión iniciada como <b>' + esc(ACC.email()) + '</b>.</p>' +
    '<div class="row" style="margin-top:10px"><button class="btn small" type="button" id="a-out">Cerrar sesión</button>' + (withDelete !== false ? '<button class="btn small danger" type="button" id="a-del">Borrar mi cuenta</button>' : '') + '</div>' +
    '<div id="del-box" hidden style="margin-top:12px;display:grid;gap:10px"><p>Se borrarán tu cuenta, tu fila guardada, tus zonas y tus preferencias. No se puede deshacer. Escribe <b>BORRAR</b> para confirmar.</p>' +
    '<div class="row"><input class="input" id="del-t" type="text" autocomplete="off" aria-label="Escribe BORRAR" style="max-width:180px"><button class="btn small danger" type="button" id="del-ok" disabled>Borrar para siempre</button></div><div id="del-msg"></div></div></section>';
}
function bindAccCard() {
  var o = $('#a-out'); if (o) o.addEventListener('click', function () { ACC.signOut().then(function () { A.me = null; A.mode = 'in'; accAuth(); }); });
  var d = $('#a-del'); if (!d) return;
  var box = $('#del-box'); box.hidden = true; box.style.display = '';
  d.addEventListener('click', function () { box.hidden = !box.hidden; if (!box.hidden) $('#del-t').focus(); });
  $('#del-t').addEventListener('input', function (e) { $('#del-ok').disabled = e.target.value.trim().toUpperCase() !== 'BORRAR'; });
  $('#del-ok').addEventListener('click', function () {
    var b = this; b.disabled = true; b.textContent = 'Borrando…';
    ACC.borrar().then(function () { olvidaNombre(); A.me = null; A.mode = 'in'; accAuth({ ok: 'Tu cuenta y tus datos se han borrado.' }); },
      function (e) { b.disabled = false; b.textContent = 'Borrar para siempre'; $('#del-msg').innerHTML = msg({ err: e.message }); });
  });
}
function subState() {
  var s = A.me && A.me.suscripcion, now = new Date();
  var paid = !!(s && s.pagado_hasta && new Date(s.pagado_hasta + 'T23:59:59') >= now);
  var trial = !!(s && new Date(s.prueba_fin) > now);
  var left = trial ? Math.max(1, Math.ceil((new Date(s.prueba_fin) - now) / 86400000)) : 0;
  return { paid: paid, trial: trial, left: left, s: s, ok: paid || trial };
}
function accDash(flash) {
  var r = accRoot(); if (!r) return;
  var st = subState();
  var chip = st.paid ? '<span class="pill ok">Acceso hasta el ' + fmtD(st.s.pagado_hasta) + '</span>' : st.trial ? '<span class="pill ok">Prueba gratuita · ' + (st.left === 1 ? 'queda 1 día' : 'quedan ' + st.left + ' días') + '</span>' : '<span class="pill warn">Prueba terminada</span>';
  var nom = nombreGuardado();
  var head = '<section class="card"><div class="sec-h"><div><h2>' + esc(nom ? bonito(nom) : 'Mi puesto') + '</h2><p class="hint">' + (nom ? 'Mi puesto · ' : '') + esc(ACC.email()) + '</p></div>' + chip + '</div>' +
    (st.ok && !nom ? '<p class="hint" id="nom-box" style="margin-top:8px"><button class="linkbtn" type="button" id="b-nom">Mostrar mi nombre aquí</button> (se guarda solo en este dispositivo)</p>' : '') + msg(flash) + '</section>';
  if (!st.ok) return accPaywall(head);
  r.innerHTML = head + '<div class="card empty" role="status">Cargando tu posición…</div>';
  Promise.all([ACC.posicion(), ACC.historial()]).then(function (res) { A.pos = res[0]; A.hist = res[1]; if (A.sel >= A.pos.length) A.sel = 0; drawDash(head); },
    function (e) { if (e.sinAcceso) accPaywall(head); else accFatal(e); });
}
function accPaywall(head) {
  var r = accRoot(); if (!r) return;
  r.innerHTML = head + '<section class="card"><h2>Tu prueba gratuita ha terminado</h2><p style="margin-top:8px">Para seguir viendo tu posición, quién tienes delante y las ofertas cerca de ti, el área personal cuesta <b class="num">9,99 €</b> por curso, sin renovación automática.</p>' +
    '<div class="row" style="margin-top:12px"><button class="btn primary" type="button" disabled>Pagar 9,99 € · próximamente</button></div>' +
    '<p class="hint" style="margin-top:10px">Mientras tanto sigues teniendo gratis las ofertas, las zonas, los datos y el cálculo manual de tu posición.</p></section>' + accCard(true);
  bindAccCard();
}
function drawDash(head) {
  var r = accRoot(); if (!r) return;
  var rows = A.pos, lw = weeks.filter(function (w) { return w.filas != null; }).pop();
  if (!rows.length) {
    r.innerHTML = head + '<section class="card"><h3>No aparecemos en el último listado</h3><p style="margin-top:8px">Tu fila guardada no está en el último listado completo' + (lw ? ' (convocatoria ' + lw.c + '/2026)' : '') + '. Puede ser que tu cuerpo no tuviera ofertas esa semana, ya que el listado solo incluye los cuerpos con ofertas, o que hayas salido de la lista.</p></section>' + accCard(true);
    return bindAccCard();
  }
  var cur = rows[A.sel] || rows[0], S = { cu: cur.cuerpo, g: cur.grupo, pos: cur.posicion_en_grupo };
  var sel = '';
  var homes = D.pobs.map(function (p, i) { return { i: i, n: dpob(p) }; }).sort(function (a, b) { return a.n.localeCompare(b.n, 'es'); });
  var hist = A.hist.filter(function (x) { return x.cuerpo === cur.cuerpo; });
  var resumen = rows.map(function (x, i) {
    var inner = '<b>' + esc(cuNombre(x.cuerpo)) + ' · grupo ' + x.grupo + '</b><span>Puesto <b class="num">' + x.posicion_en_grupo.toLocaleString('es-ES') + '</b> de <span class="num">' + x.personas_en_grupo.toLocaleString('es-ES') + '</span> en tu grupo</span><span class="pill' + (x.estado === 'adjudicada' ? ' ok' : '') + '">' + esc(ESTADO[x.estado] || x.estado) + '</span>';
    return rows.length > 1 ? '<button type="button" class="mytop" data-sel="' + i + '" aria-pressed="' + (i === A.sel) + '">' + inner + '</button>' : '<div class="mytop">' + inner + '</div>';
  }).join('') + '<p class="muted" style="margin-top:10px" id="pob-box">Convocatoria <span class="num">' + cur.convocatoria + '/2026</span> · Población: <b>' + esc(C.home) + '</b> <button class="linkbtn" type="button" id="b-pob">Cambiar</button></p>';
  r.innerHTML = head.replace('</section>', '') + sel + resumen + '</section>' +
    '<section id="acc-out" style="display:grid;gap:22px"></section>' +
    '<section class="card"><h3>Tu evolución</h3><p class="hint">Tu puesto dentro de tu grupo en cada listado completo. Si cambias de grupo, el puesto se cuenta desde el principio del grupo nuevo.</p><div class="chart" id="histchart" style="margin-top:8px"></div>' +
    '<div class="legend" style="margin-top:6px"><span><i class="sw" style="background:var(--c-none);border-radius:50%"></i>No pides ofertas</span><span><i class="sw" style="background:var(--c-vac);border-radius:50%"></i>Pides y no te toca</span><span><i class="sw" style="background:var(--c-ref);border-radius:50%"></i>Adjudicada</span></div>' +
    tableToggle('tbl-hist', ['Convocatoria', 'Fecha', 'Grupo', 'Puesto en el grupo', 'Estado'], hist.map(function (x) { return [x.convocatoria + '/2026', fmtD(x.fecha), x.grupo, x.posicion_en_grupo, ESTADO[x.estado] || x.estado]; })) + '</section>' +
    '<section class="card"><div class="sec-h"><h3>Alertas</h3><span class="pill">Próximamente</span></div><p class="hint">Avisos por correo, para no tener que entrar cada semana.</p>' +
    '<label class="alrt"><input type="checkbox" checked disabled> Ofertas nuevas en mis poblaciones y mi cuerpo, cuando se publica el listado del viernes.</label>' +
    '<label class="alrt"><input type="checkbox" checked disabled> Aviso cuando el último corte se acerque a mi puesto.</label></section>' +
    '<section class="card"><h3>Mis cuerpos</h3><div class="row" style="margin-top:8px">' + (A.me.listas || []).map(function (l) { return '<span class="pill ok">' + esc(cuNombre(l.cuerpo)) + '</span>'; }).join('') + '</div><p class="hint" style="margin-top:10px">El listado solo incluye los cuerpos que tienen ofertas cada semana. Si estás en alguno más que aún no sale, pulsa el botón: buscamos tu nombre otra vez, sin que tengas que escribirlo.</p><div class="row" style="margin-top:10px"><button class="btn small" type="button" id="b-add">Buscar mis otros cuerpos</button></div><div id="add-msg" style="margin-top:10px"></div></section>' +
    accCard(true);
  $('#b-add').addEventListener('click', function () {
    var b = this; b.disabled = true; b.textContent = 'Buscando…'; $('#add-msg').innerHTML = '';
    ACC.anadirCuerpos().then(function (rows) {
      if (rows && rows.length) { accLoad({ ok: 'Hemos añadido: ' + rows.map(function (x) { return cuNombre(typeof x === 'string' ? x : x.cuerpo_nuevo); }).join(', ') + '.' }); return; }
      b.disabled = false; b.textContent = 'Buscar mis otros cuerpos';
      $('#add-msg').innerHTML = '<div class="msg">No hemos encontrado tu nombre en ningún otro cuerpo del último listado' + (lw ? ' (convocatoria ' + lw.c + '/2026)' : '') + '. Solo salen los cuerpos que tienen ofertas esa semana: vuelve a probar cuando se publique el siguiente.</div>';
    }, function (e) { b.disabled = false; b.textContent = 'Buscar mis otros cuerpos'; $('#add-msg').innerHTML = msg({ err: e.message }); });
  });
  $$('button[data-sel]', r).forEach(function (b) { b.addEventListener('click', function () { A.sel = +b.dataset.sel; drawDash(head); }); });
  $('#b-pob').addEventListener('click', function () {
    $('#pob-box').innerHTML = '<label class="muted" for="c-home">Población:</label> <select class="input" id="c-home" style="max-width:260px;display:inline-block;margin-left:6px">' + homes.map(function (h) { return '<option value="' + esc(h.n) + '"' + (h.n === C.home ? ' selected' : '') + '>' + esc(h.n) + '</option>'; }).join('') + '</select>';
    var sl = $('#c-home'); sl.focus();
    sl.addEventListener('change', function (e) { C.home = e.target.value; store.set('acc', C); onProfile(); drawDash(head); });
  });
  var bn = $('#b-nom');
  if (bn) bn.addEventListener('click', function () {
    $('#nom-box').innerHTML = '<span class="row"><input class="input" id="nom-in" type="text" autocomplete="name" placeholder="Tu nombre y apellidos" style="max-width:320px"><button class="btn small primary" type="button" id="nom-ok">Guardar</button></span><br><span class="hint">Solo se guarda en este navegador. Nuestro servidor no lo recibe.</span>';
    var inp = $('#nom-in'); inp.focus();
    function ok() { if (inp.value.trim().length < 3) return; guardaNombre(inp.value); accDash(); }
    $('#nom-ok').addEventListener('click', ok); inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
  });
  bindTables(r); bindAccCard();
  renderCuenta($('#acc-out'), S);
  histChart($('#histchart'), hist);
}
function histChart(host, rows) {
  if (!host) return;
  if (rows.length < 2) { host.innerHTML = '<p class="hint">Todavía hay pocos listados con tu fila. Con cada semana nueva se irá dibujando aquí.</p>'; return; }
  var col = { no_pide: 'var(--c-none)', pide_sin_plaza: 'var(--c-vac)', adjudicada: 'var(--c-ref)', adjudicada_otro_cuerpo: 'var(--c-ref)' };
  function draw() {
    if (!host.isConnected) return;
    var Wd = Math.max(260, host.clientWidth), H = 220, m = { l: 44, r: 10, t: 12, b: 26 }, iw = Wd - m.l - m.r, ih = H - m.t - m.b;
    var top = Math.max(10, Math.max.apply(null, rows.map(function (x) { return x.posicion_en_grupo; }))), nm = nice(top), n = rows.length, st = iw / n;
    var y = function (v) { return m.t + ih - (v / nm.m) * ih; }, xs = function (i) { return m.l + st * i + st / 2; };
    var s = '<svg viewBox="0 0 ' + Wd + ' ' + H + '" role="img" aria-label="Tu puesto dentro del grupo en cada listado">';
    for (var v = 0; v <= nm.m; v += nm.t) s += '<line x1="' + m.l + '" x2="' + (Wd - m.r) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)"/><text x="' + (m.l - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v + '</text>';
    s += '<polyline fill="none" stroke="var(--c-none)" stroke-width="2" points="' + rows.map(function (x, i) { return xs(i).toFixed(1) + ',' + y(x.posicion_en_grupo).toFixed(1); }).join(' ') + '"/>';
    rows.forEach(function (x, i) {
      var lb = ((n - 1 - i) % Math.ceil(n / 8) === 0) ? x.convocatoria : '';
      if (lb !== '') s += '<text x="' + xs(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + lb + '</text>';
      s += '<circle cx="' + xs(i).toFixed(1) + '" cy="' + y(x.posicion_en_grupo).toFixed(1) + '" r="5" style="fill:' + (col[x.estado] || 'var(--c-none)') + '" stroke="var(--surface)" stroke-width="2"/>';
      s += '<rect class="hit" data-i="' + i + '" x="' + (m.l + st * i).toFixed(1) + '" y="' + m.t + '" width="' + st.toFixed(1) + '" height="' + ih + '" fill="transparent"/>';
    });
    host.innerHTML = s + '</svg>';
    $$('.hit', host).forEach(function (el) {
      var x = rows[+el.dataset.i], go = function (e) { showTip('<b>Conv. ' + x.convocatoria + '/2026</b>' + tipRows([['Grupo', x.grupo], ['Puesto en el grupo', x.posicion_en_grupo], ['Estado', esc(ESTADO[x.estado] || x.estado)]]), e.clientX, e.clientY); };
      el.addEventListener('pointermove', go); el.addEventListener('pointerdown', go); el.addEventListener('pointerleave', hideTip);
    });
  }
  draw(); redraws.push(draw);
}

/* ---- Datos ---- */
function viewDatos() {
  var tot = weeks.reduce(function (s, w) { return s + w.of; }, 0), cubW = weeks.filter(function (w) { return w.adjPdf || w.adj != null; });
  var totAdj = cubW.reduce(function (s, w) { return s + w.adj; }, 0), totOfC = cubW.reduce(function (s, w) { return s + w.of; }, 0);
  var vac = weeks.reduce(function (s, w) { return s + w.v; }, 0), sus = weeks.reduce(function (s, w) { return s + w.s; }, 0), ref = weeks.reduce(function (s, w) { return s + w.r; }, 0);
  var cuCnt = [0, 0, 0, 0, 0, 0, 0]; offers.forEach(function (o) { cuCnt[o.cu]++; });
  var provCnt = { Alicante: 0, Castellón: 0, Valencia: 0 }; offers.forEach(function (o) { if (provCnt[o.prov] != null) provCnt[o.prov]++; });
  var hb = function (name, v, max, color, extra) { return '<div class="hbar"><span>' + name + '</span><div class="tr"><i style="width:' + Math.max(0, 100 * v / max) + '%;background:' + color + '"></i></div><b class="num">' + extra + '</b></div>'; };
  var sinPdf = weeks.filter(function (w) { return w.adj != null; });
  return '<section class="card"><h2>Los datos de la bolsa</h2><p class="hint">Convocatorias 1 a ' + last.c + '/2026 (14 ene a ' + fmtD(last.f) + '). Todo sale de los PDF oficiales y está agregado: no hay nombres ni DNI.</p>' +
    '<div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))"><div class="kpi"><b class="num">' + tot.toLocaleString('es-ES') + '</b><span>ofertas publicadas</span></div><div class="kpi"><b class="num">' + pct(totAdj, totOfC) + ' %</b><span>cubiertas (semanas con adjudicación)</span></div><div class="kpi"><b class="num">' + Math.round(tot / weeks.length) + '</b><span>ofertas por semana de media</span></div><div class="kpi"><b class="num">' + pct(sus, tot) + ' %</b><span>son sustituciones</span></div></div></section>' +
    '<section class="card"><h3>Ofertas por semana y tipo</h3><p class="hint">Cada barra es una convocatoria. Toca o pasa el ratón para ver el detalle.</p><div class="chart" id="ch1" style="margin-top:10px"></div>' + legend(TIP.map(function (t) { return { n: t.n, c: t.v }; })) +
    tableToggle('tbl1', ['Conv.', 'Fecha', 'Vacantes', 'Sustituciones', 'Refuerzos', 'Total'], weeks.map(function (w) { return [w.c + '/2026', fmtD(w.f), w.v, w.s, w.r, w.of]; })) + '</section>' +
    '<section class="card"><h3>Ofertas cubiertas y sin cubrir</h3><p class="hint">Sin cubrir son las ofertas que no acabaron adjudicadas. Se disparan entre las semanas 16 y 21 y casi desaparecen desde la 22, cuando las listas crecieron. Faltan las semanas 1 a 3, y en la 19 solo se conoce el total del listado completo.</p><div class="chart" id="ch2" style="margin-top:10px"></div>' + legend([{ n: 'Adjudicadas', c: '--brand' }, { n: 'Sin cubrir', c: '--c-none' }]) +
    tableToggle('tbl2', ['Conv.', 'Ofertas', 'Adjudicadas', 'Sin cubrir'], sinPdf.map(function (w) { return [w.c + '/2026', w.of, w.adj, w.of - w.adj]; })) + '</section>' +
    '<section class="grid2"><div class="card"><h3>Personas que piden ofertas cada semana</h3><p class="hint">Personas de las listas que han enviado peticiones esa semana, hayan conseguido plaza o no. El salto de la semana 22 coincide con el crecimiento de las listas.</p><div class="chart" id="ch3" style="margin-top:10px"></div>' +
    tableToggle('tbl3', ['Conv.', 'Filas en las listas', 'Piden ofertas'], weeks.filter(function (w) { return w.part != null; }).map(function (w) { return [w.c + '/2026', w.filas, w.part]; })) + '</div>' +
    '<div class="card"><h3>Qué pasa después de una adjudicación</h3><p class="hint">De ' + STATS.casos + ' adjudicaciones seguidas (convocatorias 18 a 34), ' + STATS.salen + ' salen de las listas a las dos semanas. Estos son los que vuelven a aparecer después.</p><div style="margin-top:10px">' +
    STATS.tipos.map(function (t) { return hb('<i class="dot d-' + TIP[t.i].cls + '" style="margin-right:6px"></i>' + TIP[t.i].n, t.v, t.n, 'var(' + TIP[t.i].v + ')', pct(t.v, t.n) + ' %'); }).join('') + '</div>' +
    '<p class="hint" style="margin-top:6px">Vuelven, por tipo de plaza que tomaron. Los refuerzos aún siguen vigentes, así que todavía no han vuelto.</p>' +
    '<p style="margin-top:10px"><b>' + STATS.g34aG2 + ' de ' + STATS.g34 + '</b> personas que venían del grupo 3 o 4 reaparecen en el <b>grupo 2</b>, el de interinos.</p></div></section>' +
    '<section class="card"><h3>¿Por qué piden ofertas tan pocas personas?</h3>' +
    '<p style="margin-top:6px">En 15 semanas (de la 22 a la 36), solo ha pedido alguna oferta el <b>' + pct(STATS.pidenAlguna, STATS.personas) + ' %</b> de las personas de las listas (' + STATS.pidenAlguna + ' de ' + STATS.personas.toLocaleString('es-ES') + '). ' + STATS.regulares + ' lo hicieron en 8 semanas o más: cada semana piden casi siempre las mismas personas.</p>' +
    '<h3 style="font-size:15px;margin-top:16px">Ofertas de Tramitación que quedaron sin cubrir</h3><p class="hint">Semanas 16 a 21 (sin la 19), cuando pedían ofertas pocas personas: entre 9 y 37 por semana. Poblaciones con 5 ofertas o más.</p><div style="margin-top:8px">' +
    (function () {
      var t = {}; offers.forEach(function (o) { if (o.cu !== 0 || [16, 17, 18, 20, 21].indexOf(o.c) < 0) return; var z = t[o.pob] || (t[o.pob] = { n: 0, u: 0 }); z.n++; if (o.a === 0) z.u++; });
      return Object.keys(t).filter(function (k) { return t[k].n >= 5; }).sort(function (a, b) { return t[b].u / t[b].n - t[a].u / t[a].n; }).map(function (k) { return hb(esc(k), t[k].u, t[k].n, 'var(--c-sus)', t[k].u + '/' + t[k].n); }).join('');
    })() + '</div>' +
    '<p style="margin-top:12px">Quedaron sin cubrir sobre todo las poblaciones alejadas de las grandes ciudades. Desde la semana 22 piden ofertas más personas y casi todo se cubre, también lo lejano. Parece que mucha gente solo pide ofertas cerca de donde vive, aunque el listado no dice dónde vive cada persona.</p>' +
    '<p class="hint" style="margin-top:6px">Los datos no permiten saber cuántas personas ya trabajan en otro sitio, no tienen interés o no tienen certificado digital. Tampoco explican por qué subió tanto la participación en la semana 22.</p></section>' +
    '<section class="grid2"><div class="card"><h3>Ofertas por cuerpo</h3><div style="margin-top:8px">' + [0, 1, 2, 3].map(function (i) { return hb(CUN[i], cuCnt[i], Math.max.apply(null, cuCnt), 'var(--brand)', cuCnt[i]); }).join('') + '</div></div>' +
    '<div class="card"><h3>Ofertas por provincia</h3><div style="margin-top:8px">' + PROVS.map(function (p) { return hb(p, provCnt[p], Math.max(provCnt.Alicante, provCnt.Castellón, provCnt.Valencia), 'var(--brand)', provCnt[p]); }).join('') + '</div>' + (function () { var n = offers.filter(function (o) { return o.prov === 'Sin provincia'; }).length; return n ? '<p class="hint" style="margin-top:6px">' + (n === 1 ? 'La provincia de 1 oferta no se ha podido determinar.' : 'La provincia de ' + n + ' ofertas no se ha podido determinar.') + '</p>' : ''; })() + '</div></section>';
}
function afterDatos() {
  var v = $('#view');
  stackChart($('#ch1'), { data: weeks, label: 'Ofertas por semana y tipo', series: [{ c: '--c-vac', v: function (w) { return w.v; } }, { c: '--c-sus', v: function (w) { return w.s; } }, { c: '--c-ref', v: function (w) { return w.r; } }], xl: function (i, w) { return (w.c === 1 || w.c % 5 === 0) ? w.c : ''; }, tip: function (w) { return '<b>Conv. ' + w.c + '/2026</b><div>' + fmtD(w.f) + '</div>' + tipRows([['Vacantes', w.v], ['Sustituciones', w.s], ['Refuerzos', w.r], ['Total', w.of]]); } });
  var sd = weeks.filter(function (w) { return w.adj != null; });
  stackChart($('#ch2'), { data: sd, label: 'Ofertas adjudicadas y sin cubrir por semana', series: [{ c: '--brand', v: function (w) { return w.adj; } }, { c: '--c-none', v: function (w) { return Math.max(0, w.of - w.adj); } }], xl: function (i, w) { return (w.c % 5 === 0) ? w.c : ''; }, tip: function (w) { return '<b>Conv. ' + w.c + '/2026</b><div>' + fmtD(w.f) + '</div>' + tipRows([['Adjudicadas', w.adj], ['Sin cubrir', Math.max(0, w.of - w.adj)], ['Ofertas', w.of]]); } });
  var pd = weeks.filter(function (w) { return w.part != null; });
  stackChart($('#ch3'), { data: pd, label: 'Personas que piden ofertas por semana', series: [{ c: '--brand', v: function (w) { return w.part; } }], xl: function (i, w) { return (w.c % 3 === 0) ? w.c : ''; }, tip: function (w) { return '<b>Conv. ' + w.c + '/2026</b>' + tipRows([['Piden ofertas', w.part], ['Filas en las listas', w.filas]]); } });
  bindTables(v);
}

/* ---- Guía ---- */
var speaking = false, spRun = 0;
function spoken(t) { return t.replace(/(\d)\.(\d{3})/g, '$1$2').replace(/(\d{1,2}):00/g, '$1 horas').replace(/(\d{1,2}):(\d{2})/g, '$1 y $2').replace(/(\d+)\/(\d{4})/g, '$1 de $2').replace(/(\d+)\s?%/g, '$1 por ciento'); }
function stopSpeech() { spRun++; try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {} speaking = false; var b = $('#listen'); if (b) b.textContent = 'Escuchar el resumen'; }
function startSpeech(texts) {
  if (!window.speechSynthesis) return false;
  stopSpeech(); var run = ++spRun; speaking = true; var b = $('#listen'); if (b) b.textContent = 'Parar';
  var v = speechSynthesis.getVoices().filter(function (x) { return /^es/i.test(x.lang); }).sort(function (a, b) { var f = function (x) { return (/^es[-_]ES/i.test(x.lang) ? 4 : 0) + (/natural|online|neural/i.test(x.name) ? 3 : 0) + (/google/i.test(x.name) ? 1 : 0); }; return f(b) - f(a); })[0];
  var sents = texts.join(' ').replace(/([.!?])\s+/g, '$1\u0001').split('\u0001'), i = 0;
  (function next() {
    if (run !== spRun) return;
    if (i >= sents.length) { stopSpeech(); return; }
    var u = new SpeechSynthesisUtterance(spoken(sents[i++])); u.lang = 'es-ES'; if (v) u.voice = v;
    u.onend = next; u.onerror = function () { if (run === spRun) stopSpeech(); };
    speechSynthesis.speak(u);
  })();
  return true;
}
function viewGuia() {
  var A = function (t, body, open) { return '<details class="acc"' + (open ? ' open' : '') + '><summary>' + t + '</summary><div class="body">' + body + '</div></details>'; };
  return '<section class="card"><div class="sec-h"><div><h2>Cómo funciona la bolsa</h2><p class="hint">Seis minutos de lectura, o unos cuatro de audio.</p></div><button class="btn" id="listen" type="button">Escuchar el resumen</button></div></section>' +
    '<section>' +
    A('Qué es la bolsa', '<p>La bolsa de Justicia no es una convocatoria que reparta plazas de golpe. Es una lista permanente de personas, una por cada cuerpo, de la que la Conselleria va ofreciendo puestos temporales cada semana. Está regulada por la Orden 30/2025, de 1 de agosto. Las listas se formaron una sola vez, con carácter definitivo el 14 de noviembre de 2025. La norma prevé una nueva edición con baremo cada dos años; la primera tocaría hacia agosto de 2026 y no tengo confirmación de que se haya convocado.</p>', true) +
    A('Los cuatro grupos', '<p>Dentro de cada cuerpo, la lista tiene cuatro grupos, y va en este orden. El grupo 1, por baremo de méritos. El grupo 2, personas que ya han trabajado como interinas, ordenadas por la fecha de su primera toma de posesión. El grupo 3, quienes aprobaron al menos el primer ejercicio de una oposición en los últimos cinco años, con los más recientes primero. Y el grupo 4, una reserva para quienes alcanzaron al menos el 30 % de la nota del primer ejercicio.</p>') +
    A('El ciclo de cada semana', '<p>Cada semana se repite el mismo ciclo. El viernes por la tarde se publica el listado provisional de ofertas. Desde el lunes a las 10:00 hasta el martes a las 9:59, quien quiere participar pide los puestos en la aplicación Némesis, con certificado digital, y los ordena por preferencia. El martes se adjudica según el orden de la lista y se publican los puestos adjudicados y el listado completo. Hay pausas por Semana Santa, a principios de mayo y casi todo agosto, y no existe un calendario oficial por adelantado.</p>') +
    A('Tres tipos de oferta', '<p>La vacante dura hasta que la cubra personal de carrera, con un máximo de tres años. La sustitución temporal dura mientras la persona titular no vuelve, por enfermedad, comisión de servicios, maternidad y casos parecidos. Y el refuerzo tiene una fecha de fin, con posibles prórrogas. En las últimas semanas ha habido entre 20 y 50 ofertas cada semana, normalmente con más sustituciones que vacantes.</p>') +
    A('Después de la adjudicación', '<p>Si te adjudican un puesto, unas dos semanas después sales de las listas. Es lo que ocurre en prácticamente todos los casos que se han podido seguir. Algunas personas vuelven: ya han reaparecido el 24 % de quienes tomaron una sustitución, el 8 % de quienes tomaron una vacante y ninguna de las personas con refuerzo, porque casi todos los refuerzos siguen en vigor. La mayoría de quienes venían del grupo 3 o del grupo 4 reaparece en el grupo 2, el de interinos, no en su grupo de origen.</p>') +
    A('Cómo leer esta web', '<p>Las listas oficiales no numeran las filas. Esta web cuenta la posición de cada persona dentro de su cuerpo y su grupo en el listado completo de cada semana, y calcula el corte: la última posición de ese grupo que obtuvo plaza. Es un dato real pero no una promesa. Las listas cambian cada semana, entran y salen personas sin que haya una edición nueva, y aquí no se sabe cuántas ofertas encajan con tu zona o con tu cuerpo.</p>') +
    A('Fuentes y límites', '<p>Los datos salen de los PDF oficiales publicados por la Conselleria de Justicia en su web de adjudicación de ofertas de empleo temporal. Esta es una web independiente y no oficial, y no sustituye a la información oficial. Todo está agregado: no se publican nombres, DNI ni datos personales. Si ves un error, contrasta siempre con el PDF original.</p>') +
    '</section>' +
    '<section class="card"><div class="sec-h"><h2>Área personal</h2><span class="pill">Vista previa</span></div><p class="hint">Consultar ofertas, zonas y datos es gratis. El área personal se prueba 7 días gratis y después cuesta 9,99 € por curso, sin renovación automática.</p><div class="row" style="margin-top:12px"><a class="btn primary" href="#cuenta">Ver cómo será</a></div></section>';
}
function afterGuia() {
  $('#listen').addEventListener('click', function () {
    if (speaking) { stopSpeech(); return; }
    var texts = $$('.acc .body').map(function (b) { return b.textContent; }).slice(0, 5);
    if (!startSpeech(texts)) { $('#listen').textContent = 'Tu navegador no tiene voz'; }
  });
}

/* ---------- router ---------- */
var ROUTES = { cuenta: [viewCuenta, afterCuenta], inicio: [viewInicio, afterInicio], ofertas: [viewOfertas, afterOfertas], zonas: [viewZonas, afterZonas], 'mi-posicion': [viewPos, afterPos], datos: [viewDatos, afterDatos], guia: [viewGuia, afterGuia] };
function render() {
  var h = (location.hash || '#inicio').slice(1); if (!ROUTES[h]) h = 'inicio';
  hideTip(); stopSpeech(); redraws.length = 0;
  $('#view').innerHTML = (NOTE ? '<div class="callout note-top" role="status">' + esc(NOTE) + '</div>' : '') + ROUTES[h][0]();
  var ac = $('#acct'); if (h === 'cuenta') ac.setAttribute('aria-current', 'page'); else ac.removeAttribute('aria-current');
  $$('.tab').forEach(function (t) { if (t.dataset.r === h) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
  ROUTES[h][1]();
}
var lastRoute = '';
window.addEventListener('hashchange', function () { render(); if ((location.hash || '#inicio') !== lastRoute) window.scrollTo(0, 0); lastRoute = location.hash || '#inicio'; });
window.addEventListener('resize', debounce(function () { redraws.forEach(function (f) { f(); }); }, 120));
window.addEventListener('pagehide', stopSpeech);

/* tema */
function applyTheme(t) { if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); }
var theme = store.get('theme', 'system'); applyTheme(theme);
$('#theme').addEventListener('click', function () {
  var dark = document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
  theme = dark ? 'light' : 'dark'; store.set('theme', theme); applyTheme(theme);
});
$('#foot').innerHTML = 'JusticiaCV es una web independiente y no oficial. Los datos proceden de los listados publicados por la Conselleria de Justicia (convocatorias 1 a ' + last.c + '/2026, hasta el ' + fmtD(last.f) + ') y se muestran agregados, sin nombres ni DNI. No sustituyen a la información oficial: contrasta siempre con el PDF original.';
lastRoute = location.hash || '#inicio';
render();
})();
