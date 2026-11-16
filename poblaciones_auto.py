#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
JusticiaCV · alta automática de poblaciones nuevas.
Lee el poblaciones_pendientes.csv que deja importar_semana.py (nombre, provincia del PDF si la hay, lat/lon vacías),
busca cada población en OpenStreetMap (Nominatim) y escribe un CSV completo para volver a lanzar el importador.
Es prudente: si una población no aparece, es ambigua o cae fuera de la Comunitat Valenciana, NO la inventa:
la devuelve en «fallos» y el robot se para como hasta ahora.
"""
import csv, json, math, re, time, urllib.parse, urllib.request

NOMINATIM = 'https://nominatim.openstreetmap.org/search'
UA = 'JusticiaCV-robot/1.0 (+https://github.com/docentscv/justiciacv; alta de poblaciones de la bolsa de Justicia)'
PROVS = ('Alicante', 'Castellón', 'Valencia')
CODIGOS = {'ES-A': 'Alicante', 'ES-CS': 'Castellón', 'ES-V': 'Valencia'}
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = 37.8, 40.8, -1.6, 0.8      # caja de la Comunitat Valenciana (el importador acepta 37..41 / -2..1)
ARTICULOS = r'(el|la|els|les|los|las|l\')'


def sin_tildes(s):
    import unicodedata
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')


def clave(s):
    return re.sub(r'[^a-z0-9]+', ' ', sin_tildes(s).lower()).strip()


def provincia_de_texto(s):
    k = clave(s or '')
    if not k:
        return ''
    if re.search(r'\b(alicante|alacant)\b', k):
        return 'Alicante'
    if re.search(r'\b(castellon|castello)\b', k):
        return 'Castellón'
    if re.search(r'\bvalencia\b', k):
        return 'Valencia'
    return ''


def nombre_visible(nombre):
    """'Campello, el' -> 'El Campello'; 'Alcora, l'' -> 'L'Alcora'. El resto se deja igual."""
    m = re.match(r'^(.*?),\s*' + ARTICULOS + r'$', nombre.strip(), re.I)
    if not m:
        return nombre.strip()
    art = m.group(2)
    art = art[:1].upper() + art[1:]
    return art + m.group(1).strip() if art.endswith("'") else f'{art} {m.group(1).strip()}'


def variantes(nombre):
    """Nombres a buscar: la forma visible y, si es bilingüe 'A/B', cada parte."""
    vis = nombre_visible(nombre)
    out = []
    for parte in re.split(r'\s*/\s*', vis):
        if parte and parte not in out:
            out.append(parte)
    if len(out) > 1 and vis not in out:
        out.append(vis)
    return out


def distancia_km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def pedir_nominatim(q, viewbox=True):
    params = {'q': q, 'format': 'jsonv2', 'addressdetails': 1, 'countrycodes': 'es', 'limit': 8, 'accept-language': 'es'}
    if viewbox:
        params['viewbox'] = f'{LON_MIN},{LAT_MAX},{LON_MAX},{LAT_MIN}'
        params['bounded'] = 1
    req = urllib.request.Request(NOMINATIM + '?' + urllib.parse.urlencode(params), headers={'User-Agent': UA})
    for i in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode('utf-8'))
        except Exception:                                                # noqa: BLE001
            time.sleep(3 * (i + 1))
    raise RuntimeError('Nominatim no responde')


def prov_candidato(c):
    ad = c.get('address') or {}
    for k, v in ad.items():
        if k.startswith('ISO3166-2-lvl') and v in CODIGOS:
            return CODIGOS[v]
    for k in ('province', 'county', 'state_district'):
        p = provincia_de_texto(ad.get(k, ''))
        if p:
            return p
    return provincia_de_texto(c.get('display_name', ''))


def valido(c):
    try:
        lat, lon = float(c['lat']), float(c['lon'])
    except (KeyError, ValueError, TypeError):
        return False
    return LAT_MIN < lat < LAT_MAX and LON_MIN < lon < LON_MAX


def buscar(nombre, prov_pdf='', pedir=pedir_nominatim, pausa=1.1):
    """-> (dict(provincia, lat, lon, fuente) | None, motivo)."""
    vistos = []
    for v in variantes(nombre):
        consultas = [f'{v}, {prov_pdf}, Comunitat Valenciana, España' if prov_pdf else f'{v}, Comunitat Valenciana, España']
        for q in consultas:
            time.sleep(pausa)
            try:
                res = pedir(q) or []
            except Exception as e:                                       # noqa: BLE001
                return None, f'no se pudo consultar OpenStreetMap ({e})'
            for c in res:
                if not valido(c):
                    continue
                tipo = (c.get('type') or '') + ' ' + (c.get('addresstype') or '')
                if re.search(r'\b(house|residential|road|street|building|shop|amenity|bus|station)\b', tipo) and \
                        not re.search(r'(city|town|village|municipality|administrative|hamlet)', tipo):
                    continue
                if clave(v) not in clave(c.get('display_name', '').split(',')[0]) and clave(c.get('name', '')) != clave(v):
                    continue
                vistos.append(c)
        if vistos:
            break
    if not vistos:
        return None, 'no aparece en OpenStreetMap dentro de la Comunitat Valenciana'
    cands = []
    for c in vistos:
        p = prov_candidato(c) or prov_pdf
        if prov_pdf and p and p != prov_pdf:
            continue
        if not p:
            continue
        cands.append((p, float(c['lat']), float(c['lon']), c))
    if not cands:
        return None, 'las coincidencias no cuadran con la provincia del PDF' if prov_pdf else 'no se pudo saber la provincia'
    base = cands[0]
    for p, la, lo, _ in cands[1:]:
        if p != base[0] or distancia_km((base[1], base[2]), (la, lo)) > 10:
            return None, 'hay varias poblaciones con ese nombre (ambiguo)'
    return dict(provincia=base[0], lat=round(base[1], 5), lon=round(base[2], 5), fuente=base[3].get('display_name', '')), ''


def completar(pendientes_csv, salida_csv, extra_csv=None, pedir=pedir_nominatim, pausa=1.1):
    """Escribe salida_csv (lo de extra_csv + lo encontrado). -> (creadas [dict], fallos [(nombre, motivo)])."""
    filas = {}
    if extra_csv:
        try:
            with open(extra_csv, newline='', encoding='utf-8-sig') as f:
                for r in csv.DictReader(f):
                    filas[r['nombre'].strip()] = r
        except FileNotFoundError:
            pass
    creadas, fallos = [], []
    with open(pendientes_csv, newline='', encoding='utf-8-sig') as f:
        pend = list(csv.DictReader(f))
    for r in pend:
        n = r['nombre'].strip()
        if n in filas:
            continue
        prov = (r.get('provincia') or '').strip()
        if prov not in PROVS:
            prov = ''
        if r.get('lat') and r.get('lon') and prov:                        # ya vienen rellenadas
            filas[n] = r
            continue
        hallado, motivo = buscar(n, prov, pedir, pausa)
        if not hallado:
            fallos.append((n, motivo))
            continue
        filas[n] = dict(nombre=n, nombre_visible=(r.get('nombre_visible') or '').strip() if (r.get('nombre_visible') or '').strip() != n else nombre_visible(n),
                        provincia=hallado['provincia'], lat=hallado['lat'], lon=hallado['lon'])
        creadas.append(dict(filas[n], fuente=hallado['fuente']))
    with open(salida_csv, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(['nombre', 'nombre_visible', 'provincia', 'lat', 'lon'])
        for r in filas.values():
            w.writerow([r['nombre'], r.get('nombre_visible') or r['nombre'], r['provincia'], r['lat'], r['lon']])
    return creadas, fallos
