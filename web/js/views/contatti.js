// Contatti: rubrica con consulenti e service manager.
import { get, qs } from "../api.js";
import { openContactEditor } from "../editors.js";
import { badge, clear, customerChip, customerFilter, h, icon, loadCustomers, pageHead, segmented } from "../ui.js";

const state = { customer_id: "", kind: "", q: "" };

export async function render(root, ctx) {
  const customers = await loadCustomers();
  const f = { customer_id: state.customer_id, q: state.q };
  if (state.kind === "sm") f.is_service_manager = "1";
  if (state.kind === "cons") f.is_consultant = "1";
  const items = await get(`/api/contacts${qs(f)}`);
  if (!ctx.isCurrent()) return;
  const reload = () => render(root, ctx);
  clear(root,
    pageHead("Contatti", "Rubrica: la spunta «Consulente» li rende disponibili per le consulenze, «Service manager» li collega ai clienti che seguono",
      h("button", { class: "btn btn-primary", type: "button", onclick: () => openContactEditor(null, { onSave: reload, prefill: { customer_id: state.customer_id || null } }) }, icon("plus"), "Nuovo contatto")),
    h("div", { class: "filters" },
      h("input", { type: "search", placeholder: "Cerca nome, azienda, email…", value: state.q, onchange: (e) => { state.q = e.target.value; reload(); } }),
      customerFilter(customers, state.customer_id, (e) => { state.customer_id = e.target.value; reload(); }),
      segmented([["", "Tutti"], ["sm", "Service manager"], ["cons", "Consulenti"]], state.kind, (v) => { state.kind = v; reload(); }, "Tipo")),
    items.length ? h("div", { class: "card table-wrap" }, h("table", { class: "t" },
      h("thead", {}, h("tr", {}, h("th", {}, "Nome"), h("th", {}, "Azienda / ruolo"), h("th", {}, "Cliente"), h("th", {}, "Email"), h("th", {}, "Telefono"), h("th", {}, ""))),
      h("tbody", {}, items.map((c) => h("tr", { style: { cursor: "pointer" }, onclick: () => openContactEditor(c, { onSave: reload }) },
        h("td", {}, h("b", {}, c.name)),
        h("td", {}, [c.company, c.role].filter(Boolean).join(" · ")),
        h("td", {}, customerChip(c), (c.sm_customers || []).map((s) => h("span", { class: "small muted" }, ` SM: ${s.name}`))),
        h("td", {}, c.email ? h("a", { href: `mailto:${c.email}`, onclick: (e) => e.stopPropagation() }, c.email) : ""),
        h("td", { class: "nowrap" }, c.phone ? h("a", { href: `tel:${c.phone.replace(/\s+/g, "")}`, onclick: (e) => e.stopPropagation() }, c.phone) : ""),
        h("td", {}, c.is_service_manager ? badge("SM", "info") : null, " ", c.is_consultant ? badge("consulente", "accent") : null))))))
      : h("div", { class: "card" }, h("div", { class: "empty" }, "Nessun contatto.")));
}
