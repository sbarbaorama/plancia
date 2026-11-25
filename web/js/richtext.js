// Testo formattato: piccolo editor (grassetto, corsivo, sottolineato, evidenziato, dimensione, elenchi;
// nelle procedure anche titoli, codice e link) per verbali, consulenze e procedure.
// Il testo si salva come HTML con la SOLA formattazione ammessa (lo stesso filtro c'è sul server).
// Il testo semplice scritto prima resta valido: si mostra com'era e si converte quando lo modifichi.
import { renderMarkdown } from "./markdown.js";
import { copyText, h, icon } from "./ui.js";

const TAGS = {
  p: "p", div: "p", br: "br", h1: "h2", h2: "h2", h3: "h3", h4: "h3", h5: "h3", h6: "h3",
  ul: "ul", ol: "ol", li: "li", pre: "pre", blockquote: "blockquote",
  b: "b", strong: "b", i: "i", em: "i", u: "u", s: "s", strike: "s", del: "s",
  mark: "mark", code: "code", a: "a", span: "span", sub: "sub", sup: "sup", font: "font",
};
const DROP = new Set(["script", "style", "head", "title", "meta", "link", "iframe", "object", "embed", "svg", "math", "template", "noscript", "img", "xml"]);
const SIZES = new Set(["fs-s", "fs-l", "fs-xl"]);
const RICH_RE = /^\s*<(p|div|h[1-6]|ul|ol|pre|blockquote|b|strong|i|em|u|s|mark|code|span|br|a)[\s/>]/i;
const FONT_SIZE = { 1: "fs-s", 2: "fs-s", 4: "fs-l", 5: "fs-l", 6: "fs-xl", 7: "fs-xl" };

export const isRich = (v) => typeof v === "string" && RICH_RE.test(v);

/** Pulisce un nodo HTML e restituisce un frammento con la sola formattazione ammessa. */
function cleanNode(node, doc, inPre = false) {
  const frag = doc.createDocumentFragment();
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 3) { frag.append(doc.createTextNode(child.nodeValue)); continue; }
    if (child.nodeType !== 1) continue;
    const tag = child.tagName.toLowerCase();
    if (DROP.has(tag)) continue;
    let name = TAGS[tag];
    if (inPre && name !== "br") name = null;
    if (name === "br") { frag.append(inPre ? doc.createTextNode("\n") : doc.createElement("br")); continue; }
    let el = null;
    if (name === "font") {
      // le parole formattate dai pulsanti passano da <font> (execCommand) e diventano marcatori ammessi
      const face = child.getAttribute("face");
      if (face === "__mark__") el = doc.createElement("mark");
      else if (face === "__code__") el = doc.createElement("code");
      else if (FONT_SIZE[child.getAttribute("size")]) { el = doc.createElement("span"); el.className = FONT_SIZE[child.getAttribute("size")]; }
    } else if (name === "a") {
      const href = (child.getAttribute("href") || "").trim();
      if (/^https?:\/\//i.test(href)) { el = doc.createElement("a"); el.setAttribute("href", href); el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer"); }
    } else if (name === "span") {
      const cls = [...child.classList].find((c) => SIZES.has(c));
      if (cls) { el = doc.createElement("span"); el.className = cls; }
    } else if (name) {
      el = doc.createElement(name);
      if (name === "ol" && /^\d+$/.test(child.getAttribute("start") || "") && child.getAttribute("start") !== "1") el.setAttribute("start", child.getAttribute("start"));
    }
    // incollato da Word/Google Docs: grassetto, corsivo e sottolineato scritti come stile
    const st = child.getAttribute("style") || "";
    const wrapStyle = (inner) => {
      let out = inner;
      if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(st) && !["b", "h2", "h3"].includes(name)) { const b = doc.createElement("b"); b.append(out); out = b; }
      if (/font-style\s*:\s*italic/i.test(st) && name !== "i") { const i = doc.createElement("i"); i.append(out); out = i; }
      if (/text-decoration[^;]*underline/i.test(st) && name !== "u") { const u = doc.createElement("u"); u.append(out); out = u; }
      return out;
    };
    const inner = cleanNode(child, doc, inPre || name === "pre");
    if (el) { el.append(inner); frag.append(wrapStyle(el)); } else frag.append(wrapStyle(inner));
  }
  return frag;
}

