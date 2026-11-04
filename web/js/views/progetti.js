// Progetti: riquadri con avanzamento; la pagina del progetto raccoglie task, verbali, appuntamenti e note.
import { get, qs } from "../api.js";
import { attachmentsBox } from "../attachments.js";
import { openEventEditor, openProjectEditor, openTaskEditor } from "../editors.js";
import { eventRow, list, meetingRow, taskRow } from "../rows.js";
import { badge, card, clear, customerChip, customerFilter, fmtDue, h, icon, kpi, label, loadCustomers, pageHead, segmented, todayISO } from "../ui.js";

const state = { customer_id: "", status: "attivo" };

export async function render(root, ctx) {
  if (ctx.id) return renderOne(root, ctx);
  const customers = await loadCustomers();
  const items = await get(`/api/projects${qs({ customer_id: state.customer_id, status: state.status === "tutti" ? "" : state.status })}`);
  if (!ctx.isCurrent()) return;
  const reload = () => render(root, ctx);
  clear(root,
    pageHead("Progetti", "Raccolgono task, verbali, appuntamenti e documenti",
      h("button", { class: "btn btn-primary", type: "button", onclick: () => openProjectEditor(null, { onSave: reload, prefill: { customer_id: state.customer_id || null } }) }, icon("plus"), "Nuovo progetto")),
    h("div", { class: "filters" },
      segmented([["attivo", "Attivi"], ["in_pausa", "In pausa"], ["chiuso", "Chiusi"], ["tutti", "Tutti"]], state.status, (v) => { state.status = v; reload(); }, "Stato"),
      customerFilter(customers, state.customer_id, (e) => { state.customer_id = e.target.value; reload(); })),
    items.length ? h("div", { class: "grid", style: { gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" } }, items.map((p) => {
      const tot = p.open_tasks + p.closed_tasks;
      return h("a", { class: "card card-pad", href: `#/progetti/${p.id}`, style: { color: "inherit", textDecoration: "none", display: "flex", flexDirection: "column", gap: "10px", borderTop: `4px solid ${p.color}` } },
        h("div", { class: "row" }, h("h2", { style: { flex: 1 } }, p.name), p.status !== "attivo" ? badge(label(p.status)) : null),
        h("div", { class: "row small muted" }, customerChip(p), h("span", {}, `${p.open_tasks} aperti`), p.meetings_count ? h("span", {}, `${p.meetings_count} verbali`) : null,
          p.next_due ? h("span", { class: p.next_due < todayISO() ? "late" : "" }, `prossima scad. ${fmtDue(p.next_due)}`) : null),
        h("div", { class: "bar" }, h("span", { style: { width: tot ? `${Math.round((p.closed_tasks / tot) * 100)}%` : "0%" } })),
        p.description ? h("div", { class: "small muted", style: { overflow: "hidden", maxHeight: "40px" } }, p.description) : null);
    })) : h("div", { class: "card" }, h("div", { class: "empty" }, "Nessun progetto.")));
}

async function renderOne(root, ctx) {
  const p = await get(`/api/projects/${ctx.id}`);
  const [open, closed, meetings, events] = await Promise.all([
    get(`/api/tasks?project_id=${p.id}&open=1`), get(`/api/tasks?project_id=${p.id}&status=chiuso&limit=20`),
    get(`/api/meetings?project_id=${p.id}`), get(`/api/events?project_id=${p.id}&from=${todayISO()}`),
  ]);
  if (!ctx.isCurrent()) return;
  const reload = () => render(root, ctx);
  const tot = open.length + p.closed_tasks;
  clear(root,
    pageHead(p.name, { eyebrow: h("a", { href: "#/progetti" }, "← Progetti") },
      h("button", { class: "btn", type: "button", onclick: () => openProjectEditor(p, { onSave: (x) => x ? reload() : (location.hash = "#/progetti") }) }, icon("edit"), "Modifica"),
      h("a", { class: "btn", href: `#/riunioni/new` }, "+ Verbale"),
      h("button", { class: "btn btn-primary", type: "button", onclick: () => openTaskEditor(null, { prefill: { project_id: p.id }, onSave: reload }) }, icon("plus"), "Task")),
    h("div", { class: "kpis" },
      kpi("Avanzamento", tot ? `${Math.round((p.closed_tasks / tot) * 100)}%` : "—", `${p.closed_tasks} chiusi su ${tot}`),
      kpi("Task aperti", open.length, open.filter((t) => t.due_date && t.due_date < todayISO()).length ? `${open.filter((t) => t.due_date && t.due_date < todayISO()).length} in ritardo` : "", open.some((t) => t.due_date && t.due_date < todayISO()) ? "warn" : ""),
      kpi("Cliente", p.customer_code || p.customer_name || "—", p.customer_name || "", "", p.customer_id ? `#/clienti/${p.customer_id}` : null),
      kpi("Stato", label(p.status), "")),
    h("div", { class: "cols" },
      h("div", { class: "col-main" },
        card("Task aperti", list(open, taskRow, "Nessun task aperto", { onChange: reload })),
        closed.length ? card("Chiusi di recente", list(closed, taskRow, "", { onChange: reload })) : null),
      h("div", { class: "col-side" },
        p.description ? card("Descrizione", h("div", { class: "card-body", style: { whiteSpace: "pre-wrap" } }, p.description)) : null,
        card("Prossimi appuntamenti", list(events, eventRow, "Nessuno"), { actions: h("button", { class: "btn btn-sm", type: "button", onclick: () => openEventEditor(null, { prefill: { project_id: p.id }, onSave: reload }) }, "+") }),
        card("Verbali", list(meetings, meetingRow, "Nessun verbale")),
        h("section", { class: "card card-pad" }, attachmentsBox("projects", p.id)))));
}
