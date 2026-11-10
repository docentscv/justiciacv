#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
JusticiaCV · avisos del robot.
Lo llama robot_justicia.py después de cada pasada. Mira la última convocatoria de la base de datos y:
  - si es el listado PROVISIONAL del viernes  -> aviso «ofertas» (nuevas ofertas en tus zonas)
  - si ya tiene adjudicados y listado completo -> aviso «martes» (resumen / cerca del corte)
Solo envía una vez cada aviso por convocatoria (lo apunta en la tabla avisos_enviados).
Envía: avisos al móvil/navegador (Web Push, a quien los haya activado) y, si están los secretos, una TARJETA (imagen + botones)
al canal de Telegram (telegram_tarjetas.py). Si la tarjeta fallase, manda el mensaje de texto de siempre.
Variables: SUPABASE_URL, SUPABASE_SERVICE_KEY, VAPID_PRIVATE_KEY (obligatoria para los avisos al móvil),
           JCV_REENVIAR_TELEGRAM=1 (reenvía solo la tarjeta a Telegram), VAPID_SUBJECT (opcional), TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID (opcionales), JCV_WEB (opcional).
No imprime nombres ni datos personales: solo cuántos avisos se envían.
"""
import json, os, sys
from datetime import datetime
from pathlib import Path

WEB = os.environ.get('JCV_WEB', 'https://docentscv.github.io/justiciacv/')
SUJETO = os.environ.get('VAPID_SUBJECT', 'mailto:DocentsCV@gmail.com')
AQUI = Path(__file__).resolve().parent
if str(AQUI) not in sys.path:
    sys.path.insert(0, str(AQUI))                    # para poder importar telegram_tarjetas.py (robot_justicia.py carga este archivo por ruta)


def _cab():
    k = os.environ['SUPABASE_SERVICE_KEY']
    h = {'apikey': k, 'Content-Type': 'application/json'}
    if k.startswith('eyJ'):              # clave antigua (JWT); las nuevas sb_secret_ no van en Authorization
        h['Authorization'] = 'Bearer ' + k
    return h


def _api(metodo, ruta, **kw):
    import requests
    base = os.environ['SUPABASE_URL'].rstrip('/')
    r = requests.request(metodo, base + '/rest/v1/' + ruta, headers={**_cab(), **kw.pop('headers', {})}, timeout=60, **kw)
    if r.status_code >= 300:
        raise RuntimeError(f'Supabase {metodo} {ruta.split("?")[0]} -> HTTP {r.status_code}: {r.text[:200]}')
    return r.json() if r.text else None


def ultima_convocatoria():
    f = _api('GET', 'convocatorias?select=id,anio,numero,fecha_publicacion,provisional,adjudicados_cargados,listado_cargado&order=anio.desc,numero.desc&limit=1')
    return f[0] if f else None


def tipo_pendiente(c):
    """Qué aviso toca para esa convocatoria (o None)."""
    if c.get('provisional'):
        return 'ofertas'
    if c.get('adjudicados_cargados') and c.get('listado_cargado'):
        return 'martes'
    return None


def ya_enviado(conv_id, tipo):
    return bool(_api('GET', f'avisos_enviados?select=tipo&convocatoria_id=eq.{conv_id}&tipo=eq.{tipo}'))


def cifras(conv_id):
    f = _api('GET', f'ofertas?select=id,adjudicaciones(grupo)&convocatoria_id=eq.{conv_id}&limit=5000')
    adj = sum(1 for o in f if o.get('adjudicaciones'))
    return len(f), adj


# ---------- desglose para la tarjeta (tipo, cuerpo, provincia, grupo). Tolerante: lo que no encuentre queda a 0 ----------
def _pick(o, *claves):
    for k in claves:
        if k in o and o[k] is not None:
            return o[k]
    return None


def _tipo(v):
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, int):
        return {0: 'v', 1: 's', 2: 'r'}.get(v)
    t = str(v).lower()
    return 'v' if t.startswith('vac') else 's' if t.startswith('sus') else 'r' if t.startswith('ref') else None


def _cuerpo(v):
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, int):
        return {0: 'TPA', 1: 'GPA', 2: 'AJ', 3: 'MF'}.get(v)
    t = str(v).strip().upper()
    if t in ('TPA', 'GPA', 'AJ', 'MF'):
        return t
    t = t.lower()
    return 'TPA' if 'tramit' in t else 'GPA' if 'gesti' in t else 'AJ' if 'auxil' in t else 'MF' if 'forens' in t else None


def _prov(v):
    if isinstance(v, list):
        v = v[0] if v else None
    if isinstance(v, dict):
        v = _pick(v, 'provincia', 'provincia_nombre')
    if not v:
        return None
    t = str(v).lower()
    return 'Alicante' if 'alic' in t else 'Castellón' if 'cast' in t else 'Valencia' if 'val' in t else None


def desglose(conv_id):
    d = {'v': 0, 's': 0, 'r': 0, 'cuerpos': {}, 'provs': {}, 'grupos': {}, 'sin_cubrir_pobs': []}
    filas = None
    for sel in ('*,adjudicaciones(grupo),poblaciones(nombre,nombre_visible,provincia)',
                '*,adjudicaciones(grupo),poblaciones(nombre,provincia)', '*,adjudicaciones(grupo)', '*'):
        try:
            filas = _api('GET', f'ofertas?select={sel}&convocatoria_id=eq.{conv_id}&limit=5000')
            break
        except RuntimeError:
            continue
    if not filas:
        return d
    for o in filas:
        t = _tipo(_pick(o, 'tipo', 'tipo_oferta', 'tipo_id'))
        if t:
            d[t] += 1
        cu = _cuerpo(_pick(o, 'cuerpo', 'cuerpo_codigo', 'cuerpo_id', 'denominacion'))
        if cu:
            d['cuerpos'][cu] = d['cuerpos'].get(cu, 0) + 1
        pv = _prov(_pick(o, 'poblaciones', 'provincia'))
        if pv:
            d['provs'][pv] = d['provs'].get(pv, 0) + 1
        adj = o.get('adjudicaciones')
        if isinstance(adj, dict):
            adj = [adj]
        for a in adj or []:
            g = a.get('grupo') if isinstance(a, dict) else None
            if g:
                d['grupos'][g] = d['grupos'].get(g, 0) + 1
        if 'adjudicaciones' in o and not adj:          # sin adjudicar (la API devuelve [] o null según la relación)
            p = o.get('poblaciones')
            p = p[0] if isinstance(p, list) and p else p
            nom = _pick(p, 'nombre_visible', 'nombre') if isinstance(p, dict) else None
            if nom and nom not in d['sin_cubrir_pobs']:
                d['sin_cubrir_pobs'].append(nom)
    print(f'Desglose para la tarjeta: tipos {d["v"]}/{d["s"]}/{d["r"]} · cuerpos {sum(d["cuerpos"].values())} · provincias {sum(d["provs"].values())} (de {len(filas)} ofertas).')
    return d


def texto_telegram(c, tipo):
    n, adj = cifras(c['id'])
    num = c['numero']
    if tipo == 'ofertas':
        return (f'📋 Convocatoria {num}/{c["anio"]}: listado provisional con {n} ofertas.\n'
                f'Se piden en Némesis de lunes 10:00 a martes 9:59.\n'
                f'Míralas en el mapa y por zonas: {WEB}#mapa')
    return (f'✅ Convocatoria {num}/{c["anio"]}: adjudicación publicada.\n'
            f'{n} ofertas · {adj} adjudicadas · {n - adj} sin cubrir.\n'
            f'Consulta dónde han salido: {WEB}#mapa')


def enviar_telegram(texto):
    tok, chat = os.environ.get('TELEGRAM_BOT_TOKEN'), os.environ.get('TELEGRAM_CHAT_ID')
    if not tok or not chat:
        print('Telegram: sin configurar (opcional).')
        return 0
    import requests
    r = requests.post(f'https://api.telegram.org/bot{tok}/sendMessage',
                      json={'chat_id': chat, 'text': texto, 'disable_web_page_preview': True}, timeout=30)
    print('Telegram:', 'enviado' if r.ok else f'ERROR HTTP {r.status_code}')
    return 1 if r.ok else 0


def enviar_telegram_tarjeta(c, tipo):
    """Tarjeta (imagen + pie + botones). Si algo falla, cae al mensaje de texto de siempre."""
    if not os.environ.get('TELEGRAM_BOT_TOKEN') or not os.environ.get('TELEGRAM_CHAT_ID'):
        print('Telegram: sin configurar (opcional).')
        return 0
    try:
        from telegram_tarjetas import tarjeta_provisional, tarjeta_adjudicacion, enviar_tarjeta
        n, adj = cifras(c['id'])
        try:                                                              # fecha de la convocatoria (así un reenvío tardío no pone la fecha de hoy)
            f = datetime.strptime(str(c.get('fecha_publicacion'))[:10], '%Y-%m-%d').date()
        except ValueError:
            f = datetime.now().date()
        datos = {**desglose(c['id']), 'c': c['numero'], 'of': n, 'adj': adj, 'f': f}
        png, pie, kb = (tarjeta_provisional if tipo == 'ofertas' else tarjeta_adjudicacion)(datos)
        res = enviar_tarjeta(png, pie, kb)
        if res.get('ok'):
            print('Telegram: tarjeta enviada')
            return 1
        raise RuntimeError(str(res)[:150])
    except Exception as e:                                               # noqa: BLE001
        print(f'Telegram: la tarjeta ha fallado ({type(e).__name__}: {str(e)[:150]}); se manda el mensaje de texto.')
        return enviar_telegram(texto_telegram(c, tipo))


def enviar_push(filas, url_hash):
    """filas: lo que devuelve avisos_preparar. Devuelve (enviados, caducados)."""
    clave = os.environ.get('VAPID_PRIVATE_KEY')
    if not clave:
        print('Avisos al móvil: falta el secreto VAPID_PRIVATE_KEY, no se envía ninguno.')
        return 0, 0
    from pywebpush import webpush, WebPushException
    ok, muertos = 0, []
    for f in filas:
        datos = json.dumps({'title': f['titulo'], 'body': f['cuerpo'], 'url': WEB + url_hash}, ensure_ascii=False)
        try:
            webpush(subscription_info={'endpoint': f['endpoint'], 'keys': {'p256dh': f['p256dh'], 'auth': f['auth']}},
                    data=datos, vapid_private_key=clave, vapid_claims={'sub': SUJETO}, ttl=60 * 60 * 24 * 2)
            ok += 1
        except WebPushException as e:
            st = getattr(getattr(e, 'response', None), 'status_code', None)
            if st in (404, 410):
                muertos.append(f['endpoint'])
            else:
                print(f'  aviso no enviado (HTTP {st}).')
        except Exception as e:                                   # noqa: BLE001
            print(f'  aviso no enviado ({type(e).__name__}).')
    import urllib.parse
    for ep in muertos:
        try:
            _api('DELETE', 'push_subs?endpoint=eq.' + urllib.parse.quote(ep, safe=''))
        except RuntimeError:
            pass
    return ok, len(muertos)


def main(simulacro=False):
    if not os.environ.get('SUPABASE_URL') or not os.environ.get('SUPABASE_SERVICE_KEY'):
        print('Avisos: faltan SUPABASE_URL / SUPABASE_SERVICE_KEY.')
        return 1
    c = ultima_convocatoria()
    if not c:
        print('Avisos: no hay convocatorias.')
        return 0
    tipo = tipo_pendiente(c)
    if not tipo:
        print(f'Avisos: la convocatoria {c["numero"]} aún no está completa; nada que avisar.')
        return 0
    if os.environ.get('JCV_REENVIAR_TELEGRAM') == '1':               # reenvío manual: solo la tarjeta a Telegram, sin móvil y sin marcar nada
        print(f'Reenvío manual a Telegram de «{tipo}» (convocatoria {c["numero"]}).')
        enviar_telegram_tarjeta(c, tipo)
        return 0
    if ya_enviado(c['id'], tipo):
        print(f'Avisos: «{tipo}» de la convocatoria {c["numero"]} ya se envió.')
        return 0
    filas = _api('POST', 'rpc/avisos_preparar', json={'p_conv': c['id'], 'p_tipo': tipo}) or []
    print(f'Avisos «{tipo}» de la convocatoria {c["numero"]}: {len(filas)} dispositivo(s) a avisar.')
    if simulacro:
        for f in filas:
            print('  [simulacro]', f['titulo'], '|', f['cuerpo'].replace('\n', ' / '))
        d = desglose(c['id'])
        print('  [simulacro] desglose:', json.dumps(d, ensure_ascii=False))
        return 0
    if filas and not os.environ.get('VAPID_PRIVATE_KEY'):
        print('Falta el secreto VAPID_PRIVATE_KEY en GitHub: no se envía nada todavía (se enviará cuando esté).')
        return 0
    ok, muertos = enviar_push(filas, '#ofertas' if tipo == 'ofertas' else '#cuenta') if filas else (0, 0)
    tg = enviar_telegram_tarjeta(c, tipo)
    if filas and not ok and os.environ.get('VAPID_PRIVATE_KEY'):
        print('No se ha podido enviar ningún aviso; no se marca como enviado, se reintentará en la próxima pasada.')
        return 1
    _api('POST', 'avisos_enviados?on_conflict=convocatoria_id,tipo',
         json={'convocatoria_id': c['id'], 'tipo': tipo, 'destinatarios': ok},
         headers={'Prefer': 'resolution=merge-duplicates,return=minimal'})
    print(f'Avisos enviados: {ok} · dispositivos caducados eliminados: {muertos} · Telegram: {"sí" if tg else "no"}.')
    return 0


if __name__ == '__main__':
    sys.exit(main(simulacro='--simulacro' in sys.argv))
