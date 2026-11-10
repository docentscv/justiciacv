"""JusticiaCV · tarjetas de Telegram (imagen + pie + botones).
Requiere Pillow (pip install pillow). Genera una imagen 1080x1350 con el estilo de la web y la
envía con sendPhoto al canal. Uso desde el robot:
    from telegram_tarjetas import tarjeta_adjudicacion, tarjeta_provisional, enviar_tarjeta
    png, pie, kb = tarjeta_adjudicacion(datos); enviar_tarjeta(png, pie, kb)
"""
import io, json, os, uuid, urllib.request
from datetime import date, timedelta
from PIL import Image, ImageDraw, ImageFont

WEB = "https://docentscv.github.io/justiciacv/"
NEMESIS = "https://gvlogin.gva.es/gvlogin/login.xhtml?app=NEMESIS&url=https%3A%2F%2Fnemesis.gva.es%2Fnemesis"
DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
# paleta (misma idea que la web: un color por tipo de oferta)
BG, CARD, INK, MUTED, LINE = "#E8F0EE", "#FFFFFF", "#10231F", "#5B6F6A", "#E3EAE8"
BRAND, VAC, SUS, REF, NONE = "#0F766E", "#2563EB", "#F59E0B", "#DC2626", "#9AA9A5"
OKBG, WARNBG = "#DCF3EC", "#FDEFD0"
CUERPOS = [("TPA", "Tramitación"), ("GPA", "Gestión"), ("AJ", "Auxilio Judicial"), ("MF", "Médicos Forenses")]
PROVS = ["Valencia", "Alicante", "Castellón"]
W, H, S = 1080, 1440, 1


def _font(size, bold=False):
    for p in (["/usr/share/fonts/opentype/inter/Inter-%s.otf" % ("Bold" if bold else "Regular")] +
              ["/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf" % ("-Bold" if bold else "")]):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def _txt(d, xy, s, size, color=INK, bold=False, anchor="la"):
    d.text(xy, s, font=_font(size, bold), fill=color, anchor=anchor)


def _w(s, size, bold=False):
    return _font(size, bold).getlength(s)


def _rr(d, box, r, fill, outline=None):
    d.rounded_rectangle(box, r, fill=fill, outline=outline, width=2 if outline else 0)


def _pill(d, x, y, s, fg, bg, size=26):
    w = _w(s, size, True) + 44
    _rr(d, (x - w, y, x, y + 54), 27, bg)
    _txt(d, (x - w / 2, y + 27), s, size, fg, True, "mm")


def _fecha(f):
    return f"{DIAS[f.weekday()]} {f.day} de {MESES[f.month - 1]}"


def _base(d, c, f, estado, ok):
    _rr(d, (48, 48, W - 48, H - 48), 44, CARD)
    # logo + marca
    _rr(d, (96, 96, 164, 164), 18, BRAND); _txt(d, (130, 130), "J", 44, "#fff", True, "mm")
    _txt(d, (184, 130), "JusticiaCV", 38, INK, True, "lm")
    _pill(d, W - 96, 103, estado, "#0B5D4A" if ok else "#8A5A00", OKBG if ok else WARNBG)
    _txt(d, (96, 236), f"Convocatoria {c}/2026", 74, INK, True)
    _txt(d, (96, 332), _fecha(f), 34, MUTED)


def _kpis(d, y, items):
    n = len(items); gap = 20; w = (W - 192 - gap * (n - 1)) / n
    for i, (num, lab, col) in enumerate(items):
        x = 96 + i * (w + gap)
        _rr(d, (x, y, x + w, y + 190), 28, "#F3F7F6")
        num = str(num); sz = 84 if num.isdigit() else 54
        _txt(d, (x + 28, y + 24 + (0 if num.isdigit() else 22)), num, sz, col, True)
        _txt(d, (x + 28, y + 140), lab, 28, MUTED)


def _stack(d, y, v, s, r):
    _txt(d, (96, y), "Tipo de oferta", 30, MUTED, True)
    tot = max(1, v + s + r); x = 96; bw = W - 192
    _rr(d, (96, y + 54, 96 + bw, y + 98), 22, LINE)
    segs = [(v, VAC, "Vacantes"), (s, SUS, "Sustituciones"), (r, REF, "Refuerzos")]
    x = 96
    for i, (n, col, _) in enumerate([z for z in segs if z[0] > 0]):
        w = bw * n / tot
        d.rounded_rectangle((x, y + 54, x + w - 3, y + 98), 22, fill=col)
        x += w
    lx = 96
    for n, col, name in segs:
        d.ellipse((lx, y + 128, lx + 22, y + 150), fill=col)
        t = f"{name} {n}"; _txt(d, (lx + 34, y + 139), t, 28, INK, False, "lm"); lx += 34 + _w(t, 28) + 34


def _bars(d, x, y, w, title, rows, color):
    _txt(d, (x, y), title, 30, MUTED, True)
    mx = max([n for _, n in rows] + [1]); yy = y + 56
    for name, n in rows:
        _txt(d, (x, yy), name, 28, INK)
        _txt(d, (x + w, yy), str(n), 28, INK, True, "ra")
        _rr(d, (x, yy + 42, x + w, yy + 58), 8, LINE)
        if n: _rr(d, (x, yy + 42, x + max(16, w * n / mx), yy + 58), 8, color)
        yy += 80


