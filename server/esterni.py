"""Dati da internet per la pagina Oggi: meteo (Open-Meteo) e notizie (Google News e feed RSS).

Servizi gratuiti, senza registrazione né chiavi. Le richieste partono dal server di Plancia
(la pagina resta chiusa verso l'esterno) e i risultati restano in memoria per un po'.
Se internet non risponde, la pagina Oggi funziona lo stesso e mostra un avviso.
"""
import email.utils
import json
import re
import threading
import time
import xml.etree.ElementTree as ET
from html import unescape
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

from .crud import ValidationError

TIMEOUT = 8
MAX_BYTES = 2 * 1024 * 1024
WEATHER_TTL = 20 * 60
NEWS_TTL = 30 * 60
NEWS_PER_SECTION = 8
UA = "Plancia/1.0 (cruscotto personale)"

_cache = {}
_lock = threading.Lock()

# codici meteo WMO → (descrizione, icona)
WMO = {
    0: ("Sereno", "sole"), 1: ("Poco nuvoloso", "sole-nuvola"), 2: ("Parzialmente nuvoloso", "sole-nuvola"), 3: ("Coperto", "nuvola"),
    45: ("Nebbia", "nebbia"), 48: ("Nebbia con brina", "nebbia"),
    51: ("Pioviggine debole", "pioggia"), 53: ("Pioviggine", "pioggia"), 55: ("Pioviggine intensa", "pioggia"),
    56: ("Pioviggine gelata", "pioggia"), 57: ("Pioviggine gelata", "pioggia"),
    61: ("Pioggia debole", "pioggia"), 63: ("Pioggia", "pioggia"), 65: ("Pioggia forte", "pioggia"),
    66: ("Pioggia gelata", "pioggia"), 67: ("Pioggia gelata forte", "pioggia"),
    71: ("Neve debole", "neve"), 73: ("Neve", "neve"), 75: ("Neve forte", "neve"), 77: ("Nevischio", "neve"),
    80: ("Rovesci deboli", "pioggia"), 81: ("Rovesci", "pioggia"), 82: ("Rovesci violenti", "pioggia"),
    85: ("Rovesci di neve", "neve"), 86: ("Rovesci di neve forti", "neve"),
    95: ("Temporale", "temporale"), 96: ("Temporale con grandine", "temporale"), 99: ("Temporale con grandine", "temporale"),
}


