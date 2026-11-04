#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
JusticiaCV · avisos del robot.
Lo llama robot_justicia.py después de cada pasada. Mira la última convocatoria de la base de datos y:
  - si es el listado PROVISIONAL del viernes  -> aviso «ofertas» (nuevas ofertas en tus zonas)
  - si ya tiene adjudicados y listado completo -> aviso «martes» (resumen / cerca del corte)
Solo envía una vez cada aviso por convocatoria (lo apunta en la tabla avisos_enviados).
Envía: avisos al móvil/navegador (Web Push, a quien los haya activado) y, si están los secretos, un mensaje al canal de Telegram.
Variables: SUPABASE_URL, SUPABASE_SERVICE_KEY, VAPID_PRIVATE_KEY (obligatoria para los avisos al móvil),
           VAPID_SUBJECT (opcional), TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID (opcionales), JCV_WEB (opcional).
No imprime nombres ni datos personales: solo cuántos avisos se envían.
"""
import json, os, sys

WEB = os.environ.get('JCV_WEB', 'https://docentscv.github.io/justiciacv/')
SUJETO = os.environ.get('VAPID_SUBJECT', 'mailto:DocentsCV@gmail.com')


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
    f = _api('GET', 'convocatorias?select=id,anio,numero,provisional,adjudicados_cargados,listado_cargado&order=anio.desc,numero.desc&limit=1')
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
    if ya_enviado(c['id'], tipo):
        print(f'Avisos: «{tipo}» de la convocatoria {c["numero"]} ya se envió.')
        return 0
    filas = _api('POST', 'rpc/avisos_preparar', json={'p_conv': c['id'], 'p_tipo': tipo}) or []
    print(f'Avisos «{tipo}» de la convocatoria {c["numero"]}: {len(filas)} dispositivo(s) a avisar.')
    if simulacro:
        for f in filas:
            print('  [simulacro]', f['titulo'], '|', f['cuerpo'].replace('\n', ' / '))
        return 0
    if filas and not os.environ.get('VAPID_PRIVATE_KEY'):
        print('Falta el secreto VAPID_PRIVATE_KEY en GitHub: no se envía nada todavía (se enviará cuando esté).')
        return 0
    ok, muertos = enviar_push(filas, '#ofertas' if tipo == 'ofertas' else '#cuenta') if filas else (0, 0)
    tg = enviar_telegram(texto_telegram(c, tipo))
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
