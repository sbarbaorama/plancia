// In attesa di: ticket presso fornitori e risposte attese, con solleciti.
import { get, qs } from "../api.js";
import { openWaitingEditor } from "../editors.js";
import { waitRow } from "../rows.js";
import { addDays, clear, customerFilter, h, icon, loadCustomers, pageHead, todayISO } from "../ui.js";

const state = { customer_id: "" };

export async function render(root, ctx) {
  const customers = await loadCustomers();
  const [open, closed] = await Promise.all([
    get(`/api/waiting_items${qs({ customer_id: state.customer_id, status: "in_attesa" })}`),
    get(`/api/waiting_items${qs({ customer_id: state.customer_id, status: "ricevuto,annullato" })}`),
  ]);
  if (!ctx.isCurrent()) return;
  const reload = () => render(root, ctx);
  const t = todayISO();
  const groups = [
    ["Da sollecitare", open.filter((w) => w.follow_up_on && w.follow_up_on <= t), "warn"],
    ["In attesa", open.filter((w) => !w.follow_up_on || w.follow_up_on > t)],
    ["Chiuse di recente", closed.filter((w) => (w.closed_at || "") >= addDays(t, -30))],
  ].filter(([, l]) => l.length);
  clear(root,
    pageHead("In attesa di", "Ticket aperti presso fornitori e risposte da ricevere. «Sollecita» sposta il prossimo sollecito di 3 giorni lavorativi",
      h("button", { class: "btn btn-primary", type: "button", onclick: () => openWaitingEditor(null, { onSave: reload, prefill: { customer_id: state.customer_id || null } }) }, icon("plus"), "Nuova attesa")),
    h("div", { class: "filters" }, customerFilter(customers, state.customer_id, (e) => { state.customer_id = e.target.value; reload(); })),
    groups.length ? groups.map(([title, items, cls]) => [h("div", { class: `group-title ${cls || ""}` }, `${title} · ${items.length}`),
      h("ul", { class: "list card" }, items.map((w) => waitRow(w, { onChange: reload })))])
      : h("div", { class: "card" }, h("div", { class: "empty" }, "Niente in sospeso.")));
}
