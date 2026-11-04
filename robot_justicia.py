#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
JusticiaCV · robot.
Mira la página de Justicia donde se publican las ofertas, baja los PDF de la convocatoria vigente y,
si traen algo que la base de datos aún no tiene, los carga con importar_semana.py:
  viernes  -> «2. Listado provisional de ofertas»            (solo ofertas, para verlas antes de pedir)
  martes   -> 5. listado definitivo + 7. adjudicados + 8. listado completo
Es un script normal (no es una IA) y se identifica con su User-Agent. Pide solo la página y los PDF publicados.

Después de cada pasada llama a avisos.py (avisos al móvil y Telegram, una sola vez por convocatoria).
Códigos de salida: 0 = hecho o nada que hacer · 1 = algo ha fallado (GitHub te avisa por correo).
Variables: SUPABASE_URL, SUPABASE_SERVICE_KEY (en GitHub: Settings > Secrets and variables > Actions).
"""
import importlib.util, os, re, sys, tempfile, time, urllib.parse
from pathlib import Path

PAGINA = os.environ.get('JCV_PAGINA', 'https://cjusticia.gva.es/es/web/justicia/adjudicacio-ofertes-ocupacio')
UA = 'JusticiaCV-robot/1.0 (+https://github.com/docentscv/justiciacv; consulta de listados publicos)'
AQUI = Path(__file__).resolve().parent


def pedir(url, binario=False):
    import requests
    ultimo = None
    for i in range(4):
        try:
            r = requests.get(url, headers={'User-Agent': UA, 'Accept-Language': 'es'}, timeout=60)
            if r.status_code == 200:
                return r.content if binario else r.text
            ultimo = f'HTTP {r.status_code}'
            if r.status_code in (401, 403, 404):
                break
        except Exception as e:
            ultimo = type(e).__name__
        time.sleep(3 * (i + 1))
    raise RuntimeError(f'No se pudo descargar {url.split("?")[0]} ({ultimo}).')


def enlaces_pdf(html):
    """[(nombre, url)] de los PDF de /documents/ que pueden ser listados (el importador reconoce cada uno por su contenido)."""
    out, vistos = [], set()
    for m in re.finditer(r'href="([^"]*/documents/[^"]+?\.pdf[^"]*)"', html, re.I):
        url = urllib.parse.urljoin(PAGINA, m.group(1).replace('&amp;', '&'))
        ruta = urllib.parse.unquote(urllib.parse.urlparse(url).path)
        partes = ruta.split('/documents/')[1].split('/')
        nombre = partes[2] if len(partes) > 3 else partes[-1]           # /documents/<sitio>/<carpeta>/<fichero>.pdf/<uuid>
        if re.match(r'^1\.', nombre) or re.search(r'instrucc|declaraci|domicili|incidencia|irpf|resoluci|proper', nombre, re.I):
            continue                                                       # resolución, instrucciones y formularios: no son listados
        if url in vistos:
            continue
        vistos.add(url)
        out.append((nombre, url))
    return out


def avisos():
    """Después de cada pasada: avisos al móvil y Telegram si toca (una sola vez por convocatoria)."""
    try:
        spec = importlib.util.spec_from_file_location('avisos', AQUI / 'avisos.py')
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod.main()
    except Exception as e:                                              # noqa: BLE001
        print(f'AVISOS: ha fallado ({type(e).__name__}: {str(e)[:200]}). La carga de datos no se ve afectada.')
        return 1


def main():
    if not os.environ.get('SUPABASE_URL') or not os.environ.get('SUPABASE_SERVICE_KEY'):
        print('ERROR: faltan los secretos SUPABASE_URL y SUPABASE_SERVICE_KEY en GitHub.')
        return 1
    try:
        html = pedir(PAGINA)
    except RuntimeError as e:
        print('ERROR:', e, '\nSi esto se repite, la web de Justicia puede estar bloqueando a GitHub: carga los PDF a mano en admin.html.')
        return 1
    pdfs = enlaces_pdf(html)
    print(f'PDF candidatos en la página: {len(pdfs)}')
    for n, _ in pdfs:
        print('  -', n)
    if not pdfs:
        print('No hay PDF de listados publicados ahora mismo (o la página ha cambiado de formato). Nada que hacer.')
        return avisos()
    carpeta = Path(tempfile.mkdtemp(prefix='jcv_'))
    for n, u in pdfs:
        try:
            datos = pedir(u, binario=True)
        except RuntimeError as e:
            print('ERROR:', e)
            return 1
        if not datos.startswith(b'%PDF'):
            print(f'  (se ignora «{n}»: no es un PDF)')
            continue
        (carpeta / re.sub(r'[^\w.\- ]', '_', n)).write_bytes(datos)
    spec = importlib.util.spec_from_file_location('importar_semana', AQUI / 'importar_semana.py')
    imp = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(imp)
    args = [str(carpeta), '--si', '--solo-si-nuevo']
    extra = AQUI / 'poblaciones_nuevas.csv'                          # poblaciones que aún no están en la base (con su provincia y coordenadas)
    if extra.exists():
        args += ['--poblaciones', str(extra)]
    cod = imp.main(args)
    if cod == 10:
        print('\nSin novedades.')
        return avisos()
    if cod == 0:
        print('\nCARGA HECHA.')
        return avisos()
    print(f'\nEl importador ha terminado con código {cod}: revisa el mensaje de arriba. Puedes cargar los PDF a mano en admin.html.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
