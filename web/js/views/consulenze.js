// Consulenze: giornate con i consulenti, per giornata o per consulente; rapportino, riepilogo, duplica.
import { get, qs } from "../api.js";
import { consultationText, openConsultationEditor, printConsultation } from "../editors.js";
import { consultationRow } from "../rows.js";
import {
  addDays, badge, clear, copyText, customerChip, customerFilter, fmtDate, h, icon, loadCustomers, mondayOf, pageHead, segmented, todayISO,
  viewMode, viewToggle,
} from "../ui.js";

const state = { mode: "giornata", customer_id: "", view: viewMode("consulenze", "schede") };

export async function render(root, ctx) {
  const customers = await loadCustomers();
  const items = await get(`/api/consultations${qs({ customer_id: state.customer_id })}`);
  if (!ctx.isCurrent()) return;
  const reload = () => render(root, ctx);
  if (ctx.query.id && !ctx.refresh) {
    const c = items.find((x) => String(x.id) === ctx.query.id);
    if (c) setTimeout(() => openConsultationEditor(c, { onSave: reload }), 0);
  }
  const tile = (c) => h("article", { class: "card card-pad", style: { display: "flex", flexDirection: "column", gap: "8px", cursor: "pointer" }, onclick: () => openConsultationEditor(c, { onSave: reload }) },
    h("div", { class: "row" }, h("b", { style: { flex: 1 } }, fmtDate(c.date_start, { weekday: true }), c.date_end && c.date_end !== c.date_start ? ` – ${fmtDate(c.date_end)}` : ""),
      c.status === "chiusa" ? badge("chiusa", "ok") : c.status === "in_corso" ? badge("in corso", "info") : badge("pianificata")),
    h("div", { style: { fontWeight: 600 } }, c.consultant_name || "Consulente?"),
    h("div", { class: "row small muted" }, customerChip(c), c.location ? h("span", {}, c.location) : null, c.project_name ? h("span", {}, c.project_name) : null),
    h("div", { class: "hbar" }, h("div", { class: "bar" }, h("span", { style: { width: c.activities_total ? `${(c.activities_done / c.activities_total) * 100}%` : "0%" } })),
      h("span", { class: "progress-txt" }, `${c.activities_done}/${c.activities_total}`)),
    h("div", { class: "row" },
      h("button", { class: "btn btn-sm", type: "button", onclick: async (e) => { e.stopPropagation(); printConsultation(await get(`/api/consultations/${c.id}`)); } }, icon("print"), "Rapportino"),
      h("button", { class: "btn btn-sm", type: "button", onclick: async (e) => { e.stopPropagation(); copyText(consultationText(await get(`/api/consultations/${c.id}`))); } }, icon("copy"), "Riepilogo")));
  const grid = (list) => state.view === "lista"
    ? h("ul", { class: "list card" }, list.map((c) => consultationRow(c, { onChange: reload })))
    : h("div", { class: "grid", style: { gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" } }, list.map(tile));
  let body;
  if (state.mode === "giornata") {
    const mon = mondayOf(todayISO()), sun = addDays(mon, 6);
    const groups = [
      ["Questa settimana", items.filter((c) => c.date_start >= mon && c.date_start <= sun).reverse()],
      ["Prossime", items.filter((c) => c.date_start > sun).reverse()],
      ["Passate", items.filter((c) => c.date_start < mon)],
    ].filter(([, l]) => l.length);
    body = groups.length ? groups.map(([t, l]) => [h("div", { class: "group-title" }, `${t} · ${l.length}`), grid(l)])
      : h("div", { class: "card" }, h("div", { class: "empty" }, "Nessuna consulenza. I consulenti sono i contatti con la casella «Consulente»."));
  } else {
    const by = {};
    for (const c of items) (by[c.consultant_name || "—"] = by[c.consultant_name || "—"] || []).push(c);
    body = Object.keys(by).sort().map((k) => [h("div", { class: "group-title" }, `${k} · ${by[k].length}`), grid(by[k])]);
  }
  clear(root,
    pageHead("Consulenze", "Le giornate con i consulenti: attività con esito, rapportino con le firme e riepilogo per la mail",
      h("button", { class: "btn btn-primary", type: "button", onclick: () => openConsultationEditor(null, { onSave: reload, prefill: { customer_id: state.customer_id || null } }) }, icon("plus"), "Nuova consulenza")),
    h("div", { class: "filters" },
      segmented([["giornata", "Per giornata"], ["consulente", "Per consulente"]], state.mode, (v) => { state.mode = v; reload(); }, "Raggruppa"),
      customerFilter(customers, state.customer_id, (e) => { state.customer_id = e.target.value; reload(); }),
      h("span", { class: "spacer" }), viewToggle("consulenze", state.view, (v) => { state.view = v; reload(); })),
    body);
}
