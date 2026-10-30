/* JusticiaCV · lectura de los 3 PDF semanales de Justicia en el propio navegador (y en Node, para las pruebas).
   Es la misma lógica que importar_semana.py (que se conserva como alternativa), sobre el texto que da pdf.js.
   Los nombres de las personas solo existen en memoria mientras se lee el PDF: nada se guarda ni se muestra. */

export const VERSION = '1.0';

/* ---------------- texto ---------------- */
export const ws = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
export const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/\p{Mn}/gu, '');
export const mayus = (s) => sinAcentos(s).toUpperCase().replace(/\s+/g, ' ').trim();
export const miles = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const FIX = { 'Castelló': 'Castelló de la Plana/Castellón de la Plana', 'Borriana/Burrian a': 'Borriana/Burriana', 'Monòver/Monóva r': 'Monòver/Monóvar',
  'Nàquera/Náquer a': 'Nàquera/Náquera', 'Peníscola/Peñísc ola': 'Peníscola/Peñíscola' };
export function pob(p) { p = ws(p); return Object.prototype.hasOwnProperty.call(FIX, p) ? FIX[p] : p; }

export function cuerpo(d) {
  d = ws(d).toLowerCase();
  const tabla = [['tramitaci', 'TPA'], ['gesti', 'GPA'], ['auxilio', 'AJ'], ['médic', 'MF'], ['medic', 'MF'], ['facultativ', 'FE'], ['ayudante', 'AL']];
  for (const [k, c] of tabla) if (d.startsWith(k)) return c;
  return 'OTRO';
}

const UP = new Set(['S.C.', 'TSJ', 'IML', 'UVFI', 'SCT', 'SCG', 'SCEJ', 'TI', 'GU', 'II', 'VSM', 'RPT', 'NOJ', 'PPT', 'CS', 'JVM', 'TPA', 'GPA']);
const SMALL = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'en', 'a', 'al', 'l', 'd']);
const cap1 = (x) => x.slice(0, 1).toUpperCase() + x.slice(1);
const pal = (w) => new RegExp('(?<![\\p{L}\\p{N}_])' + w + '(?![\\p{L}\\p{N}_])', 'gu');   // \b de Python (con acentos)
export function pretty(s) {
  s = ws(s);
  const out = [];
  s.split(' ').forEach((t, i) => {
    if (UP.has(t.toUpperCase()) || t.toUpperCase().startsWith('S.C.')) { out.push(t.toUpperCase().replace('S.C.', 'S.C. ').trim()); return; }
    const low = t.toLowerCase();
    if (i > 0 && SMALL.has(low)) { out.push(low); return; }
    out.push(low.includes('-') ? low.split('-').map(cap1).join('-') : cap1(low));
  });
  let r = out.join(' ').replace(/  /g, ' ');
  r = r.replace(pal('Fiscalia'), 'Fiscalía').replace(pal('Area'), 'Área').replace(pal('Denia'), 'Dénia')
       .replace(pal('Seccion'), 'Sección').replace(pal('Lliria'), 'Llíria');
  r = r.replace(/\/([a-zà-ÿ])/g, (m, c) => '/' + c.toUpperCase());
  return r;
}

const TIPO = { 'vacante': 'vacante', 'sustitucion temporal': 'sustitucion', 'refuerzo': 'refuerzo' };
export const CUERPOS = ['TPA', 'GPA', 'AJ', 'MF', 'FE', 'AL'];
const PROVINCIA_PDF = { alicante: 'Alicante', alacant: 'Alicante', valencia: 'Valencia', 'valència': 'Valencia',
  castellon: 'Castellón', 'castelló': 'Castellón', 'castellón': 'Castellón' };
export const NOMBRE_TIPO = { ofertas: 'listado definitivo de ofertas', adjudicados: 'puestos adjudicados', completo: 'listado completo de adjudicaciones' };

/* ---------------- extracción con pdf.js ---------------- */
/* Coordenadas de "ventana" de la página (x hacia la derecha, y hacia abajo), también en páginas giradas. */
function aVentana(vt, x, y) { return [vt[0] * x + vt[2] * y + vt[4], vt[1] * x + vt[3] * y + vt[5]]; }

export async function itemsPagina(page) {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const out = [];
  for (const it of tc.items) {
    if (typeof it.str !== 'string' || !it.str.trim()) continue;
    const [x, y] = aVentana(vp.transform, it.transform[4], it.transform[5]);
    out.push({ s: it.str, x, y, w: it.width, h: it.height || 8 });
  }
  return { items: out, vp };
}

