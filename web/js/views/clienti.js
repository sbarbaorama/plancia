// Clienti: elenco e cockpit del cliente (numeri di sintesi, calendario modifiche, attività recente, scadenze, attese, ore).
import { get } from "../api.js";
import {
  openChangeEditor, openContactEditor, openCustomerEditor, openDeadlineEditor, openEventEditor, openNoteEditor, openTaskEditor,
  openWaitingEditor,
} from "../editors.js";
import { changeRow, consultationRow, deadlineRow, eventRow, list, meetingRow, taskRow, waitRow } from "../rows.js";
import {
  badge, card, clear, copyText, customerChip, fmtDate, fmtDateTime, fmtDue, fmtHours, fmtMin, h, icon, kpi, label, pageHead, popMenu,
  segmented, showError, tabs, todayISO,
} from "../ui.js";
import { CHANGE_LEGEND, changeCalendarGrid } from "./modifiche.js";

const FEED_MAX = 8;
let showAllFeed = false;

const state = { active: "1", q: "" };
const RES_LABEL = { tasks: "Task", changes: "Modifica", deadlines: "Scadenza", waiting_items: "Attesa", meetings: "Verbale", events: "Appuntamento",
  consultations: "Consulenza", projects: "Progetto", contacts: "Contatto", customers: "Cliente", sticky_notes: "Post-it", checklist_runs: "Checklist", change_freezes: "Blocco" };
const RES_COLOR = { tasks: "var(--info-ink)", changes: "var(--warn)", deadlines: "var(--violet)", waiting_items: "var(--muted)", meetings: "var(--violet)",
  consultations: "var(--accent-ink)", events: "var(--info-ink)" };

export async function render(root, ctx) {
  if (ctx.id) return renderCockpit(root, ctx);
  const items = await get(`/api/customers${state.active === "1" ? "?active=1" : ""}`);
  if (!ctx.isCurrent()) return;
  const reload = () => render(root, ctx);
  const q = state.q.toLowerCase();
  const shown = items.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.code || "").toLowerCase().includes(q));
  clear(root,
    pageHead("Clienti", "Ogni cliente ha il suo cockpit: attività, modifiche, scadenze, attese e ore",
      h("button", { class: "btn btn-primary", type: "button", onclick: () => openCustomerEditor(null, { onSave: reload }) }, icon("plus"), "Nuovo cliente")),
    h("div", { class: "filters" },
      h("input", { type: "search", placeholder: "Cerca cliente o sigla…", value: state.q, oninput: (e) => { state.q = e.target.value; reload(); } }),
      segmented([["1", "Attivi"], ["", "Tutti"]], state.active, (v) => { state.active = v; reload(); }, "Stato")),
    shown.length ? h("div", { class: "grid", style: { gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" } }, shown.map((c) =>
      h("a", { class: "card card-pad", href: `#/clienti/${c.id}`, style: { color: "inherit", textDecoration: "none", display: "flex", gap: "14px", alignItems: "center" } },
        h("div", { class: "cust-tile", style: { width: "48px", height: "48px", fontSize: "14px" } }, c.code || c.name.slice(0, 3).toUpperCase()),
        h("div", { style: { flex: 1, minWidth: 0 } },
          h("div", { style: { fontWeight: 650 } }, c.name, !c.active ? h("span", { class: "muted small" }, " · non attivo") : null),
          h("div", { class: "row small muted", style: { marginTop: "4px" } },
            h("span", {}, `${c.open_tasks} task`), c.open_waits ? h("span", {}, `${c.open_waits} attese`) : null,
            c.deadlines_due ? h("span", { class: "soon" }, `${c.deadlines_due} scadenze`) : null, c.projects_count ? h("span", {}, `${c.projects_count} progetti`) : null)))))
      : h("div", { class: "card" }, h("div", { class: "empty" }, "Nessun cliente.")));
}

