// Inbox: note veloci da smistare con un clic in task, modifica, attesa, post-it o appuntamento.
import { get, post } from "../api.js";
import { emit, openChangeEditor, openEventEditor, openNoteEditor, openTaskEditor, openWaitingEditor } from "../editors.js";
import { clear, fmtDateTime, h, icon, pageHead, segmented, showError, toast } from "../ui.js";

const state = { show: "0" };
const TARGETS = [["tasks", "Task", openTaskEditor], ["changes", "Modifica", openChangeEditor], ["waiting_items", "Attesa", openWaitingEditor],
  ["sticky_notes", "Post-it", openNoteEditor], ["events", "Appuntamento", openEventEditor]];

export async function render(root, ctx) {
  const items = await get(`/api/inbox_items?processed=${state.show}`);
  if (!ctx.isCurrent()) return;
  const reload = () => { render(root, ctx); emit("changed"); };
  const input = h("textarea", { rows: 2, placeholder: "Scrivi una nota e premi Invio (Maiusc+Invio per andare a capo)", "aria-label": "Nuova nota" });
  input.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && !e.shiftKey && input.value.trim()) {
      e.preventDefault();
      try { await post("/api/inbox_items", { text: input.value.trim() }); input.value = ""; reload(); } catch (err) { showError(err); }
    }
  });
  const convert = async (n, type, open) => {
    try {
      const r = await post(`/api/inbox_items/${n.id}/convert`, { type });
      toast("Smistata", "ok");
      reload();
      if (r.item) open(r.item, { onSave: reload });
    } catch (err) { showError(err); }
  };
  clear(root,
    pageHead("Inbox", "Cattura adesso, decidi dopo: ogni nota si trasforma con un clic",
      segmented([["0", "Da smistare"], ["1", "Smistate"]], state.show, (v) => { state.show = v; render(root, ctx); }, "Mostra")),
    state.show === "0" ? h("div", { style: { marginBottom: "16px" } }, input) : null,
    items.length ? h("ul", { class: "list card" }, items.map((n) => h("li", { class: "item", style: { cursor: "default", alignItems: "flex-start" } },
      icon("inbox"),
      h("div", { class: "main-col" }, h("div", { style: { whiteSpace: "pre-wrap" } }, n.text), h("div", { class: "meta" }, fmtDateTime(n.created_at),
        n.converted_type ? h("span", {}, `→ ${TARGETS.find((t) => t[0] === n.converted_type)?.[1] || n.converted_type}`) : n.processed_at ? h("span", {}, "archiviata") : null)),
      state.show === "0" ? h("div", { class: "row", style: { justifyContent: "flex-end" } },
        TARGETS.map(([type, text, open]) => h("button", { class: "btn btn-sm", type: "button", onclick: () => convert(n, type, open) }, text)),
        h("button", { class: "btn btn-sm btn-ghost", type: "button", onclick: () => convert(n, "archivia", () => {}) }, "Archivia")) : null)))
      : h("div", { class: "card" }, h("div", { class: "empty" }, state.show === "0" ? "Inbox vuota. Usa la casella in alto («Nota veloce») per catturare al volo." : "Nessuna nota smistata.")));
}