/* Agrupa los trozos de texto en líneas (misma y) y los une en orden de x. */
export function lineasDe(items, tolY = 2) {
  const orden = items.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const filas = [];
  for (const it of orden) {
    const f = filas.length ? filas[filas.length - 1] : null;
    if (f && Math.abs(f.y - it.y) <= tolY) { f.it.push(it); } else filas.push({ y: it.y, it: [it] });
  }
  return filas.map((f) => {
    f.it.sort((a, b) => a.x - b.x);
    let s = '', fin = null;
    for (const it of f.it) {
      if (fin !== null && it.x - fin > Math.max(0.6, it.h * 0.12)) s += ' ';
      s += it.s;
      fin = it.x + it.w;
    }
    return { y: f.y, texto: ws(s), x: f.it[0].x, it: f.it };
  });
}

/* Segmentos horizontales y verticales dibujados en la página (los bordes de la tabla de ofertas). */
export async function reglasPagina(pdfjs, page) {
  const OPS = pdfjs.OPS, vp = page.getViewport({ scale: 1 }), vt = vp.transform;
  const ol = await page.getOperatorList();
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  let ctm = [1, 0, 0, 1, 0, 0];
  const pila = [], hs = [], vs = [];
  const segmento = (a, b) => {
    const p = aVentana(vt, ctm[0] * a[0] + ctm[2] * a[1] + ctm[4], ctm[1] * a[0] + ctm[3] * a[1] + ctm[5]);
    const q = aVentana(vt, ctm[0] * b[0] + ctm[2] * b[1] + ctm[4], ctm[1] * b[0] + ctm[3] * b[1] + ctm[5]);
    const dx = Math.abs(p[0] - q[0]), dy = Math.abs(p[1] - q[1]);
    if (dy < 0.6 && dx > 3) hs.push({ y: (p[1] + q[1]) / 2, a: Math.min(p[0], q[0]), b: Math.max(p[0], q[0]) });
    else if (dx < 0.6 && dy > 3) vs.push({ x: (p[0] + q[0]) / 2, a: Math.min(p[1], q[1]), b: Math.max(p[1], q[1]) });
  };
  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i], a = ol.argsArray[i];
    if (fn === OPS.save) pila.push(ctm);
    else if (fn === OPS.restore) { if (pila.length) ctm = pila.pop(); }
    else if (fn === OPS.transform) ctm = mul(ctm, a);
    else if (fn === OPS.constructPath) {
      const d = a[1] && a[1][0];
      if (!d) continue;
      let j = 0, ini = null, ult = null;
      while (j < d.length) {
        const op = d[j];
        if (op === 0) { ult = ini = [d[j + 1], d[j + 2]]; j += 3; }
        else if (op === 1) { const p = [d[j + 1], d[j + 2]]; if (ult) segmento(ult, p); ult = p; j += 3; }
        else if (op === 2) { ult = [d[j + 5], d[j + 6]]; j += 7; }
        else if (op === 3) { ult = [d[j + 3], d[j + 4]]; j += 5; }
        else if (op === 4) { if (ult && ini) segmento(ult, ini); ult = ini; j += 1; }
        else break;
      }
    }
  }
  return { hs, vs, w: vp.width, h: vp.height };
}

/* Valores casi iguales -> un solo valor (la media de cada grupo). */
function agrupar(vals, tol = 1.5) {
  const v = vals.slice().sort((a, b) => a - b), out = [];
  for (const x of v) {
    const g = out.length ? out[out.length - 1] : null;
    if (g && x - g.max <= tol) { g.max = x; g.suma += x; g.n++; } else out.push({ max: x, suma: x, n: 1 });
  }
  return out.map((g) => g.suma / g.n);
}

/* ---------------- tipo de PDF y cabecera ---------------- */
export function tipoDePdf(textoPag1) {
  const n = mayus(textoPag1);
  if (n.includes('LISTADO DEFINITIVO DE OFERTAS')) return 'ofertas';
  if (n.includes('ADJUDICACION OFERTAS DE EMPLEO TEMPORAL') || n.includes('CONVOCATORIA/CONVOCATORIA')) return 'completo';
  if (/\bDNI\b/.test(n) && n.includes('NOMBRE Y APELLIDOS')) return 'adjudicados';
  return null;
}

