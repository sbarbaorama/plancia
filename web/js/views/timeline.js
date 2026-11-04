// Timeline: i task su un calendario orizzontale (inizio → scadenza), raggruppati per progetto o cliente.
import { get, qs } from "../api.js";
import { openTaskEditor } from "../editors.js";
import { addDays, clear, customerFilter, daysBetween, h, icon, loadCustomers, mondayOf, pageHead, parseISO, segmented, todayISO } from "../ui.js";

const state = { span: "28", group: "project", closed: false, customer_id: "" };

export async function render(root, ctx) {
  const start = ctx.query.from || addDays(mondayOf(todayISO()), -7);
  const days = Number(state.span);
  const end = addDays(start, days - 1);
  const customers = await loadCustomers();
  const all = await get(`/api/tasks${qs({ timeline: "1", customer_id: state.customer_id })}`);
  if (!ctx.isCurrent()) return;
  const tasks = all.filter((t) => {
    const s = t.start_date || t.due_date, e = t.due_date || t.start_date;
    return (state.closed || t.status !== "chiuso") && s <= end && e >= start;
  });
  const reload = () => render(root, ctx);
  const colW = days <= 14 ? 64 : days <= 28 ? 38 : 16;
  const LABEL = 220;
  const width = LABEL + days * colW;
  const head = h("div", { class: "tl-head", style: { gridTemplateColumns: `${LABEL}px repeat(${days}, ${colW}px)` } }, h("div", {}, ""));
  for (let i = 0; i < days; i++) {
    const d = parseISO(addDays(start, i));
    const we = d.getDay() === 0 || d.getDay() === 6;
    head.append(h("div", { class: we ? "we" : "" }, colW >= 38 || d.getDay() === 1 ? `${d.getDate()}/${d.getMonth() + 1}` : ""));
  }
  const inner = h("div", { class: "tl-inner", style: { width: `${width}px` } }, head);
  const keyOf = (t) => state.group === "project" ? (t.project_name || "Senza progetto") : (t.customer_name || "Senza cliente");
  const groups = {};
  for (const t of tasks) (groups[keyOf(t)] = groups[keyOf(t)] || []).push(t);
  const names = Object.keys(groups).sort((a, b) => a.startsWith("Senza") - b.startsWith("Senza") || a.localeCompare(b));
  for (const g of names) {
    inner.append(h("div", { class: "tl-group" }, `${g} · ${groups[g].length}`));
    for (const t of groups[g].sort((a, b) => (a.start_date || a.due_date).localeCompare(b.start_date || b.due_date))) {
      const s = t.start_date || t.due_date, e = t.due_date || t.start_date;
      const x0 = Math.max(0, daysBetween(start, s)), x1 = Math.min(days - 1, daysBetween(start, e));
      const diamond = !t.start_date;
      const late = t.status !== "chiuso" && t.due_date && t.due_date < todayISO();
      inner.append(h("div", { class: "tl-row" }, h("span", { class: "tl-label", title: t.title }, t.title),
        h("div", {
          class: `tl-bar${late ? " late" : ""}${t.status === "chiuso" ? " done" : ""}${diamond ? " diamond" : ""}`,
          style: { left: `${LABEL + x0 * colW + (diamond ? colW / 2 - 8 : 2)}px`, width: diamond ? "16px" : `${Math.max(colW - 4, (x1 - x0 + 1) * colW - 4)}px` },
          title: `${t.title} (${s}${e !== s ? ` → ${e}` : ""})`, onclick: () => openTaskEditor(t, { onSave: reload }),
        }, diamond ? "" : t.title)));
    }
  }
  if (!names.length) inner.append(h("div", { class: "empty" }, "Nessun task con date in questo periodo. Aggiungi una data di inizio o una scadenza ai task per vederli qui."));
  const tOff = daysBetween(start, todayISO());
  if (tOff >= 0 && tOff < days) inner.append(h("div", { class: "tl-today", style: { left: `${LABEL + tOff * colW + colW / 2}px` } }));
  const go = (n) => { location.hash = `#/timeline?from=${addDays(start, n)}`; };
  clear(root,
    pageHead("Timeline", "Le barre vanno dalla data di inizio alla scadenza; senza inizio il task è un rombo sulla scadenza",
      h("button", { class: "icon-btn", type: "button", "aria-label": "Indietro", onclick: () => go(-Math.round(days / 2)) }, icon("left")),
      h("button", { class: "btn btn-sm", type: "button", onclick: () => { location.hash = "#/timeline"; } }, "Oggi"),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Avanti", onclick: () => go(Math.round(days / 2)) }, icon("right")),
      segmented([["14", "2 sett."], ["28", "4 sett."], ["91", "3 mesi"]], state.span, (v) => { state.span = v; reload(); }, "Periodo"),
      segmented([["project", "Per progetto"], ["customer", "Per cliente"]], state.group, (v) => { state.group = v; reload(); }, "Raggruppa"),
      customerFilter(customers, state.customer_id, (e) => { state.customer_id = e.target.value; reload(); }),
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: state.closed, onchange: (e) => { state.closed = e.target.checked; reload(); } }), "Chiusi")),
    h("div", { class: "tl" }, inner));
}
