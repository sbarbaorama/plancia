// Scadenze ricorrenti: certificati, licenze, contratti, verifiche, con preavviso.
import { get, qs } from "../api.js";
import { openDeadlineEditor } from "../editors.js";
import { deadlineRow } from "../rows.js";
import { addDays, clear, customerFilter, h, icon, label, loadCustomers, pageHead, select, todayISO } from "../ui.js";

const state = { customer_id: "", category: "" };

export async function render(root, ctx) {
  const customers = await loadCustomers();
  const f = { customer_id: state.customer_id, category: state.category };
  const [active, done] = await Promise.all([get(`/api/deadlines${qs({ ...f, status: "attiva" })}`), get(`/api/deadlines${qs({ ...f, status: "fatta" })}`)]);
  if (!ctx.isCurrent()) return;
  const reload = () => render(root, ctx);
  const t = todayISO();
  const groups = [
    ["Scadute", active.filter((d) => d.due_date < t), "danger"],
    ["In preavviso", active.filter((d) => d.due_date >= t && addDays(d.due_date, -d.notice_days) <= t), "warn"],
    ["Più avanti", active.filter((d) => addDays(d.due_date, -d.notice_days) > t)],
    ["Fatte negli ultimi 60 giorni", done.filter((d) => (d.done_date || "") >= addDays(t, -60)).reverse()],
  ].filter(([, l]) => l.length);
  clear(root,
    pageHead("Scadenze", "Certificati, licenze, contratti e verifiche periodiche. «Fatta» crea subito la successiva se è ricorrente",
      h("button", { class: "btn btn-primary", type: "button", onclick: () => openDeadlineEditor(null, { onSave: reload, prefill: { customer_id: state.customer_id || null } }) }, icon("plus"), "Nuova scadenza")),
    h("div", { class: "filters" },
      customerFilter(customers, state.customer_id, (e) => { state.customer_id = e.target.value; reload(); }),
      select("category", [["", "Tutte le categorie"], ...["certificato", "licenza", "contratto", "manutenzione", "verifica", "altro"].map((c) => [c, label(c)])], state.category,
        { "aria-label": "Categoria", onchange: (e) => { state.category = e.target.value; reload(); } })),
    groups.length ? groups.map(([title, items, cls]) => [h("div", { class: `group-title ${cls || ""}` }, `${title} · ${items.length}`),
      h("ul", { class: "list card" }, items.map((d) => deadlineRow(d, { onChange: reload })))])
      : h("div", { class: "card" }, h("div", { class: "empty" }, "Nessuna scadenza. Aggiungi certificati, licenze e contratti da tenere d'occhio.")));
}