export function cabecera(txt) {
  const m = /CONVOCATORIA(?:\s*\/\s*CONVOCAT[OÒ]RIA)?\s+(\d{1,3})\s*\/\s*(\d{4})/i.exec(txt);
  if (!m) return [null, null, null];
  const f = /(\d{2})\/(\d{2})\/(\d{4})/.exec(txt.slice(m.index + m[0].length));
  return [parseInt(m[1], 10), parseInt(m[2], 10), f ? `${f[3]}-${f[2]}-${f[1]}` : null];
}

/* ---------------- ofertas (tabla con bordes) ---------------- */
const ALIAS = { 'cuerpo': 'denominacion', 'denominacion': 'denominacion', 'n puesto': 'n_puesto', 'nº puesto': 'n_puesto', 'centro destino': 'centro',
  'poblacion': 'poblacion', 'provincia': 'provincia', 'tipo de oferta': 'tipo', 'observaciones': 'observaciones' };
const normCab = (s) => ws(s).toLowerCase().replace(/ó/g, 'o').replace(/í/g, 'i');
const CAMPOS = ['n_puesto', 'denominacion', 'centro', 'poblacion', 'provincia', 'tipo', 'observaciones'];

/* Una página -> filas de celdas [[texto, texto, ...], ...] según los bordes dibujados. */
/* Largo total cubierto por los segmentos de cada línea; se queda con las que cubren al menos la mitad de la mejor
   (descarta rayitas sueltas) y se salta el marco de la propia página. */
function lineasBuenas(segs, pos, ini, fin, limite, tol = 1.5) {
  const grupos = [];
  for (const sg of segs.filter((q) => q[pos] > 0.7 && q[pos] < limite - 0.7).sort((a, b) => a[pos] - b[pos])) {
    const g = grupos.length ? grupos[grupos.length - 1] : null;
    if (g && sg[pos] - g.max <= tol) { g.max = sg[pos]; g.suma += sg[pos]; g.n++; g.iv.push([sg[ini], sg[fin]]); } else grupos.push({ max: sg[pos], suma: sg[pos], n: 1, iv: [[sg[ini], sg[fin]]] });
  }
  for (const g of grupos) {
    g.iv.sort((a, b) => a[0] - b[0]);
    let tot = 0, f = -Infinity;
    for (const [a, b] of g.iv) { const i = Math.max(a, f); if (b > i) tot += b - i; f = Math.max(f, b); }
    g.cob = tot;
  }
  const mejor = Math.max(0, ...grupos.map((g) => g.cob));
  return grupos.filter((g) => g.cob >= mejor * 0.5).map((g) => g.suma / g.n);
}

export function celdasDePagina(items, reglas) {
  const ys = lineasBuenas(reglas.hs, 'y', 'a', 'b', reglas.h), xs = lineasBuenas(reglas.vs, 'x', 'a', 'b', reglas.w);
  if (ys.length < 2 || xs.length < 2) return [];
  // fila cortada por el final de la página: no tiene borde inferior, se cierra justo debajo de su último texto
  const centro = (it) => it.x + it.w / 2;
  const debajo = items.filter((it) => it.y - it.h * 0.3 > ys[ys.length - 1] + 0.5 && centro(it) > xs[0] && centro(it) < xs[xs.length - 1]);
  if (debajo.length) ys.push(Math.max(...debajo.map((it) => it.y)) + 3);
  const filas = [];
  for (let r = 0; r + 1 < ys.length; r++) filas.push({ y0: ys[r], y1: ys[r + 1], celdas: xs.slice(0, -1).map(() => []) });
  for (const it of items) {
    const cx = it.x + it.w / 2, cy = it.y - it.h * 0.3;   // centro del texto, a media altura de la letra
    const f = filas.find((fl) => cy >= fl.y0 - 0.5 && cy < fl.y1 + 0.5);
    if (!f) continue;
    let c = -1;
    for (let k = 0; k + 1 < xs.length; k++) if (cx >= xs[k] - 0.5 && cx < xs[k + 1] + 0.5) { c = k; break; }
    if (c < 0) continue;
    f.celdas[c].push(it);
  }
  return filas.map((f) => f.celdas.map((its) => lineasDe(its).map((l) => l.texto).join(' ')).map(ws));
}

