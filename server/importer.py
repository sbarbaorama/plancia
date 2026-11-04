"""Analisi di mail e appuntamenti di Outlook: testo incollato, file .eml e .ics.

Non scrive nulla nel database: restituisce un dizionario normalizzato che l'interfaccia
usa per precompilare un editor. Solo libreria standard.
"""
import base64
import binascii
import html
import logging
import re
from datetime import date, datetime, timedelta, timezone
from email import policy
from email.parser import BytesParser
from email.utils import getaddresses, parseaddr

MAX_BYTES = 5 * 1024 * 1024
MAX_BODY = 10_000
FMT = "%Y-%m-%dT%H:%M"
log = logging.getLogger("plancia.importer")


class ImportError_(ValueError):
    """Contenuto non importabile. Il messaggio è in italiano."""


def _result(**values):
    base = {
        "kind": "mail", "subject": "", "sender": "", "sender_email": "", "sent_at": None, "to": "",
        "start": None, "end": None, "all_day": False, "location": "", "body": "", "events_in_file": 0,
    }
    base.update(values)
    base["body"] = _clean_body(base["body"])[:MAX_BODY]
    base["subject"] = (base["subject"] or "").strip()[:300]
    return base


def _clean_body(text):
    lines = [ln.rstrip() for ln in (text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    out = "\n".join(lines).strip("\n")
    return re.sub(r"\n{3,}", "\n\n", out).strip()


# ---------------------------------------------------------------- date nel testo

MONTHS = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6, "luglio": 7,
    "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12,
    "gen": 1, "feb": 2, "mar": 3, "apr": 4, "mag": 5, "giu": 6, "lug": 7, "ago": 8, "set": 9, "sett": 9,
    "ott": 10, "nov": 11, "dic": 12,
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
    "jan": 1, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "sept": 9, "oct": 10, "dec": 12,
}
_TIME = r"(\d{1,2})[:.](\d{2})\s*([AaPp]\.?[Mm]\.?)?"
_RANGE = rf"(?:\s*(?:,|alle|ore|dalle|dal|at|from)?\s*{_TIME})?(?:\s*[-–—]\s*{_TIME})?"
MAX_DATE_TEXT = 300  # i valori delle intestazioni sono brevi: si limita il lavoro delle regex


def _normalize_times(text):
    """'ore 15' → 'ore 15:00'; '15:00 alle 16:30' → '15:00-16:30'."""
    s = re.sub(r"(?i)\b(ore|alle|dalle|h)\s+(\d{1,2})(?![\d:.])", r"\1 \2:00", text)
    return re.sub(r"(?i)(\d{1,2}[:.]\d{2})\s*(?:alle|al|fino alle|to|until)\s*(\d{1,2}[:.]\d{2})", r"\1-\2", s)
_RE_IT = re.compile(rf"(\d{{1,2}})\s+([A-Za-zÀ-ÿ]+)\.?\s+(\d{{4}}){_RANGE}")
_RE_EN = re.compile(rf"([A-Za-z]+)\.?\s+(\d{{1,2}}),?\s+(\d{{4}}){_RANGE}")
_RE_NUM = re.compile(rf"(\d{{1,2}})/(\d{{1,2}})/(\d{{4}}){_RANGE}")
_RE_ISO = re.compile(rf"(\d{{4}})-(\d{{2}})-(\d{{2}})(?:[T ]{_TIME})?")


def _hm(h, m, ampm):
    h, m = int(h), int(m)
    if ampm:
        pm = ampm.lower().startswith("p")
        if h == 12:
            h = 0 if not pm else 12
        elif pm:
            h += 12
    if not (0 <= h <= 23 and 0 <= m <= 59):
        raise ValueError
    return h, m


def parse_date_text(text):
    """'lunedì 3 novembre 2026 15:00-16:30' → ('2026-11-03T15:00', '2026-11-03T16:30', False).

    Senza orario: giornata intera ('…T00:00', '…T23:59', True). Non riconosciuta: (None, None, False).
    """
    if not text:
        return None, None, False
    text = _normalize_times(text[:MAX_DATE_TEXT])
    for regex, order in ((_RE_ISO, "ymd"), (_RE_NUM, "dmy"), (_RE_IT, "d_month_y"), (_RE_EN, "month_d_y")):
        for m in regex.finditer(text):
            g = m.groups()
            try:
                if order == "ymd":
                    y, mo, d = int(g[0]), int(g[1]), int(g[2])
                    t1, t2 = g[3:6], (None, None, None)
                elif order == "dmy":
                    d, mo, y = int(g[0]), int(g[1]), int(g[2])
                    t1, t2 = g[3:6], g[6:9]
                elif order == "d_month_y":
                    mo = MONTHS.get(g[1].lower().rstrip("."))
                    if not mo:
                        continue
                    d, y = int(g[0]), int(g[2])
                    t1, t2 = g[3:6], g[6:9]
                else:
                    mo = MONTHS.get(g[0].lower())
                    if not mo:
                        continue
                    d, y = int(g[1]), int(g[2])
                    t1, t2 = g[3:6], g[6:9]
                day = date(y, mo, d)
            except (ValueError, TypeError, OverflowError):
                continue
            if not t1[0]:
                return day.strftime("%Y-%m-%dT00:00"), day.strftime("%Y-%m-%dT23:59"), True
            try:
                start_h = _hm(*t1)
                start = datetime(day.year, day.month, day.day, *start_h)
                end = None
                if t2[0]:
                    # "3:00 - 4:00 PM": il pomeriggio vale anche per l'inizio se non indicato
                    ampm2 = t2[2]
                    end_h = _hm(t2[0], t2[1], ampm2)
                    end = datetime(day.year, day.month, day.day, *end_h)
                    if ampm2 and not t1[2] and start + timedelta(hours=12) <= end:
                        start += timedelta(hours=12)
                    if end < start:
                        end += timedelta(days=1)
            except (ValueError, OverflowError):
                continue
            return start.strftime(FMT), end.strftime(FMT) if end else None, False
    return None, None, False


# ---------------------------------------------------------------- testo incollato

HEADERS = {
    "da": "from", "from": "from", "mittente": "from",
    "inviato": "sent", "data": "sent", "sent": "sent", "date": "sent", "ricevuto": "sent",
    "a": "to", "to": "to", "cc": "cc",
    "oggetto": "subject", "subject": "subject",
    "quando": "when", "when": "when",
    "dove": "where", "luogo": "where", "location": "where", "where": "where",
    "inizio": "start", "start": "start", "fine": "end", "end": "end",
}
_RE_HEADER = re.compile(r"^\s*([A-Za-zÀ-ÿ]+)\s*:\s*(.*)$")


def parse_text(text):
    if not isinstance(text, str) or not text.strip():
        raise ImportError_("Il testo è vuoto")
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    i = 0
    while i < len(lines) and not lines[i].strip():
        i += 1
    first = i
    found = {}
    last_key = None
    while i < len(lines):
        line = lines[i]
        m = _RE_HEADER.match(line)
        key = HEADERS.get(m.group(1).lower()) if m else None
        if key:
            found.setdefault(key, m.group(2).strip())
            last_key = key
        elif last_key and line.strip() and (line[:1] in " \t" or found.get(last_key, "").rstrip().endswith((";", ","))):
            # intestazione spezzata su più righe (es. "A:" con molti destinatari)
            if found.get(last_key) is not None:
                found[last_key] = f"{found[last_key]} {line.strip()}".strip()
        else:
            break
        i += 1
    # Un blocco di intestazioni vale solo se contiene almeno mittente, oggetto o orario:
    # altrimenti "Data: confermata la consegna" in un testo qualsiasi verrebbe scambiato per intestazione.
    if found and not any(k in found for k in ("from", "subject", "when", "start")):
        found, i = {}, first
    body = "\n".join(lines[i:])
    subject = found.get("subject", "")
    if not found or not subject:
        rest = body.strip("\n").split("\n")
        while rest and not rest[0].strip():
            rest.pop(0)
        if not subject and rest:
            subject = rest[0].strip()
            body = "\n".join(rest[1:])

    sender, addr = split_sender(found.get("from", ""))
    start, end, all_day = parse_date_text(found.get("when", ""))
    if not start and found.get("start"):
        start, _, all_day = parse_date_text(found["start"])
        if found.get("end"):
            end_start, end_end, end_all_day = parse_date_text(found["end"])
            end = end_end if end_all_day else end_start
    sent_at = parse_date_text(found.get("sent", ""))[0]
    return _result(
        kind="event" if start else "mail", subject=subject, sender=sender, sender_email=addr,
        sent_at=sent_at, to=found.get("to", ""), start=start, end=end, all_day=all_day,
        location=found.get("where", ""), body=body,
    )


_RE_ADDR = re.compile(r"<\s*([^<>@\s]+@[^<>\s]+)\s*>")
_RE_BARE_ADDR = re.compile(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+")


def split_sender(value):
    """'Rossi, Mario <m@a.it>' → ('Rossi, Mario', 'm@a.it'); 'Mario Rossi' → ('Mario Rossi', '')."""
    v = (value or "").strip()
    m = _RE_ADDR.search(v)
    if m:
        return v[:m.start()].strip().strip('"').strip(), m.group(1)
    if _RE_BARE_ADDR.fullmatch(v):
        return "", v
    return v.strip('"'), ""


# ---------------------------------------------------------------- HTML → testo

def html_to_text(markup):
    s = re.sub(r"(?is)<(script|style|head)\b.*?</\1>", "", markup or "")
    s = re.sub(r"(?i)<br\s*/?>", "\n", s)
    s = re.sub(r"(?i)</(p|div|tr|li|h[1-6]|table|blockquote)\s*>", "\n", s)
    s = re.sub(r"(?i)</t[dh]\s*>", " ", s)  # celle di tabella separate da uno spazio
    s = re.sub(r"<[^<>]*>", "", s)
    s = html.unescape(s).replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in s.split("\n")]
    return re.sub(r"\n{2,}", "\n", "\n".join(lines)).strip()


# ---------------------------------------------------------------- .eml

def _part_text(part):
    """Testo di una parte MIME, robusto a charset sconosciuti o assenti."""
    try:
        content = part.get_content()
        if isinstance(content, str) and "�" not in content:
            return content
    except Exception:
        pass
    raw = part.get_payload(decode=True) or b""
    for enc in (part.get_content_charset(), "utf-8", "cp1252"):
        if not enc:
            continue
        try:
            return raw.decode(enc)
        except (LookupError, UnicodeDecodeError):
            continue
    return raw.decode("utf-8", errors="replace")


def parse_eml(data):
    if not isinstance(data, (bytes, bytearray)) or not data.strip():
        raise ImportError_("Il file della mail è vuoto")
    try:
        msg = BytesParser(policy=policy.default).parsebytes(bytes(data))
    except Exception:
        raise ImportError_("Il file non è una mail valida (.eml)")
    if not (msg.get("subject") or msg.get("from") or msg.get_payload()):
        raise ImportError_("Il file non è una mail valida (.eml)")

    def header(name):
        try:
            return str(msg.get(name, "") or "")
        except Exception:
            return ""

    name, addr = parseaddr(header("from"))
    if addr and "@" not in addr:  # "Mario Rossi" senza indirizzo
        name, addr = header("from").strip(), ""
    sent_at = None
    try:
        dt = msg["date"].datetime if msg["date"] is not None else None
        if dt is not None:
            sent_at = (dt.astimezone() if dt.tzinfo else dt).strftime(FMT)
    except Exception:
        sent_at = None

    body = ""
    try:
        part = msg.get_body(preferencelist=("plain", "html"))
        if part is not None:
            content = _part_text(part)
            body = html_to_text(content) if part.get_content_type() == "text/html" else content
    except Exception:
        body = ""

    result = _result(
        subject=header("subject"), sender=name, sender_email=addr, sent_at=sent_at,
        to=", ".join(f"{n} <{a}>" if n else a for n, a in getaddresses([header("to")]) if a), body=body,
    )
    # Invito allegato: l'evento si legge dal calendario
    for part in msg.walk():
        if part.get_content_type() == "text/calendar":
            try:
                ev = parse_ics(part.get_content())
            except (ImportError_, Exception):
                continue
            result.update({k: ev[k] for k in ("start", "end", "all_day", "location", "events_in_file")})
            result["kind"] = "event"
            if not result["subject"]:
                result["subject"] = ev["subject"]
            if not result["body"]:
                result["body"] = ev["body"]
            break
    return result


# ---------------------------------------------------------------- .ics

def _unescape_ics(value):
    out, i = [], 0
    while i < len(value):
        c = value[i]
        if c == "\\" and i + 1 < len(value):
            nxt = value[i + 1]
            out.append("\n" if nxt in "nN" else nxt)
            i += 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


def _split_prop(line):
    """'DTSTART;TZID="W. Europe":2026…' → ('DTSTART', {'TZID': 'W. Europe'}, '2026…')."""
    in_quote = False
    for idx, ch in enumerate(line):
        if ch == '"':
            in_quote = not in_quote
        elif ch == ":" and not in_quote:
            head, value = line[:idx], line[idx + 1:]
            break
    else:
        return None
    parts = re.findall(r'(?:[^;"]|"[^"]*")+', head)
    name = parts[0].upper() if parts else ""
    params = {}
    for p in parts[1:]:
        if "=" in p:
            k, v = p.split("=", 1)
            params[k.upper()] = v.strip('"')
    return name, params, value


def _ics_datetime(value, params, is_end=False):
    """Restituisce (stringa ora locale, giornata_intera)."""
    v = value.strip()
    try:
        if params.get("VALUE", "").upper() == "DATE" or re.fullmatch(r"\d{8}", v):
            if not re.fullmatch(r"\d{8}", v):
                raise ValueError
            d = datetime.strptime(v, "%Y%m%d")
            if is_end:
                d -= timedelta(days=1)  # nel formato iCalendar la fine di un giorno intero è esclusa
                return d.strftime("%Y-%m-%dT23:59"), True
            return d.strftime("%Y-%m-%dT00:00"), True
        m = re.fullmatch(r"(\d{8})T(\d{4})(\d{2})?(Z)?", v)
        if not m:
            raise ValueError
        dt = datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M")
        # Date assurde rifiutate in modo esplicito: non si dipende dal sistema operativo
        # (su Windows le date prima del 1970 danno errore, altrove no).
        if not 1971 <= dt.year <= 2200:
            raise ValueError
        if m.group(4):
            dt = dt.replace(tzinfo=timezone.utc).astimezone()
        # Con TZID (es. "W. Europe Standard Time") l'orario viene letto come ora locale.
        return dt.strftime(FMT), False
    except (ValueError, OverflowError, OSError):
        raise ImportError_("Data dell'appuntamento non valida") from None


def parse_ics(text):
    if isinstance(text, bytes):
        text = text.decode("utf-8", errors="replace")
    if not isinstance(text, str):
        raise ImportError_("File del calendario non valido")
    unfolded = re.sub(r"\r?\n[ \t]", "", text.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\r\n")).replace("\r\n", "\n")
    blocks = re.findall(r"(?ms)^BEGIN:VEVENT\s*$(.*?)^END:VEVENT\s*$", unfolded)
    if not blocks:
        raise ImportError_("Nessun appuntamento nel file")
    props = {}
    for line in blocks[0].split("\n"):
        parsed = _split_prop(line.strip("\r"))
        if parsed and parsed[0] not in props:
            props[parsed[0]] = parsed
    get = lambda n: _unescape_ics(props[n][2]) if n in props else ""

    start = end = None
    all_day = False
    if "DTSTART" in props:
        start, all_day = _ics_datetime(props["DTSTART"][2], props["DTSTART"][1])
    if "DTEND" in props:
        end, _ = _ics_datetime(props["DTEND"][2], props["DTEND"][1], is_end=True)
        if end and start and end < start:
            end = start
    sender = sender_email = ""
    if "ORGANIZER" in props:
        sender = props["ORGANIZER"][1].get("CN", "")
        value = props["ORGANIZER"][2]
        sender_email = value.split(":", 1)[1] if value.lower().startswith("mailto:") else ""
    # Outlook Web lascia entità HTML (&nbsp; &amp;) anche nella descrizione in testo semplice.
    description = html.unescape(get("DESCRIPTION")).replace("\xa0", " ")
    description = "\n".join(re.sub(r"[ \t]{2,}", " ", ln).strip() for ln in description.split("\n"))
    return _result(
        kind="event", subject=get("SUMMARY"), sender=sender, sender_email=sender_email,
        start=start, end=end, all_day=all_day, location=get("LOCATION"), body=description,
        events_in_file=len(blocks),
    )


# ---------------------------------------------------------------- ingresso unico

def parse(kind, content=None, content_b64=None):
    """Punto d'ingresso per l'API: kind in text|eml|ics, contenuto testuale o base64."""
    if kind not in ("text", "eml", "ics"):
        raise ImportError_("Tipo di contenuto non supportato (servono testo, .eml o .ics)")
    if content_b64 is not None:
        if not isinstance(content_b64, str):
            raise ImportError_("Contenuto del file non valido")
        try:
            raw = base64.b64decode(content_b64, validate=True)
        except (binascii.Error, ValueError):
            raise ImportError_("Contenuto del file non valido")
    elif isinstance(content, str):
        raw = content.encode("utf-8")
    else:
        raise ImportError_("Contenuto mancante")
    if len(raw) > MAX_BYTES:
        raise ImportError_("Il contenuto supera il limite di 5 MB")
    try:
        if kind == "eml":
            return parse_eml(raw)
        text = raw.decode("utf-8", errors="replace")
        return parse_ics(text) if kind == "ics" else parse_text(text)
    except ImportError_:
        raise
    except Exception:
        # Qualunque errore imprevisto diventa un messaggio chiaro (400), mai "Errore interno".
        log.exception("Import non riuscito (%s)", kind)
        raise ImportError_("Contenuto non leggibile") from None
