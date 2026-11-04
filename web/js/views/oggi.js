// Oggi: il quadro della giornata (numeri di sintesi, piano, agenda, solleciti, scadenze, modifiche).
import { get } from "../api.js";
import { openEventEditor, openTaskEditor } from "../editors.js";
import { changeRow, consultationRow, deadlineRow, eventRow, list, taskRow, waitRow } from "../rows.js";
import { card, clear, fmtDate, fmtLongDate, fmtMin, h, icon, kpi, me, plural, store } from "../ui.js";

function greeting() {
  const hr = new Date().getHours();
  const name = store.session?.mode === "team" ? `, ${me().name.split(" ")[0]}` : "";
  return `${hr < 13 ? "Buongiorno" : hr < 18 ? "Buon pomeriggio" : "Buonasera"}${name}`;
}

export async function render(root, ctx) {
  const d = await get("/api/dashboard");
  if (!ctx.isCurrent()) return;
  const open = d.plan.filter((t) => t.status !== "chiuso");
  const doneN = d.plan.length - open.length;
  const planBody = d.plan.length
    ? h("div", {}, h("div", { style: { padding: "0 18px 8px" } }, h("div", { class: "bar" }, h("span", { style: { width: `${Math.round((doneN / d.plan.length) * 100)}%` } }))),
      list(d.plan, taskRow, ""))
    : h("div", { class: "empty" }, "Nessun task nel piano di oggi. ", h("a", { href: "#/pianifica" }, "Pianifica la giornata →"));
  const agenda = [...d.consultations_today.map((c) => ({ t: "00:00", node: consultationRow(c) })),
    ...d.events_today.map((e) => ({ t: e.all_day ? "00:00" : e.start.slice(11, 16), node: eventRow(e) }))].sort((a, b) => a.t.localeCompare(b.t));
  const late = [...d.overdue, ...d.due_today.filter((t) => t.planned_for !== d.today)];

  clear(root,
    h("div", { class: "page-head" },
      h("div", { class: "titles" }, h("div", { class: "eyebrow" }, fmtLongDate(d.today)), h("h1", {}, greeting())),
      h("div", { class: "toolbar" },
        h("a", { class: "btn", href: "#/pianifica" }, icon("pianifica"), "Pianifica la giornata"),
        h("button", { class: "btn btn-primary", type: "button", onclick: () => openTaskEditor(null) }, icon("plus"), "Task"))),
    d.last_backup_error ? h("div", { class: "banner danger" }, `Backup non riuscito: ${d.last_backup_error}. `, h("a", { href: "#/impostazioni" }, "Controlla le impostazioni"))
      : d.backup_stale ? h("div", { class: "banner warn" }, `Ultimo backup: ${d.last_backup ? fmtDate(d.last_backup) : "mai"}. `, h("a", { href: "#/impostazioni" }, "Fai un backup ora")) : null,
    h("div", { class: "kpis" },
      kpi("In ritardo", d.overdue.length, d.overdue.length ? `il più vecchio: ${fmtDate(d.overdue[0].due_date)}` : "tutto in pari", d.overdue.length ? "danger" : "", "#/task"),
      kpi("Piano di oggi", `${doneN}/${d.plan.length}`, open.length ? `${fmtMin(open.reduce((s, t) => s + (t.estimate_min || 0), 0))} stimati` : "", "", "#/pianifica"),
      kpi("Da sollecitare", d.waiting_followup.length, plural(d.waiting_followup.length, "attesa", "attese"), d.waiting_followup.length ? "warn" : "", "#/attese"),
      kpi("Scadenze in preavviso", d.deadlines_due.length, d.deadlines_due[0] ? `${d.deadlines_due[0].title} · ${fmtDate(d.deadlines_due[0].due_date)}` : "nessuna", d.deadlines_due.length ? "warn" : "", "#/scadenze"),
      kpi("Ore registrate", fmtMin(d.minutes_today), `settimana: ${fmtMin(d.minutes_week)}`, "", "#/ore")),
    h("div", { class: "cols" },
      h("div", { class: "col-main" },
        card("Il piano di oggi", planBody, { meta: d.plan.length ? `${doneN} fatti su ${d.plan.length}` : "", actions: h("a", { class: "btn btn-sm", href: "#/pianifica" }, "Pianifica") }),
        late.length ? card("In ritardo e in scadenza oggi", list(late, taskRow, ""), { meta: plural(late.length, "task", "task") }) : null,
        d.due_week.length ? card("Scadono nei prossimi 7 giorni", list(d.due_week, taskRow, "")) : null,
        d.in_progress.filter((t) => t.planned_for !== d.today).length
          ? card("In corso", list(d.in_progress.filter((t) => t.planned_for !== d.today), taskRow, "")) : null),
      h("div", { class: "col-side" },
        card("Agenda", agenda.length ? h("ul", { class: "list" }, agenda.map((a) => a.node)) : h("div", { class: "empty" }, "Nessun appuntamento oggi"),
          { actions: h("button", { class: "btn btn-sm", type: "button", onclick: () => openEventEditor(null) }, "+") }),
        d.waiting_followup.length ? card("Da sollecitare", list(d.waiting_followup, waitRow, "")) : null,
        d.deadlines_due.length ? card("Scadenze in arrivo", list(d.deadlines_due, deadlineRow, "")) : null,
        d.changes_upcoming.length ? card("Modifiche in programma", list(d.changes_upcoming, changeRow, ""), { meta: "7 giorni" }) : null,
        d.inbox_count ? h("a", { class: "banner", href: "#/inbox" }, icon("inbox"), `${plural(d.inbox_count, "nota", "note")} da smistare nell'Inbox`) : null,
        d.recent_meetings.length ? card("Ultimi verbali", h("ul", { class: "list" }, d.recent_meetings.map((m) =>
          h("li", { class: "item", onclick: () => { location.hash = `#/riunioni/${m.id}`; } }, h("div", { class: "main-col" }, h("div", { class: "t-title" }, m.title),
            h("div", { class: "meta" }, m.customer_code ? h("span", { class: "chip" }, m.customer_code) : null, m.actions_open ? h("span", { class: "soon" }, `${m.actions_open} azioni aperte`) : null)),
          h("div", { class: "side-col" }, m.date ? fmtDate(m.date) : ""))))) : null)));
}