async function renderCockpit(root, ctx) {
  const tab = ctx.query.tab || "panoramica";
  const d = await get(`/api/customers/${ctx.id}/cockpit`);
  if (!ctx.isCurrent()) return;
  const c = d.customer, k = d.kpi;
  const reload = () => render(root, ctx);
  const pre = { customer_id: c.id };
  const go = (t) => { history.replaceState(null, "", `#/clienti/${c.id}?tab=${t}`); render(root, { ...ctx, query: { tab: t } }); };
  const contractPct = k.contract_hours ? Math.round((k.minutes_month / 60 / k.contract_hours) * 100) : null;

  let body;
  if (tab === "panoramica") {
    const feedItems = showAllFeed ? d.feed : d.feed.slice(0, FEED_MAX);
    const totalH = d.hours_by_project.reduce((s, x) => s + x.minutes, 0);
    body = [
      card("Calendario modifiche · prossime due settimane", h("div", { class: "card-body stack" }, CHANGE_LEGEND(), changeCalendarGrid(d.calendar, (x) => openChangeEditor(x, { onSave: reload }))),
        { actions: h("button", { class: "btn btn-sm", type: "button", onclick: () => openChangeEditor(null, { prefill: pre, onSave: reload }) }, "+ Modifica") }),
      h("div", { class: "cols", style: { marginTop: "20px" } },
        h("div", { class: "col-main" },
          card("Task aperti", list(d.tasks.slice(0, 12), taskRow, "Nessun task aperto", { onChange: reload, customer: false }),
            { meta: d.tasks.length > 12 ? `12 di ${d.tasks.length}` : "", actions: h("button", { class: "btn btn-sm", type: "button", onclick: () => openTaskEditor(null, { prefill: pre, onSave: reload }) }, "+ Task") }),
          card("Attività recente", d.feed.length ? h("ul", { class: "list feed card-body" }, feedItems.map((f) => h("li", { class: "item" },
            h("span", { class: "kind", style: { color: RES_COLOR[f.resource] || "var(--muted)" } }, RES_LABEL[f.resource] || f.resource),
            h("div", { class: "main-col" }, h("div", {}, f.title, h("span", { class: "muted" }, ` — ${f.action}`)), f.detail ? h("div", { class: "small muted" }, f.detail) : null),
            h("span", { class: "small muted nowrap" }, fmtDateTime(f.at), f.user_name && f.user_name !== "Io" ? ` · ${f.user_name}` : ""))))
            : h("div", { class: "empty" }, "Ancora nessuna attività registrata per questo cliente"),
            { meta: d.feed.length > FEED_MAX ? `ultime ${feedItems.length} di ${d.feed.length}` : "", actions: d.feed.length > FEED_MAX ? h("button", { class: "btn btn-sm", type: "button", onclick: () => { showAllFeed = !showAllFeed; render(root, ctx); } }, showAllFeed ? "Mostra meno" : "Mostra tutte") : null })),
        h("div", { class: "col-side" },
          card("Scadenze", list(d.deadlines.slice(0, 6), deadlineRow, "Nessuna scadenza attiva", { onChange: reload }),
            { actions: h("button", { class: "btn btn-sm", type: "button", onclick: () => openDeadlineEditor(null, { prefill: pre, onSave: reload }) }, "+") }),
          card("In attesa di", list(d.waits, waitRow, "Niente in sospeso", { onChange: reload }),
            { actions: h("button", { class: "btn btn-sm", type: "button", onclick: () => openWaitingEditor(null, { prefill: pre, onSave: reload }) }, "+") }),
          card("Ore registrate · questo mese", h("div", { class: "card-body stack" },
            h("div", { class: "row" }, h("span", { style: { fontSize: "24px", fontWeight: 700 } }, fmtHours(k.minutes_month)),
              k.contract_hours ? h("span", { class: contractPct > 100 ? "soon" : "muted" }, `su ${k.contract_hours} h a contratto (${contractPct}%)`) : null),
            totalH ? h("div", { class: "bar", style: { height: "10px" } }, d.hours_by_project.slice(0, 3).map((x, i) => h("span", { class: i ? `b${i + 1}` : "", style: { width: `${(x.minutes / totalH) * 100}%` } }))) : null,
            h("div", { class: "row small muted" }, d.hours_by_project.map((x) => h("span", {}, `${x.label} ${fmtMin(x.minutes)}`))),
            h("a", { class: "small", href: `#/ore?customer_id=${c.id}` }, "Dettaglio ore →"))),
          d.events.length ? card("Prossimi appuntamenti", list(d.events.slice(0, 5), eventRow, "")) : null))];
  } else if (tab === "task") {
    body = card(null, list(d.tasks, taskRow, "Nessun task aperto", { onChange: reload, customer: false }));
  } else if (tab === "modifiche") {
    const all = await get(`/api/changes?customer_id=${c.id}`);
    body = card(null, list(all, changeRow, "Nessuna modifica", { onChange: reload }));
  } else if (tab === "scadenze") {
    body = card(null, list(d.deadlines, deadlineRow, "Nessuna scadenza attiva", { onChange: reload }));
  } else if (tab === "attese") {
    body = card(null, list(d.waits, waitRow, "Niente in sospeso", { onChange: reload }));
  } else if (tab === "riunioni") {
    body = card(null, list(d.meetings, meetingRow, "Nessun verbale"));
  } else if (tab === "consulenze") {
    body = card(null, list(d.consultations, consultationRow, "Nessuna consulenza", { onChange: reload }));
  } else if (tab === "contatti") {
    body = card(null, d.contacts.length ? h("ul", { class: "list" }, d.contacts.map((p) => h("li", { class: "item", onclick: () => openContactEditor(p, { onSave: reload }) },
      h("div", { class: "main-col" }, h("div", { class: "t-title" }, p.name), h("div", { class: "meta" }, p.role ? h("span", {}, p.role) : null, p.is_service_manager ? badge("SM", "info") : null, p.is_consultant ? badge("consulente", "accent") : null)),
      h("div", { class: "side-col" }, p.email ? h("a", { href: `mailto:${p.email}`, onclick: (e) => e.stopPropagation() }, p.email) : null, p.phone ? h("div", {}, p.phone) : null))))
      : h("div", { class: "empty" }, "Nessun contatto"), { actions: h("button", { class: "btn btn-sm", type: "button", onclick: () => openContactEditor(null, { prefill: pre, onSave: reload }) }, "+ Contatto") });
  } else if (tab === "note") {
    body = h("div", { class: "notes-board" }, d.notes.map((n) => h("article", { class: `postit ${n.color}`, onclick: () => openNoteEditor(n, { onSave: reload }) },
      n.title ? h("h3", {}, n.title) : null, n.body ? h("div", { class: "body" }, n.body) : null, n.command ? h("div", { class: "cmd" }, n.command) : null)),
    h("button", { class: "postit giallo", type: "button", style: { alignItems: "center", justifyContent: "center", font: "inherit" }, onclick: () => openNoteEditor(null, { prefill: pre, onSave: reload }) }, "+ Post-it"));
  } else if (tab === "progetti") {
    body = card(null, d.projects.length ? h("ul", { class: "list" }, d.projects.map((p) => h("li", { class: "item", onclick: () => { location.hash = `#/progetti/${p.id}`; } },
      h("span", { class: "dot", style: { background: p.color } }), h("div", { class: "main-col" }, h("div", { class: "t-title" }, p.name), h("div", { class: "meta" }, `${p.open_tasks} aperti · ${label(p.status)}`)))))
      : h("div", { class: "empty" }, "Nessun progetto"));
  }

  const sms = c.service_managers || [];
  clear(root,
    h("div", { class: "small muted", style: { marginBottom: "10px" } }, h("a", { href: "#/clienti" }, "Clienti"), ` / ${c.name}`),
    h("div", { class: "cust-head" },
      h("div", { class: "cust-tile" }, c.code || c.name.slice(0, 3).toUpperCase()),
      h("div", { style: { flex: "1 1 320px" } },
        h("h1", {}, c.name),
        h("div", { class: "cust-meta" },
          h("span", { style: { color: c.active ? "var(--ok)" : "var(--muted)", fontWeight: 600 } }, c.active ? "● Attivo" : "○ Non attivo"),
          sms.length ? h("span", {}, "Service manager: ", sms.map((s, i) => [i ? ", " : "", s.email ? h("a", { href: `mailto:${s.email}` }, s.name) : s.name])) : null,
          d.projects.length ? h("span", {}, `Progetti: ${d.projects.filter((p) => p.status !== "chiuso").map((p) => p.name).join(", ") || "—"}`) : null)),
      h("div", { class: "toolbar" },
        h("a", { class: "btn", href: `#/riepilogo?customer_id=${c.id}` }, "Riepilogo settimana"),
        h("button", { class: "btn", type: "button", onclick: () => openCustomerEditor(c, { onSave: (x) => x ? reload() : (location.hash = "#/clienti") }) }, icon("edit"), "Modifica"),
        h("button", { class: "btn btn-primary", type: "button", onclick: (e) => popMenu(e.currentTarget, [
          ["Task", "task", () => openTaskEditor(null, { prefill: pre, onSave: reload })],
          ["Modifica", "modifiche", () => openChangeEditor(null, { prefill: pre, onSave: reload })],
          ["Appuntamento", "calendario", () => openEventEditor(null, { prefill: pre, onSave: reload })],
          ["Verbale", "riunioni", () => { location.hash = "#/riunioni/new"; }],
          ["Scadenza", "scadenze", () => openDeadlineEditor(null, { prefill: pre, onSave: reload })],
          ["Attesa", "attese", () => openWaitingEditor(null, { prefill: pre, onSave: reload })],
          ["Contatto", "contatti", () => openContactEditor(null, { prefill: pre, onSave: reload })],
          ["Post-it", "note", () => openNoteEditor(null, { prefill: pre, onSave: reload })],
        ]) }, icon("plus"), "Nuovo"))),
    h("div", { class: "kpis" },
      kpi("Task aperti", k.open_tasks, k.overdue ? `${k.overdue} in ritardo` : "nessuno in ritardo", k.overdue ? "warn" : ""),
      kpi("In attesa di", k.waits, k.waits_due ? `${k.waits_due} da sollecitare` : "", k.waits_due ? "warn" : ""),
      kpi("Scadenze ≤ 30 gg", k.deadlines_30, k.next_deadline ? `${k.next_deadline.title} · ${fmtDue(k.next_deadline.due_date)}` : "nessuna", k.deadlines_30 ? "warn" : ""),
      kpi("Modifiche nel mese", k.changes_month, k.changes_bad ? `${k.changes_bad} fallite o con rollback` : "tutte regolari"),
      kpi("Prossimo appuntamento", k.next_event ? fmtDate(k.next_event.start, { weekday: true }) : "—", k.next_event ? `${k.next_event.title} · ${k.next_event.start.slice(11, 16)}` : ""),
      kpi("Ore nel mese", fmtHours(k.minutes_month), k.contract_hours ? `${contractPct}% di ${k.contract_hours} h` : "", contractPct > 100 ? "warn" : "")),
    tabs([["panoramica", "Panoramica"], ["task", "Task", d.tasks.length], ["modifiche", "Modifiche"], ["scadenze", "Scadenze", d.deadlines.length],
      ["attese", "Attese", d.waits.length], ["riunioni", "Riunioni", d.meetings.length], ["consulenze", "Consulenze", d.consultations.length],
      ["progetti", "Progetti", d.projects.length], ["contatti", "Contatti", d.contacts.length], ["note", "Note", d.notes.length]], tab, go),
    body,
    c.notes ? card("Note sul cliente", h("div", { class: "card-body", style: { whiteSpace: "pre-wrap" } }, c.notes), { cls: "", actions: h("button", { class: "icon-btn", type: "button", "aria-label": "Copia", onclick: () => copyText(c.notes) }, icon("copy")) }) : null);
  void showError; void todayISO; void customerChip;
}