export function leerOfertasDePaginas(paginas) {
  const filas = [];
  let cols = null;
  for (const pg of paginas) {
    for (const row of celdasDePagina(pg.items, pg.reglas)) {
      const nombres = row.map((x) => ALIAS[normCab(x)] || null);
      if (nombres.includes('n_puesto')) { cols = nombres; continue; }
      if (cols && row.length === cols.length) {
        const d = {};
        cols.forEach((k, i) => { if (k) d[k] = row[i]; });
        if (/^\d{5,8}$/.test(d.n_puesto || '')) {
          const f = {};
          for (const k of CAMPOS) f[k] = d[k] || '';
          filas.push(f);
        }
      }
    }
  }
  return filas;
}

export function normalizarOfertas(filas) {
  const out = [], prob = [], avisos = [];
  for (const r of filas) {
    const cu = cuerpo(r.denominacion);
    const tp = TIPO[mayus(r.tipo).toLowerCase()] || null;
    if (cu === 'OTRO') avisos.push(`cuerpo no reconocido «${r.denominacion}» (puesto ${r.n_puesto}): se guardará como OTRO`);
    if (tp === null) prob.push(`tipo de oferta desconocido «${r.tipo}» (puesto ${r.n_puesto})`);
    let prov = '';
    const pdfprov = sinAcentos(r.provincia || '').toLowerCase();
    for (const [k, v] of Object.entries(PROVINCIA_PDF)) if (pdfprov.startsWith(sinAcentos(k))) { prov = v; break; }
    out.push({ n_puesto: parseInt(r.n_puesto, 10), cuerpo: cu, centro: pretty(r.centro), poblacion: pob(r.poblacion), prov_pdf: prov, tipo: tp, observaciones: ws(r.observaciones) });
  }
  return { ofertas: out, prob, avisos };
}

/* ---------------- listado completo ---------------- */
const HDR = /^\s*(Auxilio Judicial|Tramitaci[oó]n Procesal y Administrativa|Gesti[oó]n Procesal y Administrativa|M[eé]dic[oa]s? Forenses?|Facultativ[oa]s? Especialistas?|Ayudantes? de Laboratorio)[^\n]*?\//;
const FILA = /^(\S.*?)\s+GRUPO\s+(\d+\w*)\s+(\S.*?)\s*$/;

export function estadoNorm(e) {
  e = ws(e);
  if (e.startsWith('NO PARTICIPA')) return ['no_pide', null];
  if (e.startsWith('PARTICIPA')) return ['pide_sin_plaza', null];
  if (e.includes('OTRO CUERPO') && e.startsWith('ADJUDICACI')) return ['adjudicada_otro_cuerpo', null];
  const m = /^ADJUDICACI\S*\s*-\s*PETICI\S*\s*(\d+)/.exec(e);
  if (m) return ['adjudicada', parseInt(m[1], 10)];
  return [null, null];
}

/* lineas: array de strings (todas las páginas, en orden). Devuelve {filas, raras}. */
export function leerCompletoDeLineas(lineas) {
  let cu = null;
  const cnt = {}, filas = [], raras = {};
  const rara = (k) => { raras[k] = (raras[k] || 0) + 1; };
  for (const ln of lineas) {
    if (HDR.test(ln)) { cu = cuerpo(HDR.exec(ln)[1]); continue; }
    const m = FILA.exec(ln.trim());
    if (!m) { if (/\bGRUPO\s+\d/.test(ln)) rara('línea con GRUPO que no se ha podido leer'); continue; }
    if (cu === null || cu === 'OTRO') { rara('fila antes de saber el cuerpo'); continue; }
    const [est, pet] = estadoNorm(m[3]);
    if (est === null) { rara('estado desconocido: ' + ws(m[3]).slice(0, 60)); continue; }
    cnt[cu] = (cnt[cu] || 0) + 1;
    filas.push({ cuerpo: cu, orden: cnt[cu], grupo: parseInt(/^\d+/.exec(m[2])[0], 10), estado: est, peticion: pet, nombre: ws(m[1]) });
  }
  return { filas, raras };
}

/* ---------------- puestos adjudicados ---------------- */
const PROV = '(Alicante/Alacant|Valencia/Val.ncia|Castell[oó]n/Castell[oó])';
const RX_A = new RegExp('^\\S+\\*+\\S*\\s+(?<name>[^\\d]+?)\\s*(?<g>\\d)\\s+(?:(?<cuerpo>TPA|GPA|AJ|MF|FE|AL)\\s+)?(?<puesto>\\d{5,8})\\s+(?<dest>.+?)(?:\\s{2,}(?<prov>' + PROV + '))?\\s*$');
const RX_B = new RegExp('^\\S+\\*+\\S*\\s+(?<name>[^\\d]+?)\\s*(?<puesto>\\d{5,8})\\s+(?<g>\\d)\\s+(?<dest>.+?)(?:\\s{2,}(?<prov>' + PROV + '))?\\s*$');

