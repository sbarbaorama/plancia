// Contatti: rubrica con consulenti e service manager. Lista ordinabile per colonna oppure schede.
import { get, qs } from "../api.js";
import { openContactEditor } from "../editors.js";
import {
  avatar, badge, clear, customerChip, customerFilter, h, icon, loadCustomers, pageHead, segmented, sortableTable, sortItems, viewMode, viewToggle,
} from "../ui.js";

const state = { customer_id: "", kind: "", q: "", sort: { key: "last_name", dir: 1 }, view: viewMode("contatti") };

const surname = (c) => c.last_name || c.first_name || c.name;
const mail = (c) => c.email ? h("a", { href: `mailto:${c.email}`, onclick: (e) => e.stopPropagation() }, c.email) : "";
const phone = (c) => c.phone ? h("a", { href: `tel:${c.phone.replace(/\s+/g, "")}`, onclick: (e) => e.stopPropagation() }, c.phone) : "";
const tags = (c) => [c.is_service_manager ? badge("SM", "info") : null, " ", c.is_consultant ? badge("consulente", "accent") : null];

const COLUMNS = [
  { key: "last_name", label: "Cognome", value: surname, cell: (c) => h("b", {}, c.last_name || (c.first_name ? "" : c.name)) },
  { key: "first_name", label: "Nome", value: (c) => c.first_name },
  { key: "company", label: "Azienda" },
  { key: "role", label: "Ruolo" },
  { key: "customer", label: "Cliente", value: (c) => c.customer_code || c.customer_name,
    cell: (c) => [customerChip(c), (c.sm_customers || []).map((s) => h("span", { class: "small muted" }, ` SM: ${s.name}`))] },
  { key: "email", label: "Email", cell: mail },
  { key: "phone", label: "Telefono", cls: "nowrap", cell: phone },
  { key: "kind", label: "Tipo", value: (c) => (c.is_service_manager ? 2 : 0) + (c.is_consultant ? 1 : 0) || null, cell: tags },
];

export async function render(root, ctx) {
  const customers = await loadCustomers();
  const f = { customer_id: state.customer_id, q: state.q };
  if (state.kind === "sm") f.is_service_manager = "1";
  if (state.kind === "cons") f.is_consultant = "1";
  const items = await get(`/api/contacts${qs(f)}`);
  if (!ctx.isCurrent()) return;
  const reload = () => render(root, ctx);
  const open = (c) => openContactEditor(c, { onSave: reload });

  const cardOf = (c) => h("article", { class: "card card-pad contact-card", onclick: () => open(c) },
    h("div", { class: "row", style: { gap: "12px", alignItems: "center" } },
      avatar([c.first_name, c.last_name].filter(Boolean).join(" ") || c.name),
      h("div", { style: { flex: 1, minWidth: 0 } },
        h("div", { class: "contact-name" }, c.last_name ? [h("b", {}, c.last_name), " ", c.first_name] : h("b", {}, c.name)),
        h("div", { class: "small muted" }, [c.company, c.role].filter(Boolean).join(" · ") || "—")),
      tags(c)),
    h("div", { class: "contact-lines small" },
      c.email ? h("div", {}, icon("mail"), mail(c)) : null,
      c.phone ? h("div", {}, phone(c)) : null,
      c.customer_name || c.sm_customers?.length ? h("div", { class: "row" }, customerChip(c),
        (c.sm_customers || []).map((s) => h("span", { class: "muted" }, `SM: ${s.name}`))) : null));

  let body;
  if (!items.length) body = h("div", { class: "card" }, h("div", { class: "empty" }, "Nessun contatto."));
  else if (state.view === "schede") {
    body = h("div", { class: "grid cards-grid" }, sortItems(items, COLUMNS, state.sort).map(cardOf));
  } else {
    body = h("div", { class: "card table-wrap" }, sortableTable({
      columns: COLUMNS, items, sort: state.sort, onRow: open,
      onSort: (s) => { state.sort = s; reload(); },
    }));
  }
  const sortSelect = state.view === "schede" ? h("select", { "aria-label": "Ordina per", onchange: (e) => { const [key, dir] = e.target.value.split(":"); state.sort = { key, dir: Number(dir) }; reload(); } },
    COLUMNS.flatMap((c) => [[`${c.key}:1`, `${c.label} (A→Z)`], [`${c.key}:-1`, `${c.label} (Z→A)`]]).map(([v, l]) =>
      h("option", { value: v, selected: v === `${state.sort.key}:${state.sort.dir}` }, `Ordina: ${l}`))) : null;

  clear(root,
    pageHead("Contatti", "Rubrica: la spunta «Consulente» li rende disponibili per le consulenze, «Service manager» li collega ai clienti che seguono",
      h("button", { class: "btn btn-primary", type: "button", onclick: () => openContactEditor(null, { onSave: reload, prefill: { customer_id: state.customer_id || null } }) }, icon("plus"), "Nuovo contatto")),
    h("div", { class: "filters" },
      h("input", { type: "search", placeholder: "Cerca nome, cognome, azienda, email…", value: state.q, onchange: (e) => { state.q = e.target.value; reload(); } }),
      customerFilter(customers, state.customer_id, (e) => { state.customer_id = e.target.value; reload(); }),
      segmented([["", "Tutti"], ["sm", "Service manager"], ["cons", "Consulenti"]], state.kind, (v) => { state.kind = v; reload(); }, "Tipo"),
      sortSelect,
      h("span", { class: "spacer" }),
      viewToggle("contatti", state.view, (v) => { state.view = v; reload(); })),
    body);
}