/** HTML qualsiasi → HTML pulito (stringa). */
export function sanitizeHTML(html) {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html || ""}`, "text/html");
  const box = doc.createElement("div");
  box.append(cleanNode(doc.body, doc));
  let out = box.innerHTML.trim().replace(/(<p>(\s|<br>)*<\/p>\s*)+$/, "");
  if (!box.textContent.trim() && !box.querySelector("li")) return "";
  if (out && !isRich(out)) out = `<p>${out}</p>`;
  return out;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Testo semplice (scritto prima) → HTML: un paragrafo per blocco, a capo come <br>. */
export function plainToRich(text) {
  const t = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!t) return "";
  return t.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
}

/** Testo delle procedure scritto con i simboli (# titolo, ``` codice ```) → HTML. */
export function markdownToRich(src) {
  if (!String(src || "").trim()) return "";
  const box = h("div", {}, renderMarkdown(src, [], new Set(), { plainCode: true }));
  return sanitizeHTML(box.innerHTML);
}

/** HTML → testo semplice (per copiare, per la mail, per le anteprime). */
export function toPlain(value) {
  if (!isRich(value)) return String(value || "");
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${value}`, "text/html");
  const out = [];
  const walk = (node, ctx) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { out.push(c.nodeValue); continue; }
      if (c.nodeType !== 1) continue;
      const tag = c.tagName.toLowerCase();
      if (tag === "br") { out.push("\n"); continue; }
      if (tag === "li") {
        const n = ctx.ol ? `${ctx.n++}. ` : "- ";
        out.push(`\n${n}`); walk(c, {}); continue;
      }
      if (tag === "ol" || tag === "ul") { walk(c, { ol: tag === "ol", n: Number(c.getAttribute("start") || 1) }); out.push("\n\n"); continue; }
      walk(c, ctx);
      if (["p", "h2", "h3", "pre", "blockquote", "div"].includes(tag)) out.push("\n\n");
    }
  };
  walk(doc.body, {});
  return out.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Valore da mostrare (sola lettura): formattato se lo è, altrimenti come testo a capo.
 *  opts.images: immagini allegate (per «[immagine: …]»); opts.markdown: il testo semplice è nel formato delle procedure. */
