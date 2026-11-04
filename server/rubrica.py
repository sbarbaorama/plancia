"""Rubrica: export dei contatti (CSV per Excel, vCard per Outlook) e import dei vCard."""
import csv
import io
import re

from . import crud
from .crud import ValidationError, transaction

CSV_COLS = (("last_name", "Cognome"), ("first_name", "Nome"), ("company", "Azienda"), ("role", "Ruolo"),
            ("customer_name", "Cliente"), ("email", "Email"), ("phone", "Telefono"), ("notes", "Note"))


def export_csv(conn, ctx=crud.LOCAL) -> str:
    out = io.StringIO()
    w = csv.writer(out, delimiter=";")  # Excel in italiano usa il punto e virgola
    w.writerow([label for _, label in CSV_COLS] + ["Consulente", "Service manager"])
    for c in crud.list_items(conn, "contacts", {}, ctx):
        w.writerow([c.get(k) or "" for k, _ in CSV_COLS] + ["sì" if c["is_consultant"] else "", "sì" if c["is_service_manager"] else ""])
    return "﻿" + out.getvalue()  # BOM: Excel riconosce l'UTF-8


def _esc(value) -> str:
    return str(value or "").replace("\\", "\\\\").replace("\n", "\\n").replace(",", "\\,").replace(";", "\\;")


def _fold(line: str) -> str:
    """Righe lunghe spezzate a 75 caratteri (RFC 6350)."""
    out, cur = [], line
    while len(cur.encode("utf-8")) > 75:
        cut = 74
        while len(cur[:cut].encode("utf-8")) > 74:
            cut -= 1
        out.append(cur[:cut])
        cur = " " + cur[cut:]
    out.append(cur)
    return "\r\n".join(out)


def export_vcf(conn, ctx=crud.LOCAL) -> str:
    cards = []
    for c in crud.list_items(conn, "contacts", {}, ctx):
        lines = ["BEGIN:VCARD", "VERSION:3.0",
                 f"N:{_esc(c['last_name'])};{_esc(c['first_name'])};;;",
                 f"FN:{_esc(c['name'])}"]
        if c["company"]:
            lines.append(f"ORG:{_esc(c['company'])}")
        if c["role"]:
            lines.append(f"TITLE:{_esc(c['role'])}")
        if c["email"]:
            lines.append(f"EMAIL;TYPE=INTERNET:{_esc(c['email'])}")
        if c["phone"]:
            lines.append(f"TEL;TYPE=WORK:{_esc(c['phone'])}")
        if c["notes"]:
            lines.append(f"NOTE:{_esc(c['notes'])}")
        lines.append("END:VCARD")
        cards.append("\r\n".join(_fold(x) for x in lines))
    return "\r\n".join(cards) + "\r\n"


def _unesc(value: str) -> str:
    return re.sub(r"\\([\\,;nN])", lambda m: "\n" if m.group(1) in "nN" else m.group(1), value)


def _split(value: str, sep: str):
    return [_unesc(p) for p in re.split(rf"(?<!\\){re.escape(sep)}", value)]


def parse_vcf(text: str) -> list:
    """Legge uno o più vCard (versioni 2.1, 3.0 e 4.0, come li esporta Outlook)."""
    if not isinstance(text, str):
        raise ValidationError("File vCard non valido")
    text = re.sub(r"\r?\n[ \t]", "", text.replace("\r\n", "\n"))  # righe spezzate
    cards, cur = [], None
    for raw in text.split("\n"):
        line = raw.strip()
        if not line:
            continue
        upper = line.upper()
        if upper == "BEGIN:VCARD":
            cur = {}
            continue
        if upper == "END:VCARD":
            if cur is not None:
                cards.append(cur)
            cur = None
            continue
        if cur is None or ":" not in line:
            continue
        head, value = line.split(":", 1)
        parts = head.split(";")
        key = parts[0].split(".")[-1].upper()  # "item1.EMAIL" → EMAIL
        params = ";".join(parts[1:]).upper()
        if "QUOTED-PRINTABLE" in params:
            try:
                import quopri
                value = quopri.decodestring(value.encode("latin-1", "replace")).decode("utf-8", "replace")
            except Exception:
                pass
        if key == "N":
            n = _split(value, ";") + [""] * 2
            cur.setdefault("last_name", n[0].strip())
            cur.setdefault("first_name", n[1].strip())
        elif key == "FN":
            cur.setdefault("name", _unesc(value).strip())
        elif key == "ORG":
            cur.setdefault("company", _split(value, ";")[0].strip())
        elif key in ("TITLE", "ROLE"):
            cur.setdefault("role", _unesc(value).strip())
        elif key == "EMAIL":
            cur.setdefault("email", _unesc(value).strip())
        elif key == "TEL":
            # il primo numero; meglio il cellulare o quello di lavoro se indicati
            tel = _unesc(value).strip().removeprefix("tel:")
            if "phone" not in cur or ("CELL" in params or "WORK" in params) and not cur.get("_tel_pref"):
                cur["phone"] = tel
                cur["_tel_pref"] = "CELL" in params or "WORK" in params
        elif key == "NOTE":
            cur.setdefault("notes", _unesc(value).rstrip())
    out = []
    for c in cards:
        c.pop("_tel_pref", None)
        if not (c.get("first_name") or c.get("last_name")) and c.get("name"):
            c["first_name"], c["last_name"] = crud.split_name(c["name"])
        c.pop("name", None)
        rec = {k: v[:300] if k != "notes" else v[:50000] for k, v in c.items() if v}
        if rec.get("first_name") or rec.get("last_name"):
            out.append(rec)
    return out


def import_vcf(conn, text: str, ctx=crud.LOCAL) -> dict:
    """Crea i contatti dei vCard; salta quelli già in rubrica (stessa email o stesso nome e cognome)."""
    people = parse_vcf(text)
    if not people:
        raise ValidationError("Nel file non ci sono contatti")
    created, skipped = [], []
    with transaction(conn):
        for p in people:
            same = conn.execute(
                """SELECT id FROM contacts WHERE (? != '' AND casefold(email) = casefold(?))
                   OR (casefold(first_name) = casefold(?) AND casefold(last_name) = casefold(?))""",
                (p.get("email", ""), p.get("email", ""), p.get("first_name", ""), p.get("last_name", ""))).fetchone()
            label = " ".join(x for x in (p.get("first_name"), p.get("last_name")) if x)
            if same:
                skipped.append(label)
                continue
            if p.get("email") and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", p["email"]):
                p.pop("email")
            created.append(crud.create_item(conn, "contacts", p, ctx)["id"])
    return {"created": len(created), "skipped": skipped}