export class Parar extends Error {}

export function leerAdjudicadosDeLineas(lineasTodas) {
  const lineas = lineasTodas.map((l) => l.trim()).filter(Boolean);
  if (lineas.some((l) => /^\d{8}[A-Z]\s/.test(l)))
    throw new Parar('Este PDF de adjudicados lleva los DNI SIN enmascarar. No se procesa ni se guarda nada. Avisa para decidir qué hacer (lo normal es no usarlo y esperar a que lo corrijan).');
  const filas = [];
  let mal = 0, i = 0;
  const primero = (s) => s.split(' ')[0];
  while (i < lineas.length) {
    const s = lineas[i];
    i++;
    if (!primero(s).includes('*')) continue;
    let m = RX_A.exec(s) || RX_B.exec(s);
    if (!m && i < lineas.length && !primero(lineas[i]).includes('*')) {          // nombre partido en dos líneas
      const j = s + '   ' + lineas[i];
      m = RX_A.exec(j) || RX_B.exec(j);
      if (m) i++;
    }
    if (m) filas.push({ grupo: parseInt(m.groups.g, 10), cuerpo: m.groups.cuerpo || '', n_puesto: parseInt(m.groups.puesto, 10) });
    else mal++;
  }
  return { filas, mal };
}

/* =====================================================================
   Orquestación: de los PDF sueltos a «lo que se va a cargar»
   ===================================================================== */
async function sha256(data) {
  const h = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function lineasDeTodoElPdf(doc, progreso, etiqueta) {
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n);
    const { items } = await itemsPagina(pg);
    for (const l of lineasDe(items)) out.push(l.texto);
    pg.cleanup();
    if (n % 10 === 0 || n === doc.numPages) { progreso({ texto: etiqueta, hecho: n, total: doc.numPages }); await new Promise((r) => setTimeout(r, 0)); }
  }
  return out;
}

