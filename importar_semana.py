#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
JusticiaCV · importador semanal.
Lee los 3 PDF que Justicia publica cada martes y los sube a Supabase:
    2. listado provisional de ofertas     -> (viernes) las ofertas, antes de pedir; sin adjudicados ni listas
    5. listado definitivo de ofertas      -> ofertas de la semana
    7. puestos adjudicados                -> qué ofertas se cubrieron y en qué grupo
    8. listado completo de adjudicaciones -> la lista de cada cuerpo (con nombres, que NO se guardan:
                                             solo una huella, ver 01_esquema.sql)

Uso (Windows, PowerShell, dentro de esta carpeta):
    py -m pip install requests pypdf pdfplumber
    $env:SUPABASE_URL = "https://xxxx.supabase.co"
    $env:SUPABASE_SERVICE_KEY = "pega-aqui-la-clave-secret"
    py importar_semana.py C:\ruta\a\la\carpeta\con\los\3\pdf --probar     # solo lee y comprueba, no sube nada
    py importar_semana.py C:\ruta\a\la\carpeta\con\los\3\pdf              # lee, comprueba, te enseña el resumen y pide confirmación

Opciones:
    --probar              no escribe nada en Supabase (si hay claves, sí lee de la base para comprobar)
    --si                  no pide confirmación (para cuando ya te fías)
    --convocatoria N      fuerza el número de convocatoria (normalmente sale de la cabecera del PDF)
    --fecha AAAA-MM-DD    fuerza la fecha (normalmente sale de la cabecera del PDF)
    --poblaciones FICHERO CSV con poblaciones nuevas (nombre,nombre_visible,provincia,lat,lon), ver más abajo
    --solo-si-nuevo       (robot) si la base de datos ya tiene estos PDF, no hace nada y termina con código 10
    --solo-listas         la carpeta contiene uno o varios «listado completo» de semanas YA cargadas: solo se suben
                          las listas con sus huellas (sirve para rellenar el historial de posiciones de las semanas pasadas)