def _fetch(url):
    """Scarica una risorsa http(s) con limiti di tempo e dimensione."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ValidationError("Indirizzo non valido")
    req = Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urlopen(req, timeout=TIMEOUT) as r:  # noqa: S310 (solo http/https, controllato sopra)
        data = r.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValidationError("Risposta troppo grande")
    return data


# le prove sostituiscono questa funzione con risposte d'esempio
fetch = _fetch


def _cached(key, ttl, fn, refresh=False):
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and not refresh and now - hit[0] < ttl:
            return hit[1]
    value = fn()
    with _lock:
        _cache[key] = (now, value)
    return value


def clear_cache():
    with _lock:
        _cache.clear()


# ---------------------------------------------------------------- meteo

def search_places(q):
    """Cerca una località (per scegliere la città del meteo)."""
    q = (q or "").strip()
    if len(q) < 2:
        return []
    data = json.loads(fetch(f"https://geocoding-api.open-meteo.com/v1/search?name={quote(q)}&count=8&language=it&format=json"))
    out = []
    for r in data.get("results") or []:
        try:
            out.append({"name": str(r["name"]), "region": str(r.get("admin1") or ""), "country": str(r.get("country") or ""),
                        "lat": round(float(r["latitude"]), 4), "lon": round(float(r["longitude"]), 4)})
        except (KeyError, TypeError, ValueError):
            continue
    return out


def _wmo(code):
    try:
        text, ic = WMO.get(int(code), ("", "nuvola"))
    except (TypeError, ValueError):
        text, ic = "", "nuvola"
    return {"code": code, "text": text, "icon": ic}


def weather(place, refresh=False):
    """Meteo attuale e previsione di oggi e domani per la località scelta."""
    if not place or "lat" not in place or "lon" not in place:
        return {"place": None}
    lat, lon = float(place["lat"]), float(place["lon"])

    def load():
        url = (f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
               "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m"
               "&hourly=temperature_2m,weather_code,precipitation_probability"
               "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset"
               "&timezone=auto&forecast_days=2")
        d = json.loads(fetch(url))
        cur, daily, hourly = d.get("current") or {}, d.get("daily") or {}, d.get("hourly") or {}

        def day(i):
            pick = lambda k: (daily.get(k) or [None] * 2)[i] if len(daily.get(k) or []) > i else None
            return {"date": pick("time"), "max": pick("temperature_2m_max"), "min": pick("temperature_2m_min"),
                    "rain": pick("precipitation_probability_max"), "sunrise": (pick("sunrise") or "")[11:16],
                    "sunset": (pick("sunset") or "")[11:16], **_wmo(pick("weather_code"))}

        now = (cur.get("time") or "")[:13]
        hours = []
        times = hourly.get("time") or []
        start = next((i for i, t in enumerate(times) if t[:13] >= now), 0) if now else 0
        for i in range(start, min(start + 12, len(times)), 3):  # prossime ore, ogni 3
            hours.append({"time": times[i][11:16], "temp": (hourly.get("temperature_2m") or [None] * len(times))[i],
                          "rain": (hourly.get("precipitation_probability") or [None] * len(times))[i],
                          **_wmo((hourly.get("weather_code") or [None] * len(times))[i])})
        return {
            "place": place,
            "current": {"temp": cur.get("temperature_2m"), "feels": cur.get("apparent_temperature"),
                        "humidity": cur.get("relative_humidity_2m"), "wind": cur.get("wind_speed_10m"), **_wmo(cur.get("weather_code"))},
            "today": day(0), "tomorrow": day(1), "hours": hours, "updated": time.strftime("%H:%M"),
        }

    return _cached(("meteo", lat, lon), WEATHER_TTL, load, refresh)


# ---------------------------------------------------------------- notizie

def topic_feed(topic):
    return f"https://news.google.com/rss/search?q={quote(topic)}&hl=it&gl=IT&ceid=IT:it"


def _text(el):
    return unescape(re.sub(r"<[^>]+>", " ", el.text or "")).strip() if el is not None else ""


def parse_feed(data):
    """RSS 2.0 o Atom → elenco di notizie (titolo, link, fonte, data)."""
    text = data.decode("utf-8", "replace") if isinstance(data, bytes) else data
    if "<!DOCTYPE" in text[:2000].upper() or "<!ENTITY" in text[:5000].upper():
        raise ValidationError("Feed non valido")  # niente entità: protezione dai feed costruiti ad arte
    root = ET.fromstring(text)
    items = []
    ns = {"a": "http://www.w3.org/2005/Atom"}
    for it in root.iter("item"):
        title, link = _text(it.find("title")), (it.findtext("link") or "").strip()
        source = _text(it.find("source"))
        if source and title.endswith(f" - {source}"):
            title = title[: -len(source) - 3]
        pub = it.findtext("pubDate") or ""
        try:
            when = email.utils.parsedate_to_datetime(pub).isoformat() if pub else ""
        except (TypeError, ValueError):
            when = ""
        items.append({"title": title, "link": link, "source": source, "published": when})
    for it in root.iter("{http://www.w3.org/2005/Atom}entry"):
        link_el = it.find("a:link[@rel='alternate']", ns)
        if link_el is None:
            link_el = it.find("a:link", ns)
        items.append({"title": _text(it.find("a:title", ns)), "link": (link_el.get("href") if link_el is not None else "") or "",
                      "source": "", "published": it.findtext("a:updated", default="", namespaces=ns)})
    # solo collegamenti web veri, niente doppioni
    out, seen = [], set()
    for x in items:
        if not x["title"] or not re.match(r"^https?://", x["link"], re.I) or x["link"] in seen:
            continue
        seen.add(x["link"])
        out.append(x)
    return out


def news(topics, feeds, refresh=False):
    """Una sezione per ogni interesse (ricerca su Google News) e per ogni feed RSS aggiunto."""
    sources = [{"key": f"t:{t}", "title": t, "url": topic_feed(t)} for t in topics]
    sources += [{"key": f"f:{f['url']}", "title": f.get("name") or urlsplit(f["url"]).hostname, "url": f["url"]} for f in feeds]
    sections, errors = [], []
    for s in sources:
        try:
            items = _cached(("news", s["url"]), NEWS_TTL, lambda u=s["url"]: parse_feed(fetch(u)), refresh)
            sections.append({"key": s["key"], "title": s["title"], "items": items[:NEWS_PER_SECTION]})
        except Exception as e:  # una fonte che non risponde non blocca le altre
            errors.append({"title": s["title"], "error": str(e)[:200] or "non raggiungibile"})
    return {"sections": sections, "errors": errors, "updated": time.strftime("%H:%M")}