/* archivos: [{name, data: Uint8Array}]. Devuelve S con todo lo leído, y avisos/errores. Lanza Parar si no se puede ni empezar. */
export async function analizarArchivos(pdfjs, archivos, progreso = () => {}) {
  if (!archivos.length) throw new Parar('No has elegido ningún PDF.');
  const S = { avisos: [], errores: [], ignorados: [], archivos: {}, adj: null, adj_mal: 0, lista: null, raras: {}, nombres: {} };
  // 1. qué es cada PDF
  const por = {};
  const vistos = new Set();
  for (const a of archivos) {
    const h = await sha256(a.data);
    if (vistos.has(h)) continue;                                     // copias idénticas cuentan una vez
    vistos.add(h);
    let doc, txt1;
    try {
      doc = await pdfjs.getDocument({ data: a.data.slice(), isEvalSupported: false, verbosity: 0 }).promise;
      const { items } = await itemsPagina(await doc.getPage(1));
      txt1 = lineasDe(items).map((l) => l.texto).join('\n');
    } catch (e) { S.ignorados.push([a.name, 'no se puede leer como PDF']); continue; }
    const t = tipoDePdf(txt1);
    if (!t) { S.ignorados.push([a.name, 'no es ninguno de los 3 listados esperados']); continue; }
    (por[t] = por[t] || []).push({ name: a.name, doc, txt1 });
  }
  for (const [t, v] of Object.entries(por)) {
    if (v.length > 1) throw new Parar(`Hay ${v.length} PDF distintos de tipo «${NOMBRE_TIPO[t]}»: ${v.map((x) => x.name).join(', ')}. Deja solo el de esta semana.`);
    S.archivos[t] = v[0].name;
  }
  if (!por.ofertas) throw new Parar('Falta el PDF «listado definitivo de ofertas» (el 5.). Sin él no se puede cargar la semana.');

  // 2. cabeceras
  const cab = {};
  for (const t of ['ofertas', 'completo']) if (por[t]) cab[t] = cabecera(por[t][0].txt1);
  const nums = new Set(Object.values(cab).map((v) => v[0]).filter(Boolean));
  const anios = new Set(Object.values(cab).map((v) => v[1]).filter(Boolean));
  const fechas = new Set(Object.values(cab).map((v) => v[2]).filter(Boolean));
  if (nums.size > 1 || anios.size > 1)
    throw new Parar('Los PDF son de convocatorias distintas: ' + Object.entries(cab).map(([t, v]) => `${NOMBRE_TIPO[t]} = ${v[0]}/${v[1]}`).join(', ') + '. Deja solo los de la misma semana.');
  if (fechas.size > 1) S.avisos.push('Las fechas de las cabeceras no coinciden: ' + [...fechas].sort().join(', '));
  S.numero = nums.size ? [...nums][0] : null;
  S.anio = anios.size ? [...anios][0] : new Date().getFullYear();
  S.fecha = fechas.size ? [...fechas].sort()[0] : null;
  S.faltaNumero = S.numero === null;
  S.faltaFecha = S.fecha === null;
  // fecha de creación del PDF de ofertas (solo para avisar si no cuadra)
  try {
    const meta = await por.ofertas[0].doc.getMetadata();
    const m = /D:(\d{4})(\d{2})(\d{2})/.exec((meta.info && meta.info.CreationDate) || '');
    if (m && S.fecha) {
      const f1 = Date.parse(S.fecha), f2 = Date.parse(`${m[1]}-${m[2]}-${m[3]}`);
      if (Math.abs(f1 - f2) / 86400000 > 3) S.avisos.push(`La fecha de la cabecera (${S.fecha}) y la de creación del PDF (${m[1]}-${m[2]}-${m[3]}) difieren más de 3 días.`);
    }
  } catch (e) { /* sin metadatos: no pasa nada */ }

  // 3. ofertas
  progreso({ texto: 'Leyendo las ofertas…', hecho: 0, total: 1 });
  const docO = por.ofertas[0].doc, pags = [];
  for (let n = 1; n <= docO.numPages; n++) {
    const pg = await docO.getPage(n);
    const { items } = await itemsPagina(pg);
    pags.push({ items, reglas: await reglasPagina(pdfjs, pg) });
    pg.cleanup();
  }
  const no = normalizarOfertas(leerOfertasDePaginas(pags));
  S.ofertas = no.ofertas;
  S.errores.push(...no.prob);
  S.avisos.push(...no.avisos);
  if (!S.ofertas.length) S.errores.push('No se ha leído ninguna oferta del PDF de ofertas. ¿Ha cambiado el formato del PDF?');
  const cnt = new Map();
  for (const o of S.ofertas) cnt.set(o.n_puesto, (cnt.get(o.n_puesto) || 0) + 1);
  const dup = [...cnt].filter(([, v]) => v > 1).map(([k]) => k);
  if (dup.length) S.errores.push(`Números de puesto repetidos en las ofertas: ${dup.slice(0, 5).join(', ')}`);

  // 4. adjudicados
  if (por.adjudicados) {
    const lin = await lineasDeTodoElPdf(por.adjudicados[0].doc, progreso, 'Leyendo los puestos adjudicados…');
    const r = leerAdjudicadosDeLineas(lin);
    S.adj = r.filas; S.adj_mal = r.mal;
    const puestos = new Set(S.ofertas.map((o) => o.n_puesto));
    const c = new Map();
    for (const a of S.adj) c.set(a.n_puesto, (c.get(a.n_puesto) || 0) + 1);
    const rep = [...c.values()].filter((v) => v > 1).length;
    if (rep) {
      S.avisos.push(`${rep} puestos adjudicados aparecen más de una vez; se usa la primera aparición.`);
      const v = new Set();
      S.adj = S.adj.filter((a) => (v.has(a.n_puesto) ? false : (v.add(a.n_puesto), true)));
    }
    const fuera = S.adj.filter((a) => !puestos.has(a.n_puesto));
    if (S.adj_mal) S.avisos.push(`${S.adj_mal} líneas del PDF de adjudicados no se han podido leer.`);
    if (S.adj.length && fuera.length / S.adj.length > 0.05)
      S.errores.push(`El PDF de adjudicados no parece de esta semana: ${fuera.length} de ${S.adj.length} puestos no están en las ofertas de la convocatoria ${S.numero}.`);
    else if (fuera.length) S.avisos.push(`${fuera.length} puestos adjudicados no están en las ofertas de esta semana (se ignoran).`);
    if (!S.adj.length) S.errores.push('No se ha leído ningún puesto del PDF de adjudicados.');
    else if (S.adj.some((a) => ![1, 2, 3, 4].includes(a.grupo))) S.errores.push('Hay puestos adjudicados con un grupo que no es 1, 2, 3 ni 4.');
  } else S.avisos.push('No hay PDF de puestos adjudicados: la semana se cargará sin saber qué ofertas se cubrieron.');

  // 5. listado completo
  if (por.completo) {
    const lin = await lineasDeTodoElPdf(por.completo[0].doc, progreso, 'Leyendo el listado completo…');
    const r = leerCompletoDeLineas(lin);
    S.lista = r.filas; S.raras = r.raras;
    if (Object.keys(S.raras).length) S.errores.push('Líneas del listado completo que no se han entendido: ' + Object.entries(S.raras).map(([k, v]) => `${k} (${v})`).join('; '));
    if (!S.lista.length) S.errores.push('No se ha leído ninguna fila del listado completo.');
    else {
      const cuL = new Set(S.lista.map((f) => f.cuerpo)), cuO = new Set(S.ofertas.map((o) => o.cuerpo));
      if ([...cuL].sort().join() !== [...cuO].sort().join()) S.avisos.push(`Cuerpos con ofertas [${[...cuO].sort()}] y cuerpos en el listado [${[...cuL].sort()}] no coinciden.`);
      if (S.adj) {
        const nAdj = S.lista.filter((f) => f.estado === 'adjudicada').length;
        if (nAdj !== S.adj.length) S.avisos.push(`El listado completo marca ${nAdj} adjudicadas y el PDF de adjudicados tiene ${S.adj.length} puestos.`);
        const g1 = {}, g2 = {};
        S.lista.filter((f) => f.estado === 'adjudicada').forEach((f) => { g1[f.grupo] = (g1[f.grupo] || 0) + 1; });
        S.adj.forEach((a) => { g2[a.grupo] = (g2[a.grupo] || 0) + 1; });
        if (JSON.stringify(Object.entries(g1).sort()) !== JSON.stringify(Object.entries(g2).sort()))
          S.avisos.push(`Adjudicadas por grupo distintas: listado ${JSON.stringify(g1)} · adjudicados ${JSON.stringify(g2)}.`);
      }
      const malG = [...new Set(S.lista.filter((f) => ![1, 2, 3, 4].includes(f.grupo)).map((f) => f.grupo))];
      if (malG.length) S.errores.push('Hay filas del listado completo con un grupo que no es 1, 2, 3 ni 4: ' + malG.sort().join(', '));
      const sin = S.lista.filter((f) => !f.nombre).length;
      if (sin) S.errores.push(`${sin} filas del listado sin nombre.`);
    }
  } else S.avisos.push('No hay listado completo: no se actualizan las listas ni las posiciones de las personas.');
  progreso({ texto: 'Lectura terminada', hecho: 1, total: 1 });
  return S;
}

