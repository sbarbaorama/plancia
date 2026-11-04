// Righe di elenco riusate in tutte le sezioni (task, modifiche, scadenze, attese, verbali…).
import { put } from "./api.js";
import {
  completeDeadline, emit, followUp, openChangeEditor, openConsultationEditor, openDeadlineEditor, openEventEditor,
  openTaskEditor, openWaitingEditor, startTimer,
} from "./editors.js";
import {
  avatar, badge, checkButton, customerChip, dueClass, fmtDate, fmtDateTime, fmtDue, fmtMin, fmtTime, h, icon, isTeam, label,
  showError, todayISO, toast,
} from "./ui.js";

const changed = () => emit("changed");

export async function toggleTask(t, onChange = changed) {
  try {
    const status = t.status === "chiuso" ? "da_fare" : "chiuso";
    await put(`/api/tasks/${t.id}`, { status });
    if (status === "chiuso") toast(t.recurrence_unit && t.recurrence_unit !== "nessuna" ? "Fatto. Creata la prossima ripetizione" : "Fatto", "ok");
    onChange();
  } catch (err) { showError(err); }
}

export function taskRow(t, { onChange = changed, customer = true, extra = null } = {}) {
  const done = t.status === "chiuso";
  return h("li", { class: `item${done ? " done" : ""}`, onclick: () => openTaskEditor(t, { onSave: onChange }) },
    checkButton(done, () => toggleTask(t, onChange), done ? "Riapri" : "Segna come fatto"),
    h("span", { class: `prio ${t.priority}`, title: `Priorità ${label(t.priority)}` }),
    h("div", { class: "main-col" },
      h("div", { class: "t-title" }, t.title),
      h("div", { class: "meta" },
        t.kind === "consulenza" ? badge("Consulenza", "accent") : null,
        t.status === "in_corso" ? badge("In corso", "info") : t.status === "in_attesa" ? badge("In attesa", "warn") : null,
        t.subtasks_total ? h("span", { class: "progress-txt" }, `${t.subtasks_done}/${t.subtasks_total}`) : null,
        customer ? customerChip(t) : null,
        t.project_name ? h("span", {}, t.project_name) : null,
        t.planned_for === todayISO() && !done ? badge("nel piano di oggi", "accent") : null,
        t.estimate_min ? h("span", {}, fmtMin(t.estimate_min)) : null,
        t.recurrence_unit && t.recurrence_unit !== "nessuna" ? h("span", { title: "Ricorrente" }, "↻") : null,
        t.attachments_count ? h("span", { title: "Allegati", class: "row", style: { gap: "2px" } }, icon("clip"), t.attachments_count) : null,
        extra)),
    isTeam() && t.assignee_name ? avatar(t.assignee_name) : null,
    h("div", { class: `side-col ${dueClass(t.due_date, done)}` }, done ? fmtDate(t.closed_at) : fmtDue(t.due_date)),
    !done ? h("button", { class: "icon-btn", type: "button", title: "Avvia timer", "aria-label": `Avvia timer su ${t.title}`,
      onclick: (e) => { e.stopPropagation(); startTimer(t); } }, icon("play")) : null);
}

export function eventRow(e, { onChange = changed } = {}) {
  return h("li", { class: "item", onclick: () => openEventEditor(e, { onSave: onChange }) },
    h("span", { class: "mono small", style: { width: "48px", color: "var(--muted)" } }, e.all_day ? "giorno" : fmtTime(e.start)),
    h("span", { class: "dot", style: { background: "var(--info)", alignSelf: "stretch", width: "3px", height: "auto", borderRadius: "2px" } }),
    h("div", { class: "main-col" }, h("div", { class: "t-title" }, e.title),
      h("div", { class: "meta" }, customerChip(e), e.location ? h("span", {}, e.location) : null, e.meeting_id ? badge("verbale", "violet") : null)),
    h("div", { class: "side-col" }, fmtDue(e.start.slice(0, 10))));
}

export function consultationRow(c, { onChange = changed } = {}) {
  return h("li", { class: "item", onclick: () => openConsultationEditor(c, { onSave: onChange }) },
    h("span", { class: "dot", style: { background: "var(--accent)" } }),
    h("div", { class: "main-col" }, h("div", { class: "t-title" }, c.title || `Consulenza ${c.consultant_name || ""}`),
      h("div", { class: "meta" }, h("span", {}, c.consultant_name || "—"), customerChip(c),
        h("span", { class: "progress-txt" }, `${c.activities_done}/${c.activities_total} attività`),
        c.status === "chiusa" ? badge("chiusa", "ok") : null)),
    h("div", { class: "side-col" }, fmtDate(c.date_start, { weekday: true })));
}

