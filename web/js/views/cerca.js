// Ricerca in tutto: task, verbali, appuntamenti, progetti, modifiche, scadenze, attese, clienti, contatti, note, allegati.
import { get } from "../api.js";
import {
  openChangeEditor, openConsultationEditor, openContactEditor, openDeadlineEditor, openEventEditor, openNoteEditor, openTaskEditor, openWaitingEditor,
} from "../editors.js";
import { card, clear, customerChip, fmtDate, h, pageHead } from "../ui.js";

const GROUPS = [
  ["tasks", "Task", openTaskEditor], ["meetings", "Verbali", (x) => { location.hash = `#/riunioni/${x.id}`; }],
  ["events", "Appuntamenti", openEventEditor], ["projects", "Progetti", (x) => { location.hash = `#/progetti/${x.id}`; }],
  ["customers", "Clienti", (x) => { location.hash = `#/clienti/${x.id}`; }], ["contacts", "Contatti", openContactEditor],
  ["changes", "Modifiche", openChangeEditor], ["deadlines", "Scadenze", openDeadlineEditor], ["waiting_items", "Attese", openWaitingEditor],
  ["consultations", "Consulenze", openConsultationEditor], ["sticky_notes", "Post-it", openNoteEditor],
  ["inbox_items", "Inbox", () => { location.hash = "#/inbox"; }], ["checklist_templates", "Checklist", () => { location.hash = "#/checklist"; }],
  ["change_freezes", "Periodi di blocco", () => { location.hash = "#/modifiche?tab=blocchi"; }],
  ["attachments", "Allegati", (x) => window.open(x.kind === "file" ? `/api/attachments/${x.id}/file` : x.url, "_blank", "noopener")],
];

export async function render(root, ctx) {
  const q = ctx.query.q || "";
  const input = h("input", { type: "search", value: q, placeholder: "Cerca in tutto…", "aria-label": "Cerca", style: { maxWidth: "520px" } });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") location.hash = `#/cerca?q=${encodeURIComponent(input.value.trim())}`; });
  const res = q.length >= 2 ? await get(`/api/search?q=${encodeURIComponent(q)}&limit=20`) : {};
  if (!ctx.isCurrent()) return;
  const found = GROUPS.filter(([k]) => res[k]?.length);
  clear(root,
    pageHead("Cerca", q ? `Risultati per «${q}»` : "Scrivi almeno due lettere"),
    h("div", { class: "filters" }, input),
    found.length ? h("div", { class: "stack", style: { gap: "16px" } }, found.map(([k, title, open]) => card(`${title} · ${res[k].length}`,
      h("ul", { class: "list" }, res[k].map((x) => h("li", { class: "item", onclick: () => open(x) },
        h("div", { class: "main-col" }, h("div", { class: "t-title" }, x.title || x.name || x.text || x.location || "(senza titolo)"),
          h("div", { class: "meta" }, customerChip(x), x.due_date ? h("span", {}, `scad. ${fmtDate(x.due_date)}`) : null, x.status ? h("span", {}, x.status) : null))))))))
      : q ? h("div", { class: "card" }, h("div", { class: "empty" }, "Nessun risultato.")) : null);
  if (!q) input.focus();
}