/* Compara lo leído con lo que ya hay en la base.
   base = {poblaciones:[{id,nombre,provincia}], convocatorias:[{id,anio,numero,fecha_publicacion,adjudicados_cargados,listado_cargado}], centros:[{nombre,poblacion_id}]} */
export function compararConBase(S, base) {
  const R = { avisos: [], errores: [], nuevasPoblaciones: [], ya: null, centrosNuevos: [] };
  const pobs = new Map(base.poblaciones.map((p) => [p.nombre, p]));
  const nuevas = [...new Set(S.ofertas.map((o) => o.poblacion))].filter((n) => !pobs.has(n)).sort();
  for (const n of nuevas) {
    const o = S.ofertas.find((x) => x.poblacion === n && x.prov_pdf);
    R.nuevasPoblaciones.push({ nombre: n, provincia: o ? o.prov_pdf : '' });
  }
  const convs = base.convocatorias;
  const ya = convs.find((c) => c.anio === S.anio && c.numero === S.numero) || null;
  const previas = convs.filter((c) => c.anio === S.anio && c.numero !== S.numero).sort((a, b) => a.numero - b.numero);
  const ultima = previas.length ? previas[previas.length - 1].numero : null;
  R.ya = ya;
  if (ya) {
    const que = ['ofertas'].concat(S.adj ? ['adjudicaciones'] : [], S.lista ? ['listas'] : []);
    R.avisos.push(`La convocatoria ${S.numero}/${S.anio} YA estaba cargada: se sustituirán sus ${que.slice(0, -1).join(', ')}${que.length > 1 ? ' y ' : ''}${que[que.length - 1]} por las de estos PDF.`);
    if (ya.fecha_publicacion !== S.fecha) R.avisos.push(`La fecha guardada (${ya.fecha_publicacion}) cambiará a ${S.fecha}.`);
  } else if (ultima !== null && S.numero !== ultima + 1) {
    R.avisos.push(S.numero > ultima + 1 ? `La última convocatoria cargada es la ${ultima} y ésta es la ${S.numero}: ¿falta alguna semana en medio?`
      : `Ya hay convocatorias posteriores (hasta la ${ultima}); ésta es la ${S.numero}.`);
  }
  if (!ya && previas.length) {
    const ant = previas.filter((c) => c.numero < S.numero).map((c) => c.fecha_publicacion).sort().pop();
    if (ant && S.fecha <= ant) R.avisos.push(`La fecha ${S.fecha} no es posterior a la de la convocatoria anterior (${ant}).`);
  }
  const conocidos = new Set(base.centros.map((c) => c.nombre + '|' + c.poblacion_id));
  const ids = new Map(base.poblaciones.map((p) => [p.nombre, p.id]));
  R.centrosNuevos = [...new Set(S.ofertas.filter((o) => ids.has(o.poblacion) && !conocidos.has(o.centro + '|' + ids.get(o.poblacion))).map((o) => `${o.centro} (${o.poblacion})`))].sort();
  return R;
}