export function renderRich(value, { images = [], used = new Set(), markdown = false } = {}) {
  if (!value) return [];
  if (!isRich(value)) {
    if (markdown) return renderMarkdown(value, images, used);
    return [h("div", { class: "plain-text" }, withImages(document.createTextNode(String(value)), images, used))];
  }
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${sanitizeHTML(value)}`, "text/html");
  const box = document.createElement("div");
  box.append(...[...doc.body.childNodes].map((n) => document.importNode(n, true)));
  // blocchi di codice con il pulsante Copia
  for (const pre of [...box.querySelectorAll("pre")]) {
    const code = pre.textContent;
    const block = h("div", { class: "code-block" },
      h("div", { class: "code-head" }, h("span", { class: "small muted" }, "codice"),
        h("button", { class: "btn btn-sm", type: "button", onclick: (e) => copyText(code, e.currentTarget) }, icon("copy"), "Copia")),
      h("pre", {}, h("code", {}, code)));
    pre.replaceWith(block);
  }
  // segnaposto delle immagini incollate
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) if (walker.currentNode.nodeValue.includes("[immagine: ")) texts.push(walker.currentNode);
  for (const t of texts) t.replaceWith(...withImages(t, images, used));
  return [...box.childNodes];
}

function withImages(textNode, images, used) {
  const text = textNode.nodeValue;
  const out = [];
  let last = 0;
  for (const m of text.matchAll(/\[immagine: ([^\]\n]+)\]/g)) {
    const img = images.find((a) => a.name === m[1].trim());
    if (!img) continue;
    out.push(document.createTextNode(text.slice(last, m.index)));
    out.push(h("img", { class: "inline-img", src: `/api/attachments/${img.id}/file`, alt: img.name }));
    used.add(img.name);
    last = m.index + m[0].length;
  }
  if (!out.length) return [textNode];
  out.push(document.createTextNode(text.slice(last)));
  return out;
}

// ------------------------------------------------------------------ editor
/** Trasforma subito nel DOM dell'editor i <font> creati dai comandi (dimensione, evidenziato, codice). */
function normalizeFonts(area) {
  for (const f of [...area.querySelectorAll("font")]) {
    const face = f.getAttribute("face"), size = f.getAttribute("size");
    let el = null;
    if (face === "__mark__") el = document.createElement("mark");
    else if (face === "__code__") el = document.createElement("code");
    else if (FONT_SIZE[size]) { el = document.createElement("span"); el.className = FONT_SIZE[size]; }
    if (el) { el.append(...f.childNodes); f.replaceWith(el); } else f.replaceWith(...f.childNodes);
  }
}

/** Toglie dalla selezione i marcatori indicati (es. dimensioni o evidenziato). */
function unwrapInSelection(area, selector) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  for (const el of [...area.querySelectorAll(selector)]) {
    if (range.intersectsNode(el)) el.replaceWith(...el.childNodes);
  }
}

const CMD = (cmd, arg = null) => document.execCommand(cmd, false, arg);

/**
 * Editor di testo formattato. Il valore (HTML pulito) sta in un campo nascosto con il nome indicato,
 * così i moduli lo leggono come gli altri campi.
 * mode: "base" (verbali, consulenze) o "doc" (procedure: anche titoli, codice, link).
 */
export function richEditor({ name, id, value = "", mode = "base", legacy = "plain", placeholder = "", minHeight = "" }) {
  const initial = isRich(value) ? sanitizeHTML(value) : legacy === "markdown" ? markdownToRich(value) : plainToRich(value);
  const hidden = h("input", { type: "hidden", name, value: initial });
  const area = h("div", {
    class: "rich-area", id, contenteditable: "true", role: "textbox", "aria-multiline": "true",
    "data-placeholder": placeholder, spellcheck: "true", style: minHeight ? { minHeight } : null,
  });
  area.innerHTML = initial;
  const sync = () => {
    normalizeFonts(area);
    hidden.value = sanitizeHTML(area.innerHTML);
    area.classList.toggle("empty", !area.textContent.trim() && !area.querySelector("li, br + br"));
  };
  const run = (fn) => (e) => {
    e.preventDefault();
    area.focus();
    CMD("styleWithCSS", false);
    fn();
    sync();
    area.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const btn = (label, title, fn, cls = "") => h("button", { type: "button", class: `rt-btn ${cls}`, title, "aria-label": title, onmousedown: run(fn) }, label);
  const sizeSel = h("select", { class: "rt-size", title: "Dimensione del testo selezionato", "aria-label": "Dimensione",
    onmousedown: (e) => e.stopPropagation(),
    onchange: () => {
      area.focus();
      restore();
      unwrapInSelection(area, "span.fs-s, span.fs-l, span.fs-xl");
      const v = sizeSel.value;
      if (v !== "n") CMD("fontSize", v);
      sizeSel.value = "";
      sync();
      area.dispatchEvent(new Event("input", { bubbles: true }));
    } },
  h("option", { value: "" }, "Dimensione"), h("option", { value: "2" }, "Piccolo"), h("option", { value: "n" }, "Normale"),
  h("option", { value: "4" }, "Grande"), h("option", { value: "6" }, "Molto grande"));
  // il menu della dimensione toglie il fuoco al testo: si ricorda la selezione
  let saved = null;
  const remember = () => {
    if (!wrap.isConnected && saved !== undefined && area.dataset.mounted) { document.removeEventListener("selectionchange", remember); return; }
    const s = window.getSelection();
    if (s.rangeCount && area.contains(s.anchorNode)) { saved = s.getRangeAt(0).cloneRange(); area.dataset.mounted = "1"; }
  };
  const restore = () => { if (saved) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(saved); } };
  document.addEventListener("selectionchange", remember);

  const tools = [
    btn(h("b", {}, "G"), "Grassetto (Ctrl+B)", () => CMD("bold")),
    btn(h("i", {}, "C"), "Corsivo (Ctrl+I)", () => CMD("italic")),
    btn(h("u", {}, "S"), "Sottolineato (Ctrl+U)", () => CMD("underline")),
    btn(h("span", { class: "rt-mark" }, "ab"), "Evidenzia", () => {
      const sel = window.getSelection();
      const inMark = sel.anchorNode && sel.anchorNode.parentElement?.closest("mark");
      if (inMark && area.contains(inMark)) unwrapInSelection(area, "mark"); else CMD("fontName", "__mark__");
    }),
    sizeSel,
    h("span", { class: "rt-sep" }),
    btn("•", "Elenco puntato", () => CMD("insertUnorderedList")),
    btn("1.", "Elenco numerato", () => CMD("insertOrderedList")),
  ];
  if (mode === "doc") {
    tools.push(h("span", { class: "rt-sep" }),
      btn("T", "Titolo", () => CMD("formatBlock", "h2"), "rt-h"),
      btn("t", "Sottotitolo", () => CMD("formatBlock", "h3"), "rt-h"),
      btn("¶", "Testo normale", () => CMD("formatBlock", "p")),
      btn("{ }", "Blocco di codice (con pulsante Copia)", () => CMD("formatBlock", "pre"), "rt-code"),
      btn("`c`", "Codice nel testo", () => {
        const sel = window.getSelection();
        const inCode = sel.anchorNode && sel.anchorNode.parentElement?.closest("code");
        if (inCode && area.contains(inCode)) unwrapInSelection(area, "code"); else CMD("fontName", "__code__");
      }, "rt-code"),
      btn("Link", "Collegamento a una pagina web", () => {
        const url = window.prompt("Indirizzo del collegamento (https://…)");
        if (url && /^https?:\/\//i.test(url.trim())) CMD("createLink", url.trim());
      }));
  }
  tools.push(h("span", { class: "rt-sep" }),
    btn("⨯", "Togli la formattazione dal testo selezionato", () => {
      CMD("removeFormat");
      unwrapInSelection(area, "mark, code, span.fs-s, span.fs-l, span.fs-xl");
    }));
  const bar = h("div", { class: "rt-bar", role: "toolbar", "aria-label": "Formattazione" }, tools);

  area.addEventListener("focus", () => CMD("defaultParagraphSeparator", "p"));
  area.addEventListener("input", sync);
  area.addEventListener("keydown", (e) => {
    // Tab nel codice: rientro invece di cambiare campo
    if (e.key === "Tab" && window.getSelection().anchorNode?.parentElement?.closest("pre")) { e.preventDefault(); CMD("insertText", "    "); }
  });
  area.addEventListener("paste", (e) => {
    const types = e.clipboardData?.types || [];
    const htmlData = types.includes("text/html") ? e.clipboardData.getData("text/html") : "";
    const text = types.includes("text/plain") ? e.clipboardData.getData("text/plain") : "";
    if (!htmlData && !text) return; // solo un'immagine: la gestisce il modulo (diventa un allegato)
    e.preventDefault();
    const inPre = window.getSelection().anchorNode?.parentElement?.closest("pre");
    if (htmlData && !inPre) CMD("insertHTML", sanitizeHTML(htmlData));
    else CMD("insertText", text);
    sync();
  });
  const wrap = h("div", { class: "rich", dataset: { rich: name } }, bar, area, hidden);
  /** Aggiunge righe di testo in fondo (es. i partecipanti suggeriti). */
  wrap.appendLines = (lines) => {
    for (const l of lines) area.append(h("p", {}, l));
    sync();
    area.dispatchEvent(new Event("input", { bubbles: true }));
  };
  wrap.focusArea = () => area.focus();
  sync();
  return wrap;
}