def _pie(d):
    _txt(d, (96, H - 118), "docentscv.github.io/justiciacv", 28, BRAND, True, "lm")
    _txt(d, (W - 96, H - 118), "Web independiente · datos oficiales", 24, MUTED, False, "rm")


def _png(img):
    b = io.BytesIO(); img.save(b, "PNG", optimize=True); return b.getvalue()


def tarjeta_provisional(x):
    img = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(img)
    _base(d, x["c"], x["f"], "PROVISIONAL", False)
    lun, mar = x["f"] + timedelta(days=3), x["f"] + timedelta(days=4)
    _kpis(d, 400, [(x["of"], "ofertas", BRAND), ("Lun 10:00", "abre Némesis", INK), (f"Mar {mar.day}", "se adjudica", INK)])
    _stack(d, 640, x["v"], x["s"], x["r"])
    cu = [(n, x["cuerpos"].get(c, 0)) for c, n in CUERPOS]
    _bars(d, 96, 850, 400, "Por cuerpo", cu, BRAND)
    _bars(d, 584, 850, 400, "Por provincia", [(p, x["provs"].get(p, 0)) for p in PROVS], BRAND)
    _pie(d)
    pie = (f"📋 <b>Convocatoria {x['c']}/2026 · listado provisional</b>\n"
           f"{x['of']} ofertas. Pídelas en Némesis del <b>lunes 10:00</b> al <b>martes 9:59</b>; "
           f"se adjudican el {_fecha(mar)}.")
    kb = {"inline_keyboard": [[{"text": "🗺 Ver en el mapa", "url": WEB + "#mapa"}, {"text": "📋 Ofertas", "url": WEB + "#ofertas"}],
                              [{"text": "✍️ Pedir en Némesis", "url": NEMESIS}]]}
    return _png(img), pie, kb


def tarjeta_adjudicacion(x):
    img = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(img)
    sin = x["of"] - x["adj"]; pct = round(100 * x["adj"] / x["of"]) if x["of"] else 0
    _base(d, x["c"], x["f"], "ADJUDICADA", True)
    _kpis(d, 400, [(x["of"], "ofertas", INK), (x["adj"], "adjudicadas", BRAND), (sin, "sin cubrir", SUS if sin else NONE)])
    # barra de cobertura
    _rr(d, (96, 616, W - 96, 640), 12, LINE)
    if pct: _rr(d, (96, 616, 96 + (W - 192) * pct / 100, 640), 12, BRAND)
    _txt(d, (W - 96, 668), f"{pct} % cubiertas", 28, MUTED, True, "ra")
    _stack(d, 710, x["v"], x["s"], x["r"])
    cu = [(n, x["cuerpos"].get(c, 0)) for c, n in CUERPOS]
    _bars(d, 96, 910, 400, "Por cuerpo", cu, BRAND)
    _bars(d, 584, 910, 400, "Por provincia", [(p, x["provs"].get(p, 0)) for p in PROVS], BRAND)
    _pie(d)
    extra = ""
    if sin and x.get("sin_cubrir_pobs"):
        extra = "\n⚠️ Sin cubrir: " + ", ".join(x["sin_cubrir_pobs"][:6])
    pie = (f"✅ <b>Convocatoria {x['c']}/2026 · adjudicación publicada</b>\n"
           f"{x['of']} ofertas · {x['adj']} adjudicadas · {sin} sin cubrir.{extra}\n"
           f"Mira si te ha tocado y hasta dónde llegó tu grupo 👇")
    kb = {"inline_keyboard": [[{"text": "🗺 Dónde han salido", "url": WEB + "#mapa"}, {"text": "👤 Mi puesto", "url": WEB + "#cuenta"}],
                              [{"text": "📊 Datos de la bolsa", "url": WEB + "#datos"}]]}
    return _png(img), pie, kb


def enviar_tarjeta(png, pie, kb, token=None, chat=None):
    token = token or os.environ["TELEGRAM_BOT_TOKEN"]; chat = chat or os.environ["TELEGRAM_CHAT_ID"]
    bnd = uuid.uuid4().hex; parts = []
    for k, v in (("chat_id", chat), ("caption", pie), ("parse_mode", "HTML"), ("reply_markup", json.dumps(kb))):
        parts.append(f'--{bnd}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    parts.append(f'--{bnd}\r\nContent-Disposition: form-data; name="photo"; filename="aviso.png"\r\nContent-Type: image/png\r\n\r\n'.encode() + png + b"\r\n")
    parts.append(f"--{bnd}--\r\n".encode())
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendPhoto", b"".join(parts),
                                 {"Content-Type": f"multipart/form-data; boundary={bnd}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


if __name__ == "__main__":
    base = dict(c=38, of=26, v=2, s=22, r=2, cuerpos={"TPA": 11, "GPA": 5, "AJ": 9, "MF": 1}, provs={"Valencia": 14, "Alicante": 8, "Castellón": 4})
    open("tarjeta_provisional.png", "wb").write(tarjeta_provisional({**base, "f": date(2026, 11, 6)})[0])
    open("tarjeta_adjudicacion.png", "wb").write(tarjeta_adjudicacion({**base, "f": date(2026, 11, 10), "adj": 26})[0])