/* Lo que se envía a admin_preparar_semana. poblacionesNuevas: [{nombre, nombre_visible, provincia, lat, lon}] */
export function construirPayload(S, poblacionesNuevas) {
  return {
    anio: S.anio, numero: S.numero, fecha: S.fecha, hay_lista: !!(S.lista && S.lista.length),
    poblaciones: poblacionesNuevas,
    ofertas: S.ofertas.map((o) => ({ n_puesto: o.n_puesto, cuerpo: o.cuerpo, centro: o.centro, poblacion: o.poblacion, tipo: o.tipo, observaciones: o.observaciones })),
    adjudicaciones: S.adj ? S.adj.map((a) => ({ n_puesto: a.n_puesto, grupo: a.grupo })) : null
  };
}

export function trozosDeLista(lista, n = 500) {
  const out = [];
  for (let i = 0; i < lista.length; i += n)
    out.push(lista.slice(i, i + n).map((f) => ({ cuerpo: f.cuerpo, orden: f.orden, grupo: f.grupo, estado: f.estado, peticion: f.peticion, nombre: f.nombre })));
  return out;
}

/* Lo que debería salir en el resumen del servidor tras cargar (ofertas que casan con una población y un centro conocidos). */
export function esperadoTrasCargar(S, adjuntosPrevios) {
  const puestos = new Set(S.ofertas.map((o) => o.n_puesto));
  const e = { ofertas: S.ofertas.length };
  if (S.adj) e.adjudicaciones = S.adj.filter((a) => puestos.has(a.n_puesto)).length;
  if (S.lista && S.lista.length) {
    e.lista_filas = S.lista.length; e.huellas = S.lista.length;
    e.cortes = new Set(S.lista.map((f) => f.cuerpo + '|' + f.grupo)).size;
  }
  return e;
}

/* Resúmenes legibles para la pantalla. */
export function resumenDe(S) {
  const cuentas = (arr, f) => { const m = {}; arr.forEach((x) => { const k = f(x); m[k] = (m[k] || 0) + 1; }); return m; };
  const r = { ofertas: S.ofertas.length, porCuerpo: cuentas(S.ofertas, (o) => o.cuerpo), porTipo: cuentas(S.ofertas, (o) => o.tipo) };
  if (S.adj) { r.adjudicados = S.adj.length; r.adjPorGrupo = cuentas(S.adj, (a) => a.grupo); }
  if (S.lista && S.lista.length) {
    r.lista = S.lista.length;
    r.listaPorCuerpo = {};
    for (const c of CUERPOS) {
      const fs = S.lista.filter((f) => f.cuerpo === c);
      if (fs.length) r.listaPorCuerpo[c] = { personas: fs.length, piden: fs.filter((f) => f.estado !== 'no_pide').length, adjudicadas: fs.filter((f) => f.estado === 'adjudicada').length };
    }
  }
  return r;
}
