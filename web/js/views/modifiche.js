// Modifiche: registro con piano di rollback ed esito, calendario delle modifiche e periodi di blocco.
import { get, qs } from "../api.js";
import { openChangeEditor, openFreezeEditor } from "../editors.js";
import { changeRow } from "../rows.js";
import {
  addDays, clear, customerFilter, fmtDate, h, icon, label, listOrCards, loadCustomers, mondayOf, pageHead, parseISO, select, tabs, todayISO,
  viewMode, viewToggle,
} from "../ui.js";

const state = { tab: "registro", customer_id: "", outcome: "", kind: "", q: "" };
let view = viewMode("modifiche");
const DOW = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];

/** Griglia di due settimane lavorative (usata anche nella pagina cliente). */
export function changeCalendarGrid(cal, onOpen) {
  const days = [];
  let d = cal.from;
  while (d <= cal.to && days.length < 14) {
    const wd = parseISO(d).getDay();
    if (wd !== 0 && wd !== 6) days.push(d);
    d = addDays(d, 1);
  }
  return h("div", { class: "chgcal" }, h("div", { class: "chgcal-grid", style: { gridTemplateColumns: `repeat(${days.length}, minmax(92px, 1fr))` } }, days.map((day) => {
    const fz = cal.freezes.filter((f) => f.start_date <= day && f.end_date >= day);
    const items = cal.changes.filter((c) => (c.executed_at || c.planned_at || "").slice(0, 10) === day);
    return h("div", { class: `chgday${fz.length ? " frozen" : day === todayISO() ? " today" : ""}` },
      h("div", { class: "d" }, `${DOW[parseISO(day).getDay()]} ${parseISO(day).getDate()}`, day === todayISO() ? " · oggi" : ""),
      items.map((c) => h("div", { class: `chg ${c.outcome}`, title: `${c.title} — ${label(c.outcome)}${c.customer_code ? ` (${c.customer_code})` : ""}`, onclick: () => onOpen(c) },
        `${(c.executed_at || c.planned_at || "").slice(11, 16)} ${c.title}`)),
      fz.map((f) => h("div", { class: "fz" }, `Blocco: ${f.title}${f.customer_code ? "" : " (tutti)"}`)));
  })));
}

export const CHANGE_LEGEND = () => h("div", { class: "legend" },
  h("span", { style: { "--c": "var(--info)" } }, "pianificata"), h("span", { style: { "--c": "var(--ok)" } }, "eseguita"),
  h("span", { style: { "--c": "var(--warn-solid)" } }, "fallita / rollback"), h("span", { style: { "--c": "var(--warn-soft)" } }, "periodo di blocco"));

export async function render(root, ctx) {
  if (ctx.query.tab && !ctx.refresh) state.tab = ctx.query.tab;
  const customers = await loadCustomers();
  const reload = () => render(root, ctx);
  let body;
  if (state.tab === "registro") {
    const items = await get(`/api/changes${qs({ customer_id: state.customer_id, outcome: state.outcome, kind: state.kind, q: state.q })}`);
    const planned = items.filter((c) => c.outcome === "pianificata").reverse();
    const rest = items.filter((c) => c.outcome !== "pianificata");
    body = [
      h("div", { class: "filters" },
        h("input", { type: "search", placeholder: "Cerca…", value: state.q, onchange: (e) => { state.q = e.target.value; reload(); } }),
        customerFilter(customers, state.customer_id, (e) => { state.customer_id = e.target.value; reload(); }),
        select("outcome", [["", "Ogni esito"], ...["pianificata", "eseguita", "fallita", "rollback", "annullata"].map((o) => [o, label(o)])], state.outcome, { "aria-label": "Esito", onchange: (e) => { state.outcome = e.target.value; reload(); } }),
        select("kind", [["", "Ogni tipo"], ...["nuovo_host", "soglie", "upgrade", "regola", "certificato", "altro"].map((o) => [o, label(o)])], state.kind, { "aria-label": "Tipo", onchange: (e) => { state.kind = e.target.value; reload(); } }),
        h("span", { class: "spacer" }), viewToggle("modifiche", view, (v) => { view = v; reload(); })),
      planned.length ? [h("div", { class: "group-title" }, `Pianificate · ${planned.length}`), h("ul", { class: listOrCards(view) }, planned.map((c) => changeRow(c, { onChange: reload })))] : null,
      h("div", { class: "group-title" }, `Registro · ${rest.length}`),
      rest.length ? h("ul", { class: listOrCards(view) }, rest.map((c) => changeRow(c, { onChange: reload }))) : h("div", { class: "card" }, h("div", { class: "empty" }, "Nessuna modifica registrata.")),
    ];
  } else if (state.tab === "calendario") {
    const start = ctx.query.from || mondayOf(todayISO());
    const cal = await get(`/api/changes/calendar${qs({ from: start, to: addDays(start, 13), customer_id: state.customer_id })}`);
    body = [
      h("div", { class: "filters" },
        h("button", { class: "icon-btn", type: "button", "aria-label": "Indietro", onclick: () => { location.hash = `#/modifiche?tab=calendario&from=${addDays(start, -14)}`; } }, icon("left")),
        h("b", {}, `${fmtDate(start)} – ${fmtDate(addDays(start, 13))}`),
        h("button", { class: "icon-btn", type: "button", "aria-label": "Avanti", onclick: () => { location.hash = `#/modifiche?tab=calendario&from=${addDays(start, 14)}`; } }, icon("right")),
        customerFilter(customers, state.customer_id, (e) => { state.customer_id = e.target.value; reload(); }), CHANGE_LEGEND()),
      h("section", { class: "card card-pad" }, changeCalendarGrid(cal, (c) => openChangeEditor(c, { onSave: reload }))),
    ];
  } else {
    const items = await get(`/api/change_freezes${qs({ customer_id: state.customer_id })}`);
    body = [
      h("p", { class: "muted" }, "Nei periodi di blocco le modifiche pianificate vengono segnalate (es. chiusure contabili, eventi del cliente, ferie)."),
      items.length ? h("ul", { class: "list card" }, items.map((f) => h("li", { class: `item${f.end_date < todayISO() ? " done" : ""}`, onclick: () => openFreezeEditor(f, { onSave: reload }) },
        h("div", { class: "main-col" }, h("div", { class: "t-title" }, f.title), h("div", { class: "meta" }, f.customer_code ? h("span", { class: "chip" }, f.customer_code) : h("span", {}, "Tutti i clienti"))),
        h("div", { class: "side-col" }, `${fmtDate(f.start_date, { year: true })} – ${fmtDate(f.end_date, { year: true })}`))))
        : h("div", { class: "card" }, h("div", { class: "empty" }, "Nessun periodo di blocco.")),
    ];
  }
  if (!ctx.isCurrent()) return;
  clear(root,
    pageHead("Modifiche", "Nuovi host, soglie, upgrade e regole: con piano di rollback, esito e calendario",
      state.tab === "blocchi" ? h("button", { class: "btn", type: "button", onclick: () => openFreezeEditor(null, { onSave: reload }) }, icon("plus"), "Blocco") : null,
      h("button", { class: "btn btn-primary", type: "button", onclick: () => openChangeEditor(null, { onSave: reload, prefill: { customer_id: state.customer_id || null } }) }, icon("plus"), "Nuova modifica")),
    tabs([["registro", "Registro"], ["calendario", "Calendario"], ["blocchi", "Periodi di blocco"]], state.tab, (t) => { state.tab = t; history.replaceState(null, "", `#/modifiche?tab=${t}`); reload(); }),
    body);
}
