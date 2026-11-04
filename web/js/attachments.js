// Riquadro allegati: file (trascina o scegli) e link (OneDrive, SharePoint, percorsi di rete).
import { del, get, post, qs, upload } from "./api.js";
import { clipboardImages } from "./paste.js";
import { clear, confirmDialog, copyText, h, icon, showError, toast } from "./ui.js";

const MAX = 25 * 1024 * 1024;

export function attachmentsBox(entityType, entityId) {
  const list = h("div", { class: "stack", style: { gap: "4px" } });
  const thumbs = h("div", { class: "thumbs" });
  const fileInput = h("input", { type: "file", multiple: true, hidden: true, onchange: (e) => send([...e.target.files]) });
  const box = h("div", { class: "att-box" },
    h("div", { class: "row" }, icon("clip"), h("b", { class: "small" }, "Allegati"), h("span", { class: "spacer" }),
      h("button", { class: "btn btn-sm", type: "button", onclick: () => fileInput.click() }, "Scegli file…"),
      h("button", { class: "btn btn-sm", type: "button", onclick: addLink }, "+ Link")),
    thumbs, list, fileInput,
    h("div", { class: "hint" }, "Trascina qui i file (max 25 MB), incolla un'immagine con Ctrl+V oppure aggiungi un link a OneDrive, SharePoint o \\\\server\\cartella."));
  box.tabIndex = -1;
  box.reload = () => load();

  async function load() {
    try {
      const items = await get(`/api/attachments${qs({ entity_type: entityType, entity_id: entityId })}`);
      clear(list, items.map((a) => h("div", { class: "att-item" },
        icon(a.kind === "link" ? "link" : "clip"),
        a.kind === "file"
          ? (a.missing ? h("span", { class: "muted" }, `${a.name} (file non presente su questo PC)`)
            : h("a", { href: `/api/attachments/${a.id}/file`, target: "_blank", rel: "noopener" }, a.name))
          : a.url.startsWith("\\\\") ? h("span", {}, a.name)
            : h("a", { href: a.url, target: "_blank", rel: "noopener noreferrer" }, a.name),
        a.kind === "link" && a.url.startsWith("\\\\") ? h("button", { class: "btn btn-sm", type: "button", onclick: (e) => copyText(a.url, e.currentTarget) }, "Copia percorso") : null,
        a.size ? h("span", { class: "small muted" }, `${Math.max(1, Math.round(a.size / 1024))} KB`) : null,
        h("button", { class: "icon-btn", type: "button", "aria-label": `Elimina ${a.name}`, onclick: async () => {
          if (!(await confirmDialog(`Eliminare l'allegato «${a.name}»?`, { confirm: "Elimina" }))) return;
          try { await del(`/api/attachments/${a.id}`); load(); } catch (err) { showError(err); }
        } }, icon("trash")))));
      if (!items.length) list.append(h("span", { class: "small muted" }, "Nessun allegato"));
      const images = items.filter((a) => a.kind === "file" && !a.missing && /^image\//.test(a.mime || ""));
      clear(thumbs, images.map((a) => h("a", { class: "thumb", href: `/api/attachments/${a.id}/file`, target: "_blank", rel: "noopener", title: a.name },
        h("img", { src: `/api/attachments/${a.id}/file`, alt: a.name, loading: "lazy" }))));
      thumbs.hidden = !images.length;
    } catch (err) { showError(err); }
  }

  async function send(files) {
    for (const f of files) {
      if (f.size > MAX) { toast(`${f.name}: supera i 25 MB`, "error"); continue; }
      try {
        await upload(`/api/attachments/upload${qs({ entity_type: entityType, entity_id: entityId, name: f.name })}`, f);
      } catch (err) { showError(err); }
    }
    load();
  }

  async function addLink() {
    const url = window.prompt("Indirizzo del documento (https://… oppure \\\\server\\cartella\\file)");
    if (!url) return;
    try { await post("/api/attachments/link", { entity_type: entityType, entity_id: entityId, url }); load(); } catch (err) { showError(err); }
  }

  box.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); box.classList.add("over"); });
  box.addEventListener("dragleave", () => box.classList.remove("over"));
  box.addEventListener("drop", (e) => {
    e.preventDefault(); e.stopPropagation(); box.classList.remove("over");
    if (e.dataTransfer.files.length) send([...e.dataTransfer.files]);
  });
  // incolla un'immagine con il riquadro selezionato (i moduli gestiscono già l'incolla nei campi)
  box.addEventListener("paste", (e) => {
    if (e.target.closest("form") && e.target !== box) return;
    const files = clipboardImages(e);
    if (files.length) { e.preventDefault(); e.stopPropagation(); send(files); }
  });
  box.addEventListener("click", (e) => { if (e.target === box) box.focus(); });
  load();
  return box;
}
