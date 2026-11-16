#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
JusticiaCV · avisos al administrador por Telegram (solo para ti, no para el canal).
  python avisar_admin.py fallo   -> el robot ha fallado (avisa en el 1.º fallo seguido y se repite en el 6.º y el 24.º)
  python avisar_admin.py ok      -> el robot ha ido bien; si el anterior había fallado, avisa de que ya se ha recuperado
  python avisar_admin.py martes  -> comprueba que la última convocatoria esté completa (lo usa vigilante_martes.yml)
Variables: TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID. Nunca hace fallar el trabajo de GitHub.
"""
import json, os, sys, urllib.parse, urllib.request
from datetime import date, datetime, timedelta

AVISAR_EN = (1, 6, 24)


def enviar(texto):
    tok, chat = os.environ.get('TELEGRAM_BOT_TOKEN', '').strip(), os.environ.get('TELEGRAM_ADMIN_CHAT_ID', '').strip()
    if not tok or not chat:
        print('AVISO ADMIN: falta TELEGRAM_BOT_TOKEN o TELEGRAM_ADMIN_CHAT_ID; no se manda el mensaje.')
        return False
    datos = urllib.parse.urlencode({'chat_id': chat, 'text': texto, 'disable_web_page_preview': 'true'}).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(f'https://api.telegram.org/bot{tok}/sendMessage', data=datos), timeout=30) as r:
            return json.loads(r.read().decode()).get('ok', False)
    except Exception as e:                                               # noqa: BLE001
        print(f'AVISO ADMIN: no se pudo enviar el mensaje ({type(e).__name__}).')
        return False


def _api(ruta):
    req = urllib.request.Request('https://api.github.com' + ruta, headers={
        'Authorization': 'Bearer ' + os.environ.get('GITHUB_TOKEN', ''), 'Accept': 'application/vnd.github+json', 'User-Agent': 'JusticiaCV-robot'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def previos():
    """Ejecuciones anteriores ya terminadas de este mismo workflow (las más recientes primero), sin las canceladas. None si no se puede saber."""
    repo = os.environ.get('GITHUB_REPOSITORY', '')
    ref = os.environ.get('GITHUB_WORKFLOW_REF', '')            # owner/repo/.github/workflows/robot.yml@refs/heads/main
    if not repo or '/.github/workflows/' not in ref:
        return None
    fichero = ref.split('/.github/workflows/')[1].split('@')[0]
    try:
        d = _api(f'/repos/{repo}/actions/workflows/{fichero}/runs?per_page=30&status=completed')
    except Exception as e:                                               # noqa: BLE001
        print(f'AVISO ADMIN: no se pudo leer el historial de GitHub ({type(e).__name__}).')
        return None
    ahora = os.environ.get('GITHUB_RUN_ID', '')
    return [r for r in d.get('workflow_runs', []) if str(r['id']) != ahora and r.get('conclusion') in ('success', 'failure', 'timed_out')]


def url_ejecucion():
    s, r, i = os.environ.get('GITHUB_SERVER_URL', 'https://github.com'), os.environ.get('GITHUB_REPOSITORY', ''), os.environ.get('GITHUB_RUN_ID', '')
    return f'{s}/{r}/actions/runs/{i}' if r and i else ''


def fallo():
    prev = previos()
    racha = 1
    if prev is not None:
        for r in prev:
            if r['conclusion'] == 'success':
                break
            racha += 1
    if prev is not None and racha not in AVISAR_EN:
        print(f'Fallo n.º {racha} seguido: ya se avisó antes, no se repite el mensaje.')
        return
    extra = '' if racha == 1 else f'\nLlevo {racha} ejecuciones seguidas con error.'
    enviar('⚠️ JusticiaCV: el robot ha fallado.' + extra + '\n\nAbre el registro para ver el motivo (suele ser algo de la web de Justicia o una población nueva):\n' + url_ejecucion())


def ok():
    prev = previos()
    if prev and prev[0]['conclusion'] != 'success':
        enviar('✅ JusticiaCV: el robot vuelve a funcionar (la última pasada ha ido bien).')
    else:
        print('Todo bien; no hace falta avisar.')


def martes():
    url, key = os.environ.get('SUPABASE_URL', '').strip().rstrip('/'), os.environ.get('SUPABASE_SERVICE_KEY', '').strip()
    if not url or not key:
        print('Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY.')
        return
    q = '/rest/v1/convocatorias?select=anio,numero,fecha_publicacion,provisional,adjudicados_cargados,listado_cargado&order=anio.desc,numero.desc&limit=1'
    try:
        with urllib.request.urlopen(urllib.request.Request(url + q, headers={'apikey': key, 'Authorization': 'Bearer ' + key}), timeout=30) as r:
            filas = json.loads(r.read().decode())
    except Exception as e:                                               # noqa: BLE001
        enviar(f'⚠️ JusticiaCV: el vigilante del martes no ha podido consultar la base de datos ({type(e).__name__}).')
        return
    if not filas:
        enviar('⚠️ JusticiaCV: la base de datos no tiene ninguna convocatoria.')
        return
    c = filas[0]
    etiqueta = f"{c['numero']}/{c['anio']}"
    problemas = []
    if c.get('provisional'):
        problemas.append('solo tiene el listado provisional')
    if not c.get('adjudicados_cargados'):
        problemas.append('faltan los adjudicados')
    if not c.get('listado_cargado'):
        problemas.append('falta el listado completo')
    try:
        antigua = datetime.strptime(str(c['fecha_publicacion'])[:10], '%Y-%m-%d').date() < date.today() - timedelta(days=10)
    except Exception:                                                    # noqa: BLE001
        antigua = False
    if antigua:
        problemas.append(f"la última es del {c['fecha_publicacion']}: parece que esta semana no se ha cargado ninguna")
    if problemas:
        enviar(f'⚠️ JusticiaCV, martes 16:00: la convocatoria {etiqueta} está incompleta ({"; ".join(problemas)}).\n'
               'Si Justicia ya publicó los PDF, lanza el robot a mano (Actions > Robot Justicia > Run workflow) o cárgalos en admin.html.')
    else:
        print(f'Convocatoria {etiqueta} completa. Todo en orden.')


if __name__ == '__main__':
    modo = sys.argv[1] if len(sys.argv) > 1 else ''
    try:
        {'fallo': fallo, 'ok': ok, 'martes': martes}[modo]()
    except KeyError:
        print('Uso: avisar_admin.py fallo|ok|martes')
    except Exception as e:                                               # noqa: BLE001
        print(f'AVISO ADMIN: error inesperado ({type(e).__name__}: {str(e)[:150]}).')
    sys.exit(0)
