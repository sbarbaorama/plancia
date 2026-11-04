// Note: bacheca di post-it colorati, con comandi copiabili (libreria di comandi Linux, query…).
import { get, post, put, qs } from "../api.js";
import { noteToTask, openNoteEditor } from "../editors.js";
import { badge, clear, copyText, customerChip, customerFilter, h, icon, loadCustomers, pageHead, showError, toast, viewMode, viewToggle } from "../ui.js";

const state = { customer_id: "", commands: false, q: "", view: viewMode("note", "schede") };
const NOTE_DOT = { giallo: "#f2d24b", verde: "#6cc08b", blu: "#6f9be8", rosa: "#ec8fb0", viola: "#a98be6", arancio: "#f2a25e" };

export async function render(root, ctx) {
  const customers = await loadCustomers();
  let items = await get(`/api/sticky_notes${qs({ customer_id: state.customer_id, q: state.q })}`);
  if (!ctx.isCurrent()) return;
  if (state.commands) items = items.filter((n) => n.command);
  const reload = () => render(root, ctx);
  const quick = h("textarea", { rows: 2, placeholder: "Scrivi un post-it e premi Ctrl+Invio…", "aria-label": "Nuovo post-it" });
  quick.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && quick.value.trim()) {
      e.preventDefault();
      const [first, ...rest] = quick.value.trim().split("\n");
      try {
        await post("/api/sticky_notes", rest.length ? { title: first, body: rest.join("\n"), customer_id: state.customer_id || null } : { body: first, customer_id: state.customer_id || null });
        reload();
      } catch (err) { showError(err); }
    }
  });
  const note = (n) => h("article", { class: `postit ${n.color}`, onclick: () => openNoteEditor(n, { onSave: reload }) },
    h("div", { class: "row" }, n.title ? h("h3", { style: { flex: 1 } }, n.title) : h("span", { class: "spacer" }),
      h("button", { class: "icon-btn", type: "button", title: n.pinned ? "Togli dall'alto" : "Fissa in alto", "aria-label": n.pinned ? "Togli dall'alto" : "Fissa in alto",
        style: { color: n.pinned ? "#0b5953" : "#556072" }, onclick: async (e) => { e.stopPropagation(); await put(`/api/sticky_notes/${n.id}`, { pinned: !n.pinned }).catch(showError); reload(); } }, icon("pin"))),
    n.body ? h("div", { class: "body" }, n.body) : null,
    n.command ? h("div", { class: "cmd" }, n.command) : null,
    h("div", { class: "foot" }, customerChip(n), n.project_name ? h("span", { class: "small" }, n.project_name) : null, h("span", { class: "spacer" }),
      n.command ? h("button", { class: "btn btn-sm", type: "button", onclick: (e) => { e.stopPropagation(); copyText(n.command, e.currentTarget); } }, icon("copy"), "Comando") : null,
      n.body ? h("button", { class: "btn btn-sm", type: "button", "aria-label": "Copia il testo", onclick: (e) => { e.stopPropagation(); copyText(n.body, e.currentTarget); } }, icon("copy")) : null,
      h("button", { class: "btn btn-sm", type: "button", onclick: (e) => { e.stopPropagation(); noteToTask(n); } }, "→ Task")));
  const noteRow = (n) => h("li", { class: "item", onclick: () => openNoteEditor(n, { onSave: reload }) },
    h("span", { class: "dot", style: { background: NOTE_DOT[n.color] || NOTE_DOT.giallo, width: "10px", height: "10px" } }),
    h("div", { class: "main-col" },
      h("div", { class: "t-title" }, n.title || (n.body || n.command || "").split("\n")[0].slice(0, 140) || "(senza titolo)"),
      h("div", { class: "meta" }, n.pinned ? badge("fissato", "accent") : null, customerChip(n), n.project_name ? h("span", {}, n.project_name) : null,
        n.command ? h("span", { class: "mono" }, n.command.split("\n")[0].slice(0, 80)) : null,
        n.attachments_count ? h("span", { class: "row", style: { gap: "2px" } }, icon("clip"), n.attachments_count) : null)),
    n.command ? h("button", { class: "btn btn-sm", type: "button", onclick: (e) => { e.stopPropagation(); copyText(n.command, e.currentTarget); } }, icon("copy"), "Comando") : null);
  clear(root,
    pageHead("Note", "Post-it, appunti e comandi da tenere a portata di mano",
      h("button", { class: "btn btn-primary", type: "button", onclick: () => openNoteEditor(null, { onSave: reload, prefill: { customer_id: state.customer_id || null } }) }, icon("plus"), "Post-it")),
    h("div", { class: "filters" },
      h("input", { type: "search", placeholder: "Cerca nelle note…", value: state.q, onchange: (e) => { state.q = e.target.value; reload(); } }),
      customerFilter(customers, state.customer_id, (e) => { state.customer_id = e.target.value; reload(); }),
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: state.commands, onchange: (e) => { state.commands = e.target.checked; reload(); } }), "Solo comandi"),
      h("span", { class: "spacer" }), viewToggle("note", state.view, (v) => { state.view = v; reload(); })),
    h("div", { style: { marginBottom: "16px" } }, quick),
    items.length && state.view === "lista" ? h("ul", { class: "list card" }, items.map(noteRow))
    : items.length ? h("div", { class: "notes-board" }, items.map(note)) : h("div", { class: "card" }, h("div", { class: "empty" }, "Nessun post-it.")));
  void toast;
}
