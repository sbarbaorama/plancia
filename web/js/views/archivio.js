// Archivio: i task chiusi, raggruppati per mese.
import { get, qs } from "../api.js";
import { taskRow } from "../rows.js";
import { clear, customerFilter, h, loadCustomers, monthName, pageHead } from "../ui.js";

const state = { customer_id: "", q: "" };

export async function render(root, ctx) {
  const customers = await loadCustomers();
  const items = await get(`/api/tasks${qs({ status: "chiuso", customer_id: state.customer_id, q: state.q, limit: 500 })}`);
  if (!ctx.isCurrent()) return;
  const reload = () => render(root, ctx);
  const groups = {};
  for (const t of items) { const k = (t.closed_at || t.updated_at).slice(0, 7); (groups[k] = groups[k] || []).push(t); }
  clear(root,
    pageHead("Archivio", "Task chiusi, mese per mese. La spunta li riapre"),
    h("div", { class: "filters" },
      h("input", { type: "search", placeholder: "Cerca nei task chiusi…", value: state.q, onchange: (e) => { state.q = e.target.value; reload(); } }),
      customerFilter(customers, state.customer_id, (e) => { state.customer_id = e.target.value; reload(); })),
    Object.keys(groups).length ? Object.keys(groups).sort().reverse().map((k) => {
      const [y, m] = k.split("-").map(Number);
      return [h("div", { class: "group-title" }, `${monthName(m - 1)} ${y} · ${groups[k].length}`), h("ul", { class: "list card" }, groups[k].map((t) => taskRow(t, { onChange: reload })))];
    }) : h("div", { class: "card" }, h("div", { class: "empty" }, "Nessun task chiuso.")));
}
