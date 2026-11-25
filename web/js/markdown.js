// Testo formattato semplice per le Procedure (sottoinsieme di Markdown), costruito senza HTML grezzo.
//   # Titolo, ## Sottotitolo, ### …     - elenco / * elenco / 1. elenco numerato
//   ```blocco di codice``` (con pulsante Copia)   `codice`   **grassetto**   link http(s)
//   [immagine: nome.png] → immagine allegata
import { copyText, h, icon } from "./ui.js";

function inline(text, images, used) {
  const out = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|(\[immagine: ([^\]\n]+)\])/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(h("code", {}, m[1].slice(1, -1)));
    else if (m[2]) out.push(h("strong", {}, m[2].slice(2, -2)));
    else if (m[3]) out.push(h("a", { href: m[3], target: "_blank", rel: "noopener noreferrer" }, m[3]));
    else {
      const img = images.find((a) => a.name === m[5].trim());
      if (img) { used?.add(img.name); out.push(h("img", { class: "inline-img", src: `/api/attachments/${img.id}/file`, alt: img.name })); } else out.push(m[0]);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function codeBlock(code, lang = "") {
  return h("div", { class: "code-block" },
    h("div", { class: "code-head" }, h("span", { class: "small muted" }, lang || "codice"),
      h("button", { class: "btn btn-sm", type: "button", onclick: (e) => copyText(code, e.currentTarget) }, icon("copy"), "Copia")),
    h("pre", {}, h("code", {}, code)));
}

/** Testo → nodi. images: allegati immagine dell'elemento (per «[immagine: …]»). */
export function renderMarkdown(src, images = [], used = new Set(), { plainCode = false } = {}) {
  const lines = String(src || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let para = [], list = null;
  const flushPara = () => { if (para.length) { out.push(h("p", {}, inline(para.join("\n"), images, used))); para = []; } };
  const flushList = () => { if (list) { out.push(list); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) {
      flushPara(); flushList();
      const buf = [];
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) buf.push(lines[i]);
      out.push(plainCode ? h("pre", {}, buf.join("\n")) : codeBlock(buf.join("\n"), fence[1]));
      continue;
    }
    const head = line.match(/^(#{1,3})\s+(.*)$/);
    if (head) { flushPara(); flushList(); out.push(h(`h${head[1].length + 1}`, {}, inline(head[2], images, used))); continue; }
    const item = line.match(/^\s*(?:([-*])|(\d+)[.)])\s+(.*)$/);
    if (item) {
      flushPara();
      const tag = item[1] ? "ul" : "ol";
      // un elenco numerato che riprende dopo un blocco di codice continua dal suo numero
      if (!list || list.tagName.toLowerCase() !== tag) { flushList(); list = h(tag, item[2] && item[2] !== "1" ? { start: item[2] } : {}); }
      list.append(h("li", {}, inline(item[3], images, used)));
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return out;
}

/** Testo semplice da copiare: senza i simboli di formattazione. */
export function plainText(src) {
  return String(src || "").replace(/^\s*```[\w+-]*\s*$/gm, "").replace(/^#{1,3}\s+/gm, "").replace(/\*\*([^*\n]+)\*\*/g, "$1").replace(/`([^`\n]+)`/g, "$1").trim();
}
