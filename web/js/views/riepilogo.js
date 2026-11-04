// Riepilogo settimanale (anche per singolo cliente): da copiare in una mail o stampare.
import { get, qs } from "../api.js";
import { changeRow, consultationRow, deadlineRow, list, meetingRow, taskRow, waitRow } from "../rows.js";
import { addDays, card, clear, copyText, customerFilter, fmtDate, fmtHours, h, icon, kpi, loadCustomers, mondayOf, pageHead, printDoc, todayISO } from "../ui.js";

const state = { customer_id: "" };

export async function render(root, ctx) {
  if (ctx.query.customer_id && !ctx.refresh) state.customer_id = ctx.query.customer_id;
  const from = ctx.query.from || mondayOf(todayISO());
  const to = addDays(from, 6);
  const customers = await loadCustomers();
  const r = await get(`/api/report${qs({ from, to, customer_id: state.customer_id })}`);
  if (!ctx.isCurrent()) return;
  const reload = () => render(root, ctx);
  const go = (d) => { location.hash = `#/riepilogo?from=${d}${state.customer_id ? `&customer_id=${state.customer_id}` : ""}`; };
  clear(root,
    pageHead(`Settimana ${fmtDate(from)} – ${fmtDate(to)}`, { eyebrow: "Riepilogo" },
      h("button", { class: "icon-btn", type: "button", "aria-label": "Settimana precedente", onclick: () => go(addDays(from, -7)) }, icon("left")),
      h("button", { class: "btn btn-sm", type: "button", onclick: () => go(mondayOf(todayISO())) }, "Questa settimana"),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Settimana successiva", onclick: () => go(addDays(from, 7)) }, icon("right")),
      customerFilter(customers, state.customer_id, (e) => { state.customer_id = e.target.value; reload(); }),
      h("button", { class: "btn", type: "button", onclick: () => printDoc(h("h1", {}, r.text.split("\n")[0]), h("pre", {}, r.text.split("\n").slice(1).join("\n"))) }, icon("print"), "Stampa"),
      h("button", { class: "btn btn-primary", type: "button", onclick: (e) => copyText(r.text, e.currentTarget) }, icon("copy"), "Copia testo")),
    h("div", { class: "kpis" },
      kpi("Modifiche", r.changes.length, ""), kpi("Task completati", r.closed_tasks.length, ""), kpi("Consulenze", r.consultations.length, ""),
      kpi("Attese aperte", r.waits.length, ""), kpi("Ore registrate", fmtHours(r.minutes), "")),
    h("div", { class: "cols" },
      h("div", { class: "col-main" },
        card("Modifiche", list(r.changes, changeRow, "Nessuna modifica nella settimana")),
        card("Task completati", list(r.closed_tasks, taskRow, "Nessun task completato")),
        r.consultations.length ? card("Consulenze", list(r.consultations, consultationRow, "")) : null,
        r.meetings.length ? card("Riunioni", list(r.meetings, meetingRow, "")) : null),
      h("div", { class: "col-side" },
        card("In attesa di", list(r.waits, waitRow, "Niente in sospeso")),
        card("Scadenze nei prossimi 30 giorni", list(r.deadlines, deadlineRow, "Nessuna")),
        card("Testo per la mail", h("pre", { class: "card-body small", style: { whiteSpace: "pre-wrap", fontFamily: "var(--mono)", margin: 0 } }, r.text)))));
}
