// Immagini incollate (Ctrl+V) nei moduli: diventano allegati dell'elemento, con anteprima.
import { get, qs, upload } from "./api.js";
import { clear, h, icon, showError, toast } from "./ui.js";

const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
const pad = (n) => String(n).padStart(2, "0");

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Le immagini presenti negli appunti (file o screenshot), con un nome leggibile. */
export function clipboardImages(e) {
  const out = [];
  const items = [...(e.clipboardData?.items || [])];
  let n = 0;
  for (const it of items) {
    if (it.kind !== "file" || !EXT[it.type]) continue;
    const f = it.getAsFile();
    if (!f) continue;
    n += 1;
    const generic = !f.name || /^image\.\w+$/i.test(f.name);
    const name = generic ? `immagine-${stamp()}${n > 1 ? `-${n}` : ""}.${EXT[it.type]}` : f.name;
    out.push(new File([f], name, { type: f.type }));
  }
  return out;
}

function insertAtCursor(el, text) {
  if (!el || !("selectionStart" in el) || el.type !== "textarea") return;
  const s = el.selectionStart, end = el.selectionEnd;
  const before = el.value.slice(0, s), after = el.value.slice(end);
  const sep = before && !before.endsWith("\n") ? "\n" : "";
  el.value = `${before}${sep}${text}\n${after}`;
  el.selectionStart = el.selectionEnd = (before + sep + text).length + 1;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export async function uploadImage(entityType, entityId, file) {
  return upload(`/api/attachments/upload${qs({ entity_type: entityType, entity_id: entityId, name: file.name })}`, file);
}

/**
 * Attiva l'incolla di immagini su un modulo. Se l'elemento non è ancora salvato,
 * le immagini restano in attesa e si caricano con flush(id) dopo il salvataggio.
 */
export function pasteImages(form, entityType, entityId) {
  const pending = [];
  const strip = h("div", { class: "paste-strip", hidden: true });
  form.append(strip);
  const drawPending = () => {
    strip.hidden = !pending.length;
    clear(strip, h("div", { class: "small muted" }, icon("clip"), " Immagini incollate: si allegano al salvataggio"),
      h("div", { class: "thumbs" }, pending.map((p, i) => h("figure", { class: "thumb" },
        h("img", { src: p.url, alt: p.file.name }),
        h("button", { class: "icon-btn", type: "button", "aria-label": `Togli ${p.file.name}`, onclick: () => { URL.revokeObjectURL(p.url); pending.splice(i, 1); drawPending(); } }, icon("x"))))));
  };
  form.addEventListener("paste", async (e) => {
    if (e.defaultPrevented) return;
    const files = clipboardImages(e);
    if (!files.length) return;
    const hasText = e.clipboardData.types.includes("text/plain") && e.clipboardData.getData("text/plain").trim();
    const inText = e.target.matches?.("input, textarea");
    if (hasText && inText) return; // da Word/Excel arriva anche il testo: incolla il testo
    e.preventDefault();
    for (const f of files) {
      insertAtCursor(e.target, `[immagine: ${f.name}]`);
      if (entityId) {
        try {
          await uploadImage(entityType, entityId, f);
          toast(`Immagine allegata: ${f.name}`, "ok");
        } catch (err) { showError(err); }
      } else {
        pending.push({ file: f, url: URL.createObjectURL(f) });
      }
    }
    if (entityId) (form.querySelector(".att-box") || document.querySelector(".att-box"))?.reload?.();
    else drawPending();
  });
  return {
    async flush(id) {
      for (const p of pending.splice(0)) {
        try { await uploadImage(entityType, id, p.file); } catch (err) { showError(err); }
        URL.revokeObjectURL(p.url);
      }
    },
  };
}

// ------------------------------------------------------------------ immagini al posto del segnaposto
const MARK = /\[immagine: ([^\]\n]+)\]/g;
export const hasImageMarks = (text) => typeof text === "string" && text.includes("[immagine: ");

/** Le immagini allegate a un elemento ([] se non ce ne sono o in caso di errore). */
export async function imagesOf(entityType, entityId) {
  try {
    const items = await get(`/api/attachments${qs({ entity_type: entityType, entity_id: entityId })}`);
    return items.filter((a) => a.kind === "file" && !a.missing && /^image\//.test(a.mime || ""));
  } catch { return []; }
}

/** Testo con le immagini al posto di «[immagine: nome]». used raccoglie i nomi mostrati. */
export function richText(text, images = [], used = new Set()) {
  const out = [];
  let last = 0;
  for (const m of String(text || "").matchAll(MARK)) {
    const img = images.find((a) => a.name === m[1].trim());
    if (!img) continue;
    out.push(String(text).slice(last, m.index));
    out.push(h("img", { class: "inline-img", src: `/api/attachments/${img.id}/file`, alt: img.name }));
    used.add(img.name);
    last = m.index + m[0].length;
  }
  out.push(String(text || "").slice(last));
  return out.filter((x) => x !== "");
}
