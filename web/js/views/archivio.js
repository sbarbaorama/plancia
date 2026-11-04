// Archivio: i task chiusi, raggruppati per mese oppure in una tabella ordinabile.
import { get, qs } from "../api.js";
import { openTaskEditor } from "../editors.js";
import { taskRow } from "../rows.js";
import {
  clear, customerChip, customerFilter, fmtDate, fmtMin, h, label, loadCustomers, monthName, pageHead, segmented, sortableTable,
} from "../ui.js";

const state = { customer_id: "", q: "", mode: "mesi", sort: { key: "closed_at", dir: -1 } };
const PRIO = { alta: 0, media: 1, bassa: 2 };

export async function render(root, ctx) {
  const customers = await loadCustomers();
  const items = await get(`/api/tasks${qs({ status: "chiuso", customer_id: state.customer_id, q: state.q, limit: 500 })}`);
  if (!ctx.isCurrent()) return;
  const reload = () => render(root, ctx);
  let body;
  if (!items.length) body = h("div", { class: "card" }, h("div", { class: "empty" }, "Nessun task chiuso."));
  else if (state.mode === "tabella") {
    body = h("div", { class: "card table-wrap" }, sortableTable({
      items, sort: state.sort, onSort: (x) => { state.sort = x; reload(); }, onRow: (t) => openTaskEditor(t, { onSave: reload }),
      columns: [
        { key: "closed_at", label: "Chiuso il", cls: "nowrap", value: (t) => t.closed_at || t.updated_at, cell: (t) => fmtDate(t.closed_at || t.updated_at, { year: true }) },
        { key: "title", label: "Task", cell: (t) => h("b", {}, t.title) },
        { key: "customer", label: "Cliente", value: (t) => t.customer_code || t.customer_name, cell: (t) => customerChip(t) },
        { key: "project_name", label: "Progetto" },
        { key: "priority", label: "Priorità", value: (t) => PRIO[t.priority], cell: (t) => label(t.priority) },
        { key: "due_date", label: "Scadenza", cls: "nowrap", cell: (t) => (t.due_date ? fmtDate(t.due_date, { year: true }) : "") },
        { key: "minutes_spent", label: "Tempo", cls: "num", value: (t) => t.minutes_spent || null, cell: (t) => (t.minutes_spent ? fmtMin(t.minutes_spent) : "") },
      ],
    }));
  } else {
    const groups = {};
    for (const t of items) { const k = (t.closed_at || t.updated_at).slice(0, 7); (groups[k] = groups[k] || []).push(t); }
    body = Object.keys(groups).sort().reverse().map((k) => {
      const [y, m] = k.split("-").map(Number);
      return [h("div", { class: "group-title" }, `${monthName(m - 1)} ${y} · ${groups[k].length}`), h("ul", { class: "list card" }, groups[k].map((t) => taskRow(t, { onChange: reload })))];
    });
  }
  clear(root,
    pageHead("Archivio", "Task chiusi, mese per mese o in tabella. La spunta li riapre"),
    h("div", { class: "filters" },
      h("input", { type: "search", placeholder: "Cerca nei task chiusi…", value: state.q, onchange: (e) => { state.q = e.target.value; reload(); } }),
      customerFilter(customers, state.customer_id, (e) => { state.customer_id = e.target.value; reload(); }),
      h("span", { class: "spacer" }),
      segmented([["mesi", "Per mese"], ["tabella", "Tabella"]], state.mode, (v) => { state.mode = v; reload(); }, "Vista")),
    body);
}