Se puede repetir sobre la misma semana: sustituye los datos de esa semana, no duplica.
Los nombres solo viajan de tu ordenador a Supabase (HTTPS) y no se escriben en ningún fichero ni en pantalla.
La clave secret da acceso total: no la pegues en la web, ni en GitHub, ni en un chat.
"""
import argparse, csv, datetime, hashlib, json, os, re, sys, time, unicodedata
from collections import Counter, defaultdict
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass


class Parar(Exception):
    """Algo impide continuar: se muestra el mensaje y se sale sin tocar nada."""


# ---------------------------------------------------------------------------
# 1. Normalización (la misma que se usó para cargar el histórico)
# ---------------------------------------------------------------------------
ws=lambda s: re.sub(r'\s+',' ',(s or '')).strip()
FIX={'Castelló':'Castelló de la Plana/Castellón de la Plana','Borriana/Burrian a':'Borriana/Burriana','Monòver/Monóva r':'Monòver/Monóvar','Nàquera/Náquer a':'Nàquera/Náquera','Peníscola/Peñísc ola':'Peníscola/Peñíscola'}
def pob(p):
    p=ws(p); p=FIX.get(p,p); return p
def cuerpo(d):
    d=ws(d).lower()
    for k,c in (('tramitaci','TPA'),('gesti','GPA'),('auxilio','AJ'),('médic','MF'),('medic','MF'),('facultativ','FE'),('ayudante','AL')):
        if d.startswith(k): return c
    return 'OTRO'
UP={'S.C.','TSJ','IML','UVFI','SCT','SCG','SCEJ','TI','GU','II','VSM','RPT','NOJ','PPT','CS','JVM','TPA','GPA'}
SMALL={'de','del','la','las','el','los','y','en','a','al','l','d'}
def pretty(s):
    s=ws(s); out=[]
    for i,t in enumerate(s.split(' ')):
        if t.upper() in UP or t.upper().startswith('S.C.'): out.append(t.upper().replace('S.C.','S.C. ').strip()); continue
        low=t.lower()
        if i>0 and low in SMALL: out.append(low); continue
        out.append("-".join(x[:1].upper()+x[1:] for x in low.split('-')) if '-' in low else low[:1].upper()+low[1:])
    r=' '.join(out); r=r.replace("S.C. ","S.C. ").replace('  ',' ')
    r=re.sub(r'\bFiscalia\b','Fiscalía',r); r=re.sub(r'\bArea\b','Área',r); r=re.sub(r'\bDenia\b','Dénia',r)
    r=re.sub(r'\bSeccion\b','Sección',r); r=re.sub(r'\bLliria\b','Llíria',r)
    r=re.sub(r'/([a-zà-ÿ])',lambda m:'/'+m.group(1).upper(),r)
    return r

TIPO = {'vacante': 'vacante', 'sustitucion temporal': 'sustitucion', 'refuerzo': 'refuerzo'}
CUERPOS = ['TPA', 'GPA', 'AJ', 'MF', 'FE', 'AL']
PROVINCIA_PDF = {'alicante': 'Alicante', 'alacant': 'Alicante', 'valencia': 'Valencia', 'valència': 'Valencia',
                 'castellon': 'Castellón', 'castelló': 'Castellón', 'castellón': 'Castellón'}


def sin_acentos(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s or '') if unicodedata.category(c) != 'Mn')


def mayus(s):
    return re.sub(r'\s+', ' ', sin_acentos(s).upper()).strip()


def miles(n):
    return f'{n:,}'.replace(',', '.')


# ---------------------------------------------------------------------------
# 2. Lectura de los PDF
# ---------------------------------------------------------------------------
def _pypdf():
    try:
        from pypdf import PdfReader
        return PdfReader
    except ImportError:
        raise Parar('Falta pypdf. Ejecuta:  py -m pip install requests pypdf pdfplumber')


def texto_pagina1(ruta):
    r = _pypdf()(str(ruta))
    return r.pages[0].extract_text() or '', len(r.pages), r.metadata


def texto_layout(ruta):
    """Texto de todo el PDF conservando las columnas (una línea por fila)."""
    r = _pypdf()(str(ruta))
    return [(p.extract_text(extraction_mode='layout') or '') for p in r.pages]


def tipo_de_pdf(ruta):
    """ofertas | adjudicados | completo | None, mirando el contenido (no el nombre del fichero)."""
    txt, _, _ = texto_pagina1(ruta)
    n = mayus(txt)
    if 'LISTADO DEFINITIVO DE OFERTAS' in n:
        return 'ofertas'
    if 'LISTADO PROVISIONAL DE OFERTAS' in n:
        return 'provisional'
    if 'ADJUDICACION OFERTAS DE EMPLEO TEMPORAL' in n or 'CONVOCATORIA/CONVOCATORIA' in n:
        return 'completo'
    if re.search(r'\bDNI\b', n) and 'NOMBRE Y APELLIDOS' in n:
        return 'adjudicados'
    return None


def cabecera(txt):
    """(numero, anio, fecha ISO) de la cabecera 'CONVOCATORIA 31/2026 ... 22/09/2026'. Lo que no aparezca, None."""
    m = re.search(r'CONVOCATORIA(?:\s*/\s*CONVOCAT[OÒ]RIA)?\s+(\d{1,3})\s*/\s*(\d{4})', txt, re.I)
    if not m:
        return None, None, None
    f = re.search(r'(\d{2})/(\d{2})/(\d{4})', txt[m.end():])
    fecha = f'{f.group(3)}-{f.group(2)}-{f.group(1)}' if f else None
    return int(m.group(1)), int(m.group(2)), fecha


def leer_ofertas(ruta):
    try:
        import pdfplumber
    except ImportError:
        raise Parar('Falta pdfplumber. Ejecuta:  py -m pip install requests pypdf pdfplumber')
    alias = {'cuerpo': 'denominacion', 'denominacion': 'denominacion', 'n puesto': 'n_puesto', 'nº puesto': 'n_puesto',
             'centro destino': 'centro', 'poblacion': 'poblacion', 'provincia': 'provincia',
             'tipo de oferta': 'tipo', 'observaciones': 'observaciones'}
    norm = lambda s: re.sub(r'\s+', ' ', (s or '').replace('\n', ' ')).strip().lower().replace('ó', 'o').replace('í', 'i')
    campos = ['n_puesto', 'denominacion', 'centro', 'poblacion', 'provincia', 'tipo', 'observaciones']
    filas, cols = [], None
    with pdfplumber.open(str(ruta)) as pdf:
        for p in pdf.pages:
            for t in p.extract_tables():
                for row in t:
                    c = [re.sub(r'\s+', ' ', (x or '').replace('\n', ' ')).strip() for x in row]
                    nombres = [alias.get(norm(x)) for x in c]
                    if 'n_puesto' in nombres:
                        cols = nombres
                        continue
                    if cols and len(c) == len(cols):
                        d = {k: v for k, v in zip(cols, c) if k}
                        if re.fullmatch(r'\d{5,8}', d.get('n_puesto', '')):
                            filas.append({f: d.get(f, '') for f in campos})
    return filas


def normalizar_ofertas(filas):
    """-> (ofertas normalizadas, problemas, avisos). Cada oferta: n_puesto, cuerpo, centro, poblacion, prov_pdf, tipo, observaciones."""
    out, prob, avisos = [], [], []
    for r in filas:
        cu = cuerpo(r['denominacion'])
        tp = TIPO.get(mayus(r['tipo']).lower())
        if cu == 'OTRO':
            avisos.append(f"cuerpo no reconocido «{r['denominacion']}» (puesto {r['n_puesto']}): se guardará como OTRO")
        if tp is None:
            prob.append(f"tipo de oferta desconocido «{r['tipo']}» (puesto {r['n_puesto']})")
        prov = ''
        pdfprov = sin_acentos(r.get('provincia', '')).lower()
        for k, v in PROVINCIA_PDF.items():
            if pdfprov.startswith(sin_acentos(k)):
                prov = v
                break
        out.append(dict(n_puesto=int(r['n_puesto']), cuerpo=cu, centro=pretty(r['centro']), poblacion=pob(r['poblacion']),
                        prov_pdf=prov, tipo=tp, observaciones=ws(r['observaciones'])))
    return out, prob, avisos


_HDR = re.compile(r'^\s*(Auxilio Judicial|Tramitaci[oó]n Procesal y Administrativa|Gesti[oó]n Procesal y Administrativa|'
                  r'M[eé]dic[oa]s? Forenses?|Facultativ[oa]s? Especialistas?|Ayudantes? de Laboratorio)[^\n]*?/')
_FILA = re.compile(r'^(?P<name>\S.*?)\s+GRUPO\s+(?P<g>\d+\w*)\s+(?P<st>\S.*?)\s*$')


def estado_norm(e):
    """-> (estado, peticion) en el vocabulario de la base de datos."""
    e = ws(e)
    if e.startswith('NO PARTICIPA'):
        return 'no_pide', None
    if e.startswith('PARTICIPA'):
        return 'pide_sin_plaza', None
    if 'OTRO CUERPO' in e and e.startswith('ADJUDICACI'):
        return 'adjudicada_otro_cuerpo', None
    m = re.match(r'ADJUDICACI\S*\s*-\s*PETICI\S*\s*(\d+)', e)
    if m:
        return 'adjudicada', int(m.group(1))
    return None, None


def leer_completo(ruta):
    """-> (filas, sin_entender). Cada fila: cuerpo, orden, grupo, estado, peticion, nombre (el nombre SOLO se guarda en memoria)."""
    cu, cnt, filas, raras = None, Counter(), [], Counter()
    for pag in texto_layout(ruta):
        for ln in pag.replace('\f', '').split('\n'):
            m = _HDR.match(ln)
            if m:
                cu = cuerpo(m.group(1))
                continue
            m = _FILA.match(ln.strip())
            if not m:
                if re.search(r'\bGRUPO\s+\d', ln):
                    raras['línea con GRUPO que no se ha podido leer'] += 1
                continue
            if cu is None or cu == 'OTRO':
                raras['fila antes de saber el cuerpo'] += 1
                continue
            est, pet = estado_norm(m['st'])
            if est is None:
                raras['estado desconocido: ' + ws(m['st'])[:60]] += 1
                continue
            cnt[cu] += 1
            filas.append(dict(cuerpo=cu, orden=cnt[cu], grupo=int(re.match(r'\d+', m['g']).group()),
                              estado=est, peticion=pet, nombre=ws(m['name'])))
    return filas, raras


_PROV = r'(Alicante/Alacant|Valencia/Val.ncia|Castell[oó]n/Castell[oó])'
_RX_A = re.compile(r'^\S+\*+\S*\s+(?P<name>[^\d]+?)\s*(?P<g>\d)\s+(?:(?P<cuerpo>TPA|GPA|AJ|MF|FE|AL)\s+)?(?P<puesto>\d{5,8})\s+(?P<dest>.+?)'
                   r'(?:\s{2,}(?P<prov>' + _PROV + r'))?\s*$')
_RX_B = re.compile(r'^\S+\*+\S*\s+(?P<name>[^\d]+?)\s*(?P<puesto>\d{5,8})\s+(?P<g>\d)\s+(?P<dest>.+?)(?:\s{2,}(?P<prov>' + _PROV + r'))?\s*$')


def leer_adjudicados(ruta):
    """-> (adjudicaciones, sin_leer). Solo se queda con grupo, cuerpo (si viene) y nº de puesto: ni DNI ni nombre."""
    lineas = []
    for pag in texto_layout(ruta):
        lineas += [l.strip() for l in pag.replace('\f', '').split('\n') if l.strip()]
    if any(re.match(r'^\d{8}[A-Z]\s', l) for l in lineas):
        raise Parar('Este PDF de adjudicados lleva los DNI SIN enmascarar. No se procesa ni se guarda nada. '
                    'Avisa para decidir qué hacer (lo normal es no usarlo y esperar a que lo corrijan).')
    filas, mal, i = [], 0, 0
    while i < len(lineas):
        s = lineas[i]
        i += 1
        if '*' not in s.split(' ')[0]:
            continue
        m = _RX_A.match(s) or _RX_B.match(s)
        if not m and i < len(lineas) and '*' not in lineas[i].split(' ')[0]:      # nombre partido en dos líneas
            m = _RX_A.match(s + '   ' + lineas[i]) or _RX_B.match(s + '   ' + lineas[i])
            if m:
                i += 1
        if m:
            filas.append(dict(grupo=int(m['g']), cuerpo=m.groupdict().get('cuerpo') or '', n_puesto=int(m['puesto'])))
        else:
            mal += 1
    return filas, mal


# ---------------------------------------------------------------------------
# 3. Conexión con Supabase (REST). Las claves nuevas (sb_secret_...) van solo en 'apikey'.
# ---------------------------------------------------------------------------
class Supa:
    def __init__(self, url, key):
        try:
            import requests
        except ImportError:
            raise Parar('Falta requests. Ejecuta:  py -m pip install requests pypdf pdfplumber')
        self.url = url.rstrip('/')
        self.s = requests.Session()
        self.h = {'apikey': key, 'Content-Type': 'application/json'}
        if not key.startswith('sb_'):
            self.h['Authorization'] = 'Bearer ' + key

    def _pedir(self, metodo, ruta, ocultar=False, **kw):
        cab = {**self.h, **kw.pop('extra', {})}
        for intento in range(4):
            try:
                r = self.s.request(metodo, f'{self.url}/rest/v1/{ruta}', headers=cab, timeout=180, **kw)
            except Exception as e:
                if intento == 3:
                    raise Parar(f'No se puede conectar con Supabase ({type(e).__name__}). Comprueba internet y SUPABASE_URL.')
                time.sleep(2 * (intento + 1))
                continue
            if r.status_code >= 500 and intento < 3:
                time.sleep(2 * (intento + 1))
                continue
            if r.status_code >= 300:
                try:
                    msg = r.json().get('message', '')
                except Exception:
                    msg = ''
                if not ocultar and not msg:
                    msg = r.text[:200]
                raise Parar(f'Supabase respondió {r.status_code} en «{ruta.split("?")[0]}»: {msg[:200]}'
                            + ('  (¿la clave es la secret y la URL la de tu proyecto?)' if r.status_code in (401, 403) else ''))
            return r

    def leer(self, tabla, columnas, filtros=None):
        """Todas las filas (de 1000 en 1000, límite de Supabase)."""
        out, ini = [], 0
        while True:
            q = f'{tabla}?select={columnas}' + ''.join(f'&{k}={v}' for k, v in (filtros or {}).items()) + '&order=' + columnas.split(',')[0]
            r = self._pedir('GET', q, extra={'Range-Unit': 'items', 'Range': f'{ini}-{ini + 999}'})
            lote = r.json()
            out += lote
            if len(lote) < 1000:
                return out
            ini += 1000

    def subir(self, tabla, filas, conflicto, trozo=1000):
        for i in range(0, len(filas), trozo):
            self._pedir('POST', f'{tabla}?on_conflict={conflicto}', json=filas[i:i + trozo],
                        extra={'Prefer': 'resolution=merge-duplicates,return=minimal'})

    def borrar(self, tabla, filtro):
        self._pedir('DELETE', f'{tabla}?{filtro}')

    def rpc(self, funcion, args, ocultar=False):
        r = self._pedir('POST', f'rpc/{funcion}', json=args, ocultar=ocultar)
        return r.json() if r.content else None


# ---------------------------------------------------------------------------
# 4. Qué hay en la carpeta
# ---------------------------------------------------------------------------
def reunir_pdfs(carpeta):
    c = Path(carpeta)
    if not c.is_dir():
        raise Parar(f'No existe la carpeta «{carpeta}».')
    pdfs = sorted({p for p in list(c.glob('*.pdf')) + list(c.glob('*.PDF'))})
    if not pdfs:
        raise Parar(f'No hay ningún PDF en «{carpeta}».')
    por_tipo, ignorados = defaultdict(list), []
    for p in pdfs:
        try:
            t = tipo_de_pdf(p)
        except Parar:
            raise
        except Exception as e:
            ignorados.append((p.name, f'no se puede leer ({type(e).__name__})'))
            continue
        if t is None:
            ignorados.append((p.name, 'no es ninguno de los 3 listados esperados'))
        else:
            por_tipo[t].append(p)
    elegidos = {}
    for t, ps in por_tipo.items():
        hashes = {hashlib.sha256(p.read_bytes()).hexdigest(): p for p in ps}       # copias idénticas cuentan una vez
        ps = list(hashes.values())
        if len(ps) > 1:
            raise Parar(f'Hay {len(ps)} PDF distintos de tipo «{t}»: ' + ', '.join(p.name for p in ps) +
                        '. Deja en la carpeta solo el de esta semana y vuelve a ejecutar.')
        elegidos[t] = ps[0]
    if 'provisional' in elegidos:                       # el provisional (viernes) solo vale si no hay definitivo (martes)
        prov = elegidos.pop('provisional')
        if 'ofertas' in elegidos:
            ignorados.append((prov.name, 'listado provisional: ya está el definitivo'))
        else:
            elegidos['ofertas'] = prov
    return elegidos, ignorados


NOMBRE_TIPO = {'ofertas': 'listado de ofertas (provisional o definitivo)', 'adjudicados': 'puestos adjudicados', 'completo': 'listado completo de adjudicaciones'}


def leer_poblaciones_csv(ruta):
    out = {}
    with open(ruta, newline='', encoding='utf-8-sig') as f:
        for i, r in enumerate(csv.DictReader(f), start=2):
            try:
                nom = ws(r['nombre'])
                prov = ws(r['provincia'])
                if prov not in ('Alicante', 'Castellón', 'Valencia'):
                    raise ValueError('provincia debe ser Alicante, Castellón o Valencia')
                lat, lon = float(str(r['lat']).replace(',', '.')), float(str(r['lon']).replace(',', '.'))
                if not (37 < lat < 41 and -2 < lon < 1):
                    raise ValueError('lat/lon fuera de la Comunitat Valenciana')
                out[nom] = dict(nombre=nom, nombre_visible=ws(r.get('nombre_visible') or '') or nom.replace(
                    'Castelló de la Plana/Castellón de la Plana', 'Castelló de la Plana'), provincia=prov, lat=lat, lon=lon)
            except (KeyError, ValueError) as e:
                raise Parar(f'{ruta}, línea {i}: {e}')
    return out


# ---------------------------------------------------------------------------
# 5. Análisis y comprobaciones (no toca la base de datos)
# ---------------------------------------------------------------------------
class Semana:
    pass


def analizar(carpeta, args):
    elegidos, ignorados = reunir_pdfs(carpeta)
    if 'ofertas' not in elegidos:
        raise Parar('Falta el PDF de ofertas (el provisional del viernes o el definitivo del martes). Sin él no se puede importar la semana.')
    S = Semana()
    S.avisos, S.errores, S.ignorados, S.archivos = [], [], ignorados, elegidos
    S.pdf_fechas = {}
    S.provisional = 'LISTADO PROVISIONAL DE OFERTAS' in mayus(texto_pagina1(elegidos['ofertas'])[0])
    if S.provisional and ('adjudicados' in elegidos or 'completo' in elegidos):
        raise Parar('El listado de ofertas es el PROVISIONAL (viernes) pero hay también PDF del martes. Usa el provisional solo, o el definitivo con los otros dos.')
    for t, p in elegidos.items():
        _, npag, meta = texto_pagina1(p)
        cd = (meta or {}).get('/CreationDate') if meta else None
        m = re.match(r"D:(\d{4})(\d{2})(\d{2})", cd or '')
        S.pdf_fechas[t] = f'{m[1]}-{m[2]}-{m[3]}' if m else None

    # --- cabeceras: número de convocatoria y fecha
    cab = {}
    for t in ('ofertas', 'completo'):
        if t in elegidos:
            cab[t] = cabecera(texto_pagina1(elegidos[t])[0])
    nums = {v[0] for v in cab.values() if v[0]}
    anios = {v[1] for v in cab.values() if v[1]}
    fechas = {v[2] for v in cab.values() if v[2]}
    if len(nums) > 1 or len(anios) > 1:
        raise Parar('Los PDF son de convocatorias distintas: ' + ', '.join(f'{NOMBRE_TIPO[t]} = {v[0]}/{v[1]}' for t, v in cab.items()) +
                    '. Deja en la carpeta solo los de la misma semana.')
    if len(fechas) > 1:
        S.avisos.append('Las fechas de las cabeceras no coinciden: ' + ', '.join(sorted(fechas)))
    S.numero = args.convocatoria or (nums.pop() if nums else None)
    S.anio = anios.pop() if anios else datetime.date.today().year
    S.fecha = args.fecha or (sorted(fechas)[0] if fechas else None)
    if args.convocatoria and nums and args.convocatoria not in nums:
        S.avisos.append(f'Has forzado la convocatoria {args.convocatoria}, pero los PDF dicen {sorted(nums)}.')
    if S.numero is None:
        raise Parar('No encuentro el número de convocatoria en los PDF. Indícalo con  --convocatoria N')
    if S.fecha is None:
        raise Parar('No encuentro la fecha en los PDF. Indícala con  --fecha AAAA-MM-DD')
    try:
        datetime.date.fromisoformat(S.fecha)
    except ValueError:
        raise Parar(f'Fecha no válida «{S.fecha}»; usa AAAA-MM-DD.')
    if S.fecha and S.pdf_fechas.get('ofertas') and abs((datetime.date.fromisoformat(S.fecha) - datetime.date.fromisoformat(S.pdf_fechas['ofertas'])).days) > 3:
        S.avisos.append(f'La fecha de la cabecera ({S.fecha}) y la de creación del PDF ({S.pdf_fechas["ofertas"]}) difieren más de 3 días.')

    # --- ofertas
    S.ofertas, prob, av = normalizar_ofertas(leer_ofertas(elegidos['ofertas']))
    S.errores += prob
    S.avisos += av
    if not S.ofertas:
        S.errores.append('No se ha leído ninguna oferta del PDF de ofertas.')
    c = Counter(o['n_puesto'] for o in S.ofertas)
    dup = [k for k, v in c.items() if v > 1]
    if dup:
        S.errores.append(f'Números de puesto repetidos en las ofertas: {dup[:5]}')

    # --- adjudicados
    S.adj, S.adj_mal = None, 0
    if 'adjudicados' in elegidos:
        S.adj, S.adj_mal = leer_adjudicados(elegidos['adjudicados'])
        puestos = {o['n_puesto'] for o in S.ofertas}
        c = Counter(a['n_puesto'] for a in S.adj)
        if any(v > 1 for v in c.values()):
            S.avisos.append(f'{sum(1 for v in c.values() if v > 1)} puestos adjudicados aparecen más de una vez; se usa la primera aparición.')
            vistos, uni = set(), []
            for a in S.adj:
                if a['n_puesto'] not in vistos:
                    vistos.add(a['n_puesto'])
                    uni.append(a)
            S.adj = uni
        fuera = [a for a in S.adj if a['n_puesto'] not in puestos]
        S.adj_fuera = len(fuera)
        if S.adj_mal:
            S.avisos.append(f'{S.adj_mal} líneas del PDF de adjudicados no se han podido leer.')
        if S.adj and len(fuera) / len(S.adj) > 0.05:
            S.errores.append(f'El PDF de adjudicados no parece de esta semana: {len(fuera)} de {len(S.adj)} puestos no están en las ofertas de la convocatoria {S.numero}.')
        elif fuera:
            S.avisos.append(f'{len(fuera)} puestos adjudicados no están en las ofertas de esta semana (se ignoran).')
        if not S.adj:
            S.errores.append('No se ha leído ningún puesto del PDF de adjudicados.')
        elif any(a['grupo'] not in (1, 2, 3, 4) for a in S.adj):
            S.errores.append('Hay puestos adjudicados con un grupo que no es 1, 2, 3 ni 4.')
    else:
        S.avisos.append('No hay PDF de puestos adjudicados: la semana se cargará sin saber qué ofertas se cubrieron.')

    # --- listado completo
    S.lista, S.raras = None, Counter()
    if 'completo' in elegidos:
        S.lista, S.raras = leer_completo(elegidos['completo'])
        if S.raras:
            S.errores.append('Líneas del listado completo que no se han entendido: ' + '; '.join(f'{k} ({v})' for k, v in S.raras.items()))
        if not S.lista:
            S.errores.append('No se ha leído ninguna fila del listado completo.')
        else:
            cu_lista = {f['cuerpo'] for f in S.lista}
            cu_of = {o['cuerpo'] for o in S.ofertas}
            if cu_lista != cu_of:
                S.avisos.append(f'Cuerpos con ofertas {sorted(cu_of)} y cuerpos en el listado {sorted(cu_lista)} no coinciden.')
            if S.adj is not None:
                n_adj = sum(1 for f in S.lista if f['estado'] == 'adjudicada')
                if n_adj != len(S.adj):
                    S.avisos.append(f'El listado completo marca {n_adj} adjudicadas y el PDF de adjudicados tiene {len(S.adj)} puestos.')
                g_l, g_a = Counter(f['grupo'] for f in S.lista if f['estado'] == 'adjudicada'), Counter(a['grupo'] for a in S.adj)
                if g_l != g_a:
                    S.avisos.append(f'Adjudicadas por grupo distintas: listado {dict(sorted(g_l.items()))} · adjudicados {dict(sorted(g_a.items()))}.')
            if any(f['grupo'] not in (1, 2, 3, 4) for f in S.lista):
                S.errores.append('Hay filas del listado completo con un grupo que no es 1, 2, 3 ni 4: ' + str(sorted({f['grupo'] for f in S.lista})))
            sin_nombre = sum(1 for f in S.lista if not f['nombre'])
            if sin_nombre:
                S.errores.append(f'{sin_nombre} filas del listado sin nombre.')
    else:
        S.avisos.append('No hay listado completo: no se actualizan las listas ni las posiciones de las personas.')
    return S


def hay_algo_nuevo(S, ya):
    """¿Aportan algo estos PDF respecto a lo que ya hay en la base de datos? (para el robot)"""
    if ya is None:
        return True
    if S.provisional:
        return False                                    # ya existe la convocatoria (provisional o definitiva): no se toca
    return bool(ya['provisional']) or (S.adj is not None and not ya['adjudicados_cargados']) or (bool(S.lista) and not ya['listado_cargado'])


def mostrar_resumen(S):
    print(f'\nConvocatoria {S.numero}/{S.anio} · fecha {S.fecha}')
    for t in ('ofertas', 'adjudicados', 'completo'):
        if t in S.archivos:
            print(f'  {NOMBRE_TIPO[t]:<38} {S.archivos[t].name}')
        else:
            print(f'  {NOMBRE_TIPO[t]:<38} (no está)')
    for n, m in S.ignorados:
        print(f'  ignorado: {n} ({m})')
    cu = Counter(o['cuerpo'] for o in S.ofertas)
    tp = Counter(o['tipo'] for o in S.ofertas)
    print(f'\nOfertas: {len(S.ofertas)}  (' + ', '.join(f'{k} {v}' for k, v in sorted(cu.items())) + ')  ·  ' +
          ', '.join(f'{k} {v}' for k, v in sorted(tp.items())))
    if S.adj is not None:
        print(f'Puestos adjudicados: {len(S.adj)}  (por grupo: ' + ', '.join(f'{k}: {v}' for k, v in sorted(Counter(a["grupo"] for a in S.adj).items())) + ')')
    if S.lista:
        print(f'Listado completo: {miles(len(S.lista))} filas')
        for c in CUERPOS:
            fs = [f for f in S.lista if f['cuerpo'] == c]
            if fs:
                print(f'   {c:<4} {miles(len(fs)):>7} personas · piden ofertas {sum(1 for f in fs if f["estado"] != "no_pide"):>5} · adjudicadas {sum(1 for f in fs if f["estado"] == "adjudicada"):>3}'
                      f' · grupos ' + ', '.join(f'{g}: {n}' for g, n in sorted(Counter(f["grupo"] for f in fs).items())))


# ---------------------------------------------------------------------------
# 6. Comparación con lo que ya hay en la base de datos
# ---------------------------------------------------------------------------
def clave_valida(url, key):
    if key.startswith('sb_publishable_'):
        raise Parar('Esa es la clave PÚBLICA (publishable). El importador necesita la clave secret (empieza por sb_secret_).')
    if key.startswith('eyJ'):
        try:
            import base64
            cuerpo_jwt = key.split('.')[1]
            rol = json.loads(base64.urlsafe_b64decode(cuerpo_jwt + '=' * (-len(cuerpo_jwt) % 4))).get('role')
            if rol and rol != 'service_role':
                raise Parar(f'Esa clave es de tipo «{rol}». El importador necesita la clave secret / service_role.')
        except Parar:
            raise
        except Exception:
            pass
    if not re.match(r'^https://', url) and not re.match(r'^http://(127\.0\.0\.1|localhost)(:\d+)?$', url):
        raise Parar('SUPABASE_URL debe empezar por https:// (la tienes en Supabase > Project Settings > API).')


def comprobar_con_base(S, db, args, carpeta):
    """Añade avisos/errores comparando con la base y devuelve (poblaciones_nuevas_a_crear, existente)."""
    pobs = {r['nombre']: r for r in db.leer('poblaciones', 'nombre,id,provincia')}
    nuevas = sorted({o['poblacion'] for o in S.ofertas} - set(pobs))
    a_crear = {}
    if nuevas:
        dadas = leer_poblaciones_csv(args.poblaciones) if args.poblaciones else {}
        a_crear = {n: dadas[n] for n in nuevas if n in dadas}
        faltan = [n for n in nuevas if n not in dadas]
        if faltan:
            ruta = Path(carpeta) / 'poblaciones_pendientes.csv'
            prov_pdf = {}
            for o in S.ofertas:
                if o['prov_pdf']:
                    prov_pdf[o['poblacion']] = o['prov_pdf']
            with open(ruta, 'w', newline='', encoding='utf-8-sig') as f:
                w = csv.writer(f)
                w.writerow(['nombre', 'nombre_visible', 'provincia', 'lat', 'lon'])
                for n in faltan:
                    w.writerow([n, n, prov_pdf.get(n, ''), '', ''])
            S.errores.append(
                f'Hay {len(faltan)} población(es) que aún no están en la base de datos: ' + '; '.join(faltan) + '.\n'
                f'     He creado «{ruta}» con esas poblaciones. Rellena las columnas provincia (Alicante, Castellón o Valencia), '
                f'lat y lon\n     (o pásamelas y lo relleno yo) y vuelve a ejecutar añadiendo  --poblaciones "{ruta}"')
    convs = db.leer('convocatorias', 'id,anio,numero,fecha_publicacion,listado_cargado,adjudicados_cargados,provisional')
    ya = [c for c in convs if c['anio'] == S.anio and c['numero'] == S.numero]
    previas = sorted((c for c in convs if c['anio'] == S.anio and c['numero'] != S.numero), key=lambda c: c['numero'])
    ultima = previas[-1]['numero'] if previas else None
    if S.provisional and ya and not ya[0]['provisional']:
        S.errores.append(f'La convocatoria {S.numero}/{S.anio} ya tiene cargado el listado DEFINITIVO: no se sustituye por el provisional.')
    if ya:
        que = ['ofertas'] + (['adjudicaciones'] if S.adj is not None else []) + (['listas'] if S.lista else [])
        S.avisos.append(f'La convocatoria {S.numero}/{S.anio} YA estaba cargada: se sustituirán sus ' + ', '.join(que[:-1]) + (' y ' if len(que) > 1 else '') + que[-1] +
                        ' por las de estos PDF.')
        if ya[0]['fecha_publicacion'] != S.fecha:
            S.avisos.append(f'La fecha guardada ({ya[0]["fecha_publicacion"]}) cambiará a {S.fecha}.')
    elif ultima is not None and S.numero != ultima + 1:
        if S.numero > ultima + 1:
            S.avisos.append(f'La última convocatoria cargada es la {ultima} y ésta es la {S.numero}: ¿falta alguna semana en medio?')
        else:
            S.avisos.append(f'Ya hay convocatorias posteriores (hasta la {ultima}); ésta es la {S.numero}.')
    if not ya and previas:
        f_prev = max(c['fecha_publicacion'] for c in previas if c['numero'] < S.numero) if any(c['numero'] < S.numero for c in previas) else None
        if f_prev and S.fecha <= f_prev:
            S.avisos.append(f'La fecha {S.fecha} no es posterior a la de la convocatoria anterior ({f_prev}).')
    cen_antes = {(r['nombre'], r['poblacion_id']) for r in db.leer('centros', 'nombre,poblacion_id')}
    ids = {n: r['id'] for n, r in pobs.items()}
    nuevos_centros = sorted({o['centro'] + ' (' + o['poblacion'] + ')' for o in S.ofertas
                             if o['poblacion'] in ids and (o['centro'], ids[o['poblacion']]) not in cen_antes})
    S.centros_nuevos = nuevos_centros
    return a_crear, (ya[0] if ya else None)


# ---------------------------------------------------------------------------
# 7. Subida
# ---------------------------------------------------------------------------
def trozos(lista, n):
    for i in range(0, len(lista), n):
        yield lista[i:i + n]


def subir_todo(S, db, a_crear, existente=None):
    paso = lambda t: print(f'  {t}', flush=True)
    if a_crear:
        paso(f'poblaciones nuevas: {len(a_crear)}')
        db.subir('poblaciones', list(a_crear.values()), 'nombre')
    pob = {r['nombre']: r['id'] for r in db.leer('poblaciones', 'id,nombre')}

    paso('convocatoria')
    base = dict(anio=S.anio, numero=S.numero, fecha_publicacion=S.fecha)
    db.subir('convocatorias', [dict(base, adjudicados_cargados=False, listado_cargado=False, provisional=bool(S.provisional))], 'anio,numero')   # oculta la semana a medias
    cid = db.leer('convocatorias', 'id,anio,numero', {'anio': f'eq.{S.anio}', 'numero': f'eq.{S.numero}'})[0]['id']

    paso('centros')
    cent = sorted({(o['centro'], pob[o['poblacion']]) for o in S.ofertas})
    db.subir('centros', [dict(nombre=n, poblacion_id=p) for n, p in cent], 'nombre,poblacion_id')
    cen = {(r['nombre'], r['poblacion_id']): r['id'] for r in db.leer('centros', 'id,nombre,poblacion_id')}

    paso(f'ofertas ({len(S.ofertas)})')
    previas = db.leer('ofertas', 'id,n_puesto', {'convocatoria_id': f'eq.{cid}'})
    nuevos = {o['n_puesto'] for o in S.ofertas}
    sobran = [r['id'] for r in previas if r['n_puesto'] not in nuevos]
    for ch in trozos(sobran, 150):
        db.borrar('ofertas', 'id=in.(' + ','.join(map(str, ch)) + ')')
    db.subir('ofertas', [dict(convocatoria_id=cid, n_puesto=o['n_puesto'], cuerpo=o['cuerpo'],
                              centro_id=cen[(o['centro'], pob[o['poblacion']])], poblacion_id=pob[o['poblacion']],
                              tipo=o['tipo'], observaciones=o['observaciones'] or None) for o in S.ofertas], 'convocatoria_id,n_puesto')
    ofe = {r['n_puesto']: r['id'] for r in db.leer('ofertas', 'id,n_puesto', {'convocatoria_id': f'eq.{cid}'})}

    n_adj = None
    if S.adj is not None:
        paso(f'adjudicaciones ({len(S.adj)})')
        for ch in trozos(list(ofe.values()), 150):
            db.borrar('adjudicaciones', 'oferta_id=in.(' + ','.join(map(str, ch)) + ')')
        filas = [dict(oferta_id=ofe[a['n_puesto']], grupo=a['grupo']) for a in S.adj if a['n_puesto'] in ofe]
        db.subir('adjudicaciones', filas, 'oferta_id')
        n_adj = len(filas)

    if S.lista:
        paso(f'listado completo ({miles(len(S.lista))} filas; los nombres se convierten en huella y se descartan)')
        db.borrar('lista_filas', f'convocatoria_id=eq.{cid}')
        hechas = 0
        for ch in trozos(S.lista, 500):
            db.rpc('importar_lista', {'p_convocatoria': cid, 'p_filas': [
                dict(cuerpo=f['cuerpo'], orden=f['orden'], grupo=f['grupo'], estado=f['estado'], peticion=f['peticion'], nombre=f['nombre'])
                for f in ch]}, ocultar=True)
            hechas += len(ch)
            print(f'     {miles(hechas)}/{miles(len(S.lista))}', end='\r', flush=True)
        print(' ' * 30, end='\r')
        paso('resumen por cuerpo y grupo')
        db.rpc('recalcular_cortes', {'p_convocatoria': cid})

    paso('marcando la semana como cargada')
    # si falta algún PDF pero esa parte ya estaba cargada de antes, se conserva
    db.subir('convocatorias', [dict(base,
                                    adjudicados_cargados=S.adj is not None or bool(existente and existente['adjudicados_cargados']),
                                    listado_cargado=bool(S.lista) or bool(existente and existente['listado_cargado']),
                                    provisional=bool(S.provisional))], 'anio,numero')

    res = db.rpc('resumen_importacion', {'p_convocatoria': cid})
    esperado = dict(ofertas=len(S.ofertas), adjudicaciones=(n_adj if n_adj is not None else res['adjudicaciones']),
                    lista_filas=len(S.lista) if S.lista else res['lista_filas'], huellas=len(S.lista) if S.lista else res['huellas'],
                    cortes=len({(f['cuerpo'], f['grupo']) for f in S.lista}) if S.lista else res['cortes'])
    return cid, res, esperado


def mostrar_final(db, cid, res, esperado, S):
    mal = [k for k in esperado if int(res[k]) != int(esperado[k])]
    print('\nComprobación en la base de datos (subido / esperado):')
    for k in ('ofertas', 'adjudicaciones', 'lista_filas', 'huellas', 'cortes'):
        print(f'   {k:<15} {miles(int(res[k])):>8} / {miles(int(esperado[k])):<8} {"OK" if k not in mal else "<-- NO COINCIDE"}')
    try:
        k = db.leer('cortes', 'cuerpo,grupo,personas,piden_ofertas,adjudicados,ultima_pos_adjudicada', {'convocatoria_id': f'eq.{cid}'})
        if k:
            print('\nCortes de la semana (posición DENTRO del grupo):')
            for r in sorted(k, key=lambda r: (CUERPOS.index(r['cuerpo']) if r['cuerpo'] in CUERPOS else 9, r['grupo'])):
                print(f"   {r['cuerpo']:<4} grupo {r['grupo']}: {miles(r['personas']):>6} personas · piden {r['piden_ofertas']:>5} · adjudicados {r['adjudicados']:>3} · última adjudicada en el puesto {r['ultima_pos_adjudicada'] if r['ultima_pos_adjudicada'] is not None else '—'}")
    except Parar:
        pass
    return not mal


# ---------------------------------------------------------------------------
# 7b. Solo listas (semanas ya cargadas): rellena las huellas para el historial de posiciones
# ---------------------------------------------------------------------------
def importar_solo_listas(carpeta, a, db):
    c = Path(carpeta)
    if not c.is_dir():
        raise Parar(f'No existe la carpeta «{carpeta}».')
    pdfs = sorted({p for p in list(c.glob('*.pdf')) + list(c.glob('*.PDF'))})
    por_conv, ignorados = {}, []
    vistos = {}
    for p in pdfs:
        h = hashlib.sha256(p.read_bytes()).hexdigest()
        if h in vistos:
            continue
        vistos[h] = p
        try:
            if tipo_de_pdf(p) != 'completo':
                ignorados.append(p.name)
                continue
            n, anio, fecha = cabecera(texto_pagina1(p)[0])
        except Parar:
            raise
        except Exception:
            ignorados.append(p.name)
            continue
        if n is None:
            raise Parar(f'«{p.name}» no trae el número de convocatoria en la cabecera.')
        if (anio, n) in por_conv:
            raise Parar(f'Hay dos listados completos de la convocatoria {n}/{anio}: {por_conv[(anio, n)][0].name} y {p.name}. Deja solo uno.')
        por_conv[(anio, n)] = (p, fecha)
    if not por_conv:
        raise Parar('No hay ningún «listado completo de adjudicaciones» en la carpeta.')
    convs = {(r['anio'], r['numero']): r for r in db.leer('convocatorias', 'id,anio,numero,fecha_publicacion,listado_cargado,adjudicados_cargados')}
    faltan = [f'{n}/{an}' for (an, n) in por_conv if (an, n) not in convs]
    if faltan:
        raise Parar('Estas convocatorias no están todavía en la base de datos: ' + ', '.join(faltan) +
                    '. Para semanas nuevas usa el modo normal con los 3 PDF.')
    print(f'\nListados completos encontrados: {len(por_conv)} (convocatorias ' + ', '.join(str(n) for (_, n) in sorted(por_conv)) + ')')
    for nm in ignorados:
        print(f'  ignorado: {nm}')
    leidos = {}
    for (an, n), (p, fecha) in sorted(por_conv.items()):
        filas, raras = leer_completo(p)
        if raras:
            raise Parar(f'Convocatoria {n}: líneas del listado que no se han entendido: ' + '; '.join(f'{k} ({v})' for k, v in raras.items()))
        if not filas or any(f['grupo'] not in (1, 2, 3, 4) for f in filas):
            raise Parar(f'Convocatoria {n}: el listado está vacío o trae un grupo que no es 1, 2, 3 ni 4.')
        leidos[(an, n)] = filas
        extra = '' if not fecha or fecha == str(convs[(an, n)]['fecha_publicacion']) else f'  AVISO: la cabecera dice {fecha} y la base tiene {convs[(an, n)]["fecha_publicacion"]} (no se cambia)'
        print(f'  convocatoria {n}: {miles(len(filas))} filas{extra}')
    if a.probar:
        print('\nModo --probar: todo se lee y cuadra. No se ha escrito nada en Supabase.')
        return 0
    if not a.si:
        r = input(f'\n¿Subo estas {len(leidos)} listas (con sus huellas) a Supabase? Escribe SI para continuar: ').strip().lower()
        if r not in ('si', 'sí'):
            print('Cancelado. No se ha subido nada.')
            return 1
    mal = 0
    for (an, n), filas in sorted(leidos.items()):
        cv = convs[(an, n)]
        antes = {(k['cuerpo'], k['grupo']): k for k in db.leer('cortes', 'cuerpo,grupo,personas,personas_antes,piden_ofertas,adjudicados,ultima_pos_adjudicada,ultima_pos_que_pide,convocatoria_id',
                                                               {'convocatoria_id': f'eq.{cv["id"]}'})}
        db.subir('convocatorias', [dict(anio=an, numero=n, fecha_publicacion=cv['fecha_publicacion'], adjudicados_cargados=cv['adjudicados_cargados'], listado_cargado=False)], 'anio,numero')
        db.borrar('lista_filas', f'convocatoria_id=eq.{cv["id"]}')
        for ch in trozos(filas, 500):
            db.rpc('importar_lista', {'p_convocatoria': cv['id'], 'p_filas': [
                dict(cuerpo=f['cuerpo'], orden=f['orden'], grupo=f['grupo'], estado=f['estado'], peticion=f['peticion'], nombre=f['nombre']) for f in ch]}, ocultar=True)
        db.rpc('recalcular_cortes', {'p_convocatoria': cv['id']})
        db.subir('convocatorias', [dict(anio=an, numero=n, fecha_publicacion=cv['fecha_publicacion'], adjudicados_cargados=cv['adjudicados_cargados'], listado_cargado=True)], 'anio,numero')
        res = db.rpc('resumen_importacion', {'p_convocatoria': cv['id']})
        despues = {(k['cuerpo'], k['grupo']): k for k in db.leer('cortes', 'cuerpo,grupo,personas,personas_antes,piden_ofertas,adjudicados,ultima_pos_adjudicada,ultima_pos_que_pide,convocatoria_id',
                                                                  {'convocatoria_id': f'eq.{cv["id"]}'})}
        ok = int(res['lista_filas']) == len(filas) and int(res['huellas']) == len(filas)
        if antes:
            igual = antes == despues
            nota = 'cortes idénticos a los que ya había' if igual else f'AVISO: los cortes han cambiado respecto a los que había ({sum(1 for k in set(antes) | set(despues) if antes.get(k) != despues.get(k))} grupos)'
        else:
            nota = 'cortes calculados'
        print(f'  convocatoria {n}: {miles(int(res["lista_filas"]))} filas, {miles(int(res["huellas"]))} huellas · {nota}' + ('' if ok else '  <-- NO COINCIDE'), flush=True)
        mal += (not ok)
    print('\n' + ('Hecho.' if not mal else 'TERMINADO CON DIFERENCIAS (revisa lo marcado).'))
    return 0 if not mal else 3


# ---------------------------------------------------------------------------
# 8. Programa principal
# ---------------------------------------------------------------------------
def main(argv=None):
    ap = argparse.ArgumentParser(description='Importa a Supabase los 3 PDF semanales de Justicia CV.')
    ap.add_argument('carpeta', help='carpeta con los 3 PDF de la semana')
    ap.add_argument('--probar', action='store_true', help='no escribe nada en Supabase')
    ap.add_argument('--si', action='store_true', help='no pide confirmación')
    ap.add_argument('--convocatoria', type=int, help='fuerza el número de convocatoria')
    ap.add_argument('--fecha', help='fuerza la fecha (AAAA-MM-DD)')
    ap.add_argument('--poblaciones', help='CSV con poblaciones nuevas (nombre,nombre_visible,provincia,lat,lon)')
    ap.add_argument('--solo-si-nuevo', action='store_true', help='para el robot: si no hay nada nuevo respecto a la base de datos, termina con código 10 sin subir nada')
    ap.add_argument('--solo-listas', action='store_true', help='solo sube listados completos de semanas ya cargadas')
    a = ap.parse_args(argv)
    subiendo = False
    try:
        if a.solo_listas:
            url, key = os.environ.get('SUPABASE_URL', '').strip(), os.environ.get('SUPABASE_SERVICE_KEY', '').strip()
            if not url or not key:
                raise Parar('Faltan SUPABASE_URL y SUPABASE_SERVICE_KEY (ver las instrucciones al principio del archivo).')
            clave_valida(url, key)
            print('Leyendo los PDF (puede tardar unos minutos)...', flush=True)
            return importar_solo_listas(a.carpeta, a, Supa(url, key))
        print('Leyendo los PDF (puede tardar un minuto)...', flush=True)
        S = analizar(a.carpeta, a)
        mostrar_resumen(S)
        url, key = os.environ.get('SUPABASE_URL', '').strip(), os.environ.get('SUPABASE_SERVICE_KEY', '').strip()
        db, a_crear, existente = None, {}, None
        if url and key:
            clave_valida(url, key)
            db = Supa(url, key)
            print('\nComparando con la base de datos...', flush=True)
            a_crear, existente = comprobar_con_base(S, db, a, a.carpeta)
        elif not a.probar:
            raise Parar('Faltan SUPABASE_URL y SUPABASE_SERVICE_KEY (ver las instrucciones al principio del archivo).')
        else:
            print('\n(Sin SUPABASE_URL / SUPABASE_SERVICE_KEY: solo se comprueban los PDF, no se compara con la base de datos.)')
        if a.solo_si_nuevo and db is not None and not S.errores:
            if not hay_algo_nuevo(S, existente):
                print('\nNada nuevo: la base de datos ya tiene estos PDF.')
                return 10
        if a_crear:
            print(f'\nPoblaciones nuevas que se darán de alta: ' + '; '.join(sorted(a_crear)))
        if getattr(S, 'centros_nuevos', None):
            print(f'\nCentros nuevos ({len(S.centros_nuevos)}); mira que los nombres se vean bien:')
            for c in S.centros_nuevos[:15]:
                print('   +', c)
            if len(S.centros_nuevos) > 15:
                print(f'   ... y {len(S.centros_nuevos) - 15} más')
        for m in S.avisos:
            print('\nAVISO:', m)
        if S.errores:
            for m in S.errores:
                print('\nERROR:', m)
            print('\nNo se ha subido nada.')
            return 2
        if a.probar:
            print('\nModo --probar: todo se lee y cuadra. No se ha escrito nada en Supabase.')
            return 0
        if not a.si:
            r = input(f'\n¿Subo la convocatoria {S.numero}/{S.anio} ({S.fecha}) a Supabase? Escribe SI para continuar: ').strip().lower()
            if r not in ('si', 'sí'):
                print('Cancelado. No se ha subido nada.')
                return 1
        print('\nSubiendo...')
        subiendo = True
        t0 = time.time()
        cid, res, esperado = subir_todo(S, db, a_crear, existente)
        ok = mostrar_final(db, cid, res, esperado, S)
        print(f'\n{"Hecho" if ok else "TERMINADO CON DIFERENCIAS (revisa lo marcado)"} en {time.time() - t0:.0f} s.')
        return 0 if ok else 3
    except Parar as e:
        print('\nERROR:', e)
        print('La subida se ha interrumpido a medias. Arregla lo que dice el error y vuelve a ejecutar el MISMO comando: '
              'es seguro repetirlo, sustituye los datos de esa semana.' if subiendo else 'No se ha subido nada.')
        return 2
    except KeyboardInterrupt:
        print('\nInterrumpido. Si había empezado a subir, vuelve a ejecutar: es seguro repetirlo.')
        return 1


if __name__ == '__main__':
    sys.exit(main())