const OUTCOME_TONE = { pianificata: "info", eseguita: "ok", fallita: "danger", rollback: "warn", annullata: "" };
export function changeRow(c, { onChange = changed } = {}) {
  const when = c.executed_at || c.planned_at;
  return h("li", { class: "item", onclick: () => openChangeEditor(c, { onSave: onChange }) },
    h("div", { class: "main-col" }, h("div", { class: "t-title" }, c.title),
      h("div", { class: "meta" }, badge(label(c.outcome), OUTCOME_TONE[c.outcome]), h("span", {}, label(c.kind)), customerChip(c),
        c.system ? h("span", { class: "mono" }, c.system) : null,
        c.freezes?.length ? badge("in periodo di blocco", "warn") : null,
        c.rollback_plan ? null : c.outcome === "pianificata" ? h("span", { class: "soon" }, "manca il rollback") : null)),
    h("div", { class: "side-col" }, when ? fmtDateTime(when) : "da pianificare"));
}

export function deadlineRow(d, { onChange = changed } = {}) {
  const active = d.status === "attiva";
  const n = d.days_left;
  const when = !active ? (d.status === "fatta" ? `fatta ${fmtDate(d.done_date)}` : "annullata")
    : n < 0 ? `scaduta da ${-n} gg` : n === 0 ? "oggi" : `tra ${n} gg`;
  return h("li", { class: `item${active ? "" : " done"}`, onclick: () => openDeadlineEditor(d, { onSave: onChange }) },
    h("div", { class: "main-col" }, h("div", { class: "t-title" }, d.title),
      h("div", { class: "meta" }, badge(label(d.category)), customerChip(d),
        d.recurrence_unit !== "nessuna" ? h("span", {}, `ogni ${d.recurrence_every > 1 ? `${d.recurrence_every} ` : ""}${label(d.recurrence_unit).toLowerCase()}`) : h("span", {}, "una tantum"))),
    h("div", { class: `side-col ${active && n < 0 ? "late" : active && n <= d.notice_days ? "soon" : ""}` }, h("div", {}, fmtDate(d.due_date, { year: true })), h("div", {}, when)),
    active ? h("button", { class: "btn btn-sm", type: "button", onclick: (e) => { e.stopPropagation(); completeDeadline(d, onChange); } }, "Fatta") : null);
}

export function waitRow(w, { onChange = changed } = {}) {
  const open = w.status === "in_attesa";
  const due = open && w.follow_up_on && w.follow_up_on <= todayISO();
  return h("li", { class: `item${open ? "" : " done"}`, onclick: () => openWaitingEditor(w, { onSave: onChange }) },
    h("div", { class: "main-col" }, h("div", { class: "t-title" }, w.title),
      h("div", { class: "meta" }, h("span", {}, w.contact_name || w.who || "—"), customerChip(w),
        w.ticket_ref ? h("span", { class: "mono" }, w.ticket_ref) : null,
        open ? h("span", {}, `da ${w.days_waiting} gg`) : badge(label(w.status), w.status === "ricevuto" ? "ok" : ""),
        w.follow_ups ? h("span", {}, `${w.follow_ups} solleciti`) : null)),
    open ? h("div", { class: `side-col ${due ? "soon" : ""}` }, w.follow_up_on ? `sollecito ${fmtDue(w.follow_up_on)}` : "") : null,
    open ? h("button", { class: "btn btn-sm", type: "button", onclick: (e) => { e.stopPropagation(); followUp(w, onChange); } }, "Sollecita") : null,
    open ? h("button", { class: "btn btn-sm btn-ghost", type: "button", title: "Ricevuto", onclick: async (e) => {
      e.stopPropagation();
      try { await put(`/api/waiting_items/${w.id}`, { status: "ricevuto" }); toast("Segnato come ricevuto", "ok"); onChange(); } catch (err) { showError(err); }
    } }, icon("check")) : null);
}

export function meetingRow(m) {
  return h("li", { class: "item", onclick: () => { location.hash = `#/riunioni/${m.id}`; } },
    h("div", { class: "main-col" }, h("div", { class: "t-title" }, m.title),
      h("div", { class: "meta" }, m.series ? badge(m.series, "violet") : null, customerChip(m), m.project_name ? h("span", {}, m.project_name) : null,
        m.actions_total ? h("span", { class: m.actions_open ? "soon" : "" }, `${m.actions_open} azioni aperte su ${m.actions_total}`) : null)),
    h("div", { class: "side-col" }, m.date ? fmtDateTime(m.date) : ""));
}

export const list = (items, row, emptyText, opts) => items.length
  ? h("ul", { class: "list" }, items.map((x) => row(x, opts)))
  : h("div", { class: "empty" }, emptyText);
