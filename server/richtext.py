"""Testo formattato (grassetto, elenchi, dimensioni…) dei verbali, delle consulenze e delle procedure.

Il testo arriva dall'editor dell'interfaccia come HTML. Prima di salvarlo si tiene SOLO la
formattazione ammessa: tutto il resto (script, stili, attributi, immagini, tag sconosciuti) sparisce.
Il testo semplice scritto prima di questa funzione resta com'è e si mostra come prima.
"""
import html
import re
from html.parser import HTMLParser

# tag ammessi → nome con cui si salvano (strong/em diventano b/i, div diventa p…)
TAGS = {
    "p": "p", "div": "p", "br": "br", "h1": "h2", "h2": "h2", "h3": "h3", "h4": "h3", "h5": "h3", "h6": "h3",
    "ul": "ul", "ol": "ol", "li": "li", "pre": "pre", "blockquote": "blockquote",
    "b": "b", "strong": "b", "i": "i", "em": "i", "u": "u", "s": "s", "strike": "s", "del": "s",
    "mark": "mark", "code": "code", "a": "a", "span": "span", "sub": "sub", "sup": "sup",
}
DROP = {"script", "style", "head", "title", "meta", "link", "iframe", "object", "embed", "svg", "math", "template", "noscript", "xml"}
VOID = {"br"}
SIZE_CLASSES = {"fs-s", "fs-l", "fs-xl"}
RICH_RE = re.compile(r"^\s*<(p|div|h[1-6]|ul|ol|pre|blockquote|b|strong|i|em|u|s|mark|code|span|br|a)[\s/>]", re.I)
MAX_LEN = 300_000


def is_rich(value) -> bool:
    """Il valore è testo formattato (HTML dell'editor) e non testo semplice?"""
    return isinstance(value, str) and bool(RICH_RE.match(value))


class _Cleaner(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.stack = []     # tag aperti in uscita (None = tag scartato ma con contenuto tenuto)
        self.dropping = 0   # dentro <script>, <style>…
        self.in_pre = 0

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in DROP:
            self.dropping += 1
            return
        if self.dropping:
            return
        name = TAGS.get(tag)
        attrs = dict(attrs)
        if name == "br":
            self.out.append("\n" if self.in_pre else "<br>")
            return
        if name is None or (self.in_pre and name != "pre"):
            self.stack.append((tag, None))
            return
        extra = ""
        if name == "a":
            href = (attrs.get("href") or "").strip()
            if not re.match(r"^https?://", href, re.I):
                self.stack.append((tag, None))
                return
            extra = f' href="{html.escape(href, quote=True)}" target="_blank" rel="noopener noreferrer"'
        elif name == "span":
            cls = [c for c in (attrs.get("class") or "").split() if c in SIZE_CLASSES]
            if not cls:
                self.stack.append((tag, None))
                return
            extra = f' class="{cls[0]}"'
        elif name == "ol":
            start = attrs.get("start") or ""
            if start.isdigit() and start != "1":
                extra = f' start="{int(start)}"'
        if name == "pre":
            self.in_pre += 1
        self.out.append(f"<{name}{extra}>")
        self.stack.append((tag, name))

    def handle_startendtag(self, tag, attrs):
        if tag.lower() == "br":
            self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in DROP:
            self.dropping = max(0, self.dropping - 1)
            return
        if self.dropping or tag in VOID:
            return
        # chiude fino al tag corrispondente (l'HTML incollato non è sempre ben formato)
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                for _, name in reversed(self.stack[i:]):
                    if name:
                        self.out.append(f"</{name}>")
                        if name == "pre":
                            self.in_pre = max(0, self.in_pre - 1)
                del self.stack[i:]
                return

    def handle_data(self, data):
        if not self.dropping:
            self.out.append(html.escape(data, quote=False))

    def result(self):
        for _, name in reversed(self.stack):
            if name:
                self.out.append(f"</{name}>")
        self.stack = []
        return "".join(self.out)


def sanitize(value: str) -> str:
    """HTML dell'editor → HTML con la sola formattazione ammessa."""
    if not value:
        return ""
    if len(value) > MAX_LEN:
        value = value[:MAX_LEN]
    p = _Cleaner()
    p.feed(value)
    p.close()
    out = p.result().strip()
    # niente paragrafi vuoti in fondo (quelli che lascia l'editor)
    out = re.sub(r"(<p>(\s|<br>)*</p>\s*)+$", "", out)
    if not out:
        return ""
    # se dopo la pulizia non resta un tag iniziale riconoscibile, lo si racchiude in un paragrafo
    return out if is_rich(out) else f"<p>{out}</p>"


def to_text(value: str) -> str:
    """Testo semplice (per mail, CSV, riepiloghi): toglie la formattazione, tiene a capo ed elenchi."""
    if not is_rich(value):
        return value or ""
    s = re.sub(r"<br\s*/?>", "\n", value, flags=re.I)
    s = re.sub(r"<li[^>]*>", "\n- ", s, flags=re.I)
    s = re.sub(r"</(p|h2|h3|pre|blockquote|ul|ol)>", "\n\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    return re.sub(r"\n{3,}", "\n\n", s).strip()
