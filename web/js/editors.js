// Editor specifici costruiti sopra quello generico, più le azioni comuni (timer, nuovo…).
import { del, get, post, put } from "./api.js";
import { attachmentsBox } from "./attachments.js";
import { field, openEditor, readForm } from "./form.js";
import { applyFont, fontButton, printFontStyle } from "./fonts.js";
import { imagesOf, pasteImages } from "./paste.js";
import { renderRich, toPlain } from "./richtext.js";
import {
  addDays, autoGrow, badge, customerChip, dueClass, choiceDialog, clear, closePanel, confirmDialog, copyText, fmtDate, fmtDateTime, h, icon, isTeam, label,
  loadContacts, loadCustomers, loadProjects, nowLocal, onSubmitOnce, openPanel, popMenu, printDoc, resolveCombos, showError, store, toast, todayISO,
} from "./ui.js";

export const emit = (name, detail) => window.dispatchEvent(new CustomEvent(`plancia:${name}`, { detail }));
const changed = () => emit("changed");

// ------------------------------------------------------------------ sotto-task
export function subtasksEditor(items = [], { outcome = true, placeholder = "Nuova attività…" } = {}) {
  const wrap = h("div", { class: "subtasks" });
  const rows = [];
  let dragging = null;
  /** Sposta un'attività alla posizione «to» (indice prima dello spostamento). */
  const move = (ref, to) => {
    const from = rows.indexOf(ref);
    to = Math.max(0, Math.min(rows.length, to));
    if (to === from || to === from + 1) return;
    rows.splice(from, 1);
    const at = to > from ? to - 1 : to;
    rows.splice(at, 0, ref);
    wrap.insertBefore(ref.row, rows[at + 1]?.row || addBtn);
  };
  const addRow = (s = {}) => {
    const done = h("input", { type: "checkbox", checked: !!s.done, "aria-label": "Fatto" });
    const title = autoGrow(h("textarea", { rows: 1, class: "line", value: s.title || "", placeholder, maxlength: 300, "aria-label": "Attività" }));
    const out = outcome ? autoGrow(h("textarea", { rows: 1, class: "line outcome", value: s.outcome || "", placeholder: "Esito / note (facoltativo)", maxlength: 2000, "aria-label": "Esito" })) : null;
    const grip = h("span", { class: "grip", title: "Trascina per spostare (oppure Alt+↑/↓ nel titolo)", "aria-hidden": "true" }, icon("grip"));
    const row = h("div", { class: "subtask" }, grip, done, title,
      h("button", { class: "icon-btn", type: "button", "aria-label": "Togli", onclick: () => { row.remove(); rows.splice(rows.indexOf(ref), 1); } }, icon("x")), out);
    const ref = { id: s.id, done, title, out, row };
    rows.push(ref);
    // trascinamento solo dalla maniglia, così nei campi di testo si può selezionare
    grip.addEventListener("mousedown", () => { row.draggable = true; });
    row.addEventListener("dragstart", (e) => { dragging = ref; row.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", ""); });
    row.addEventListener("dragend", () => { row.draggable = false; row.classList.remove("dragging"); dragging = null; });
    row.addEventListener("dragover", (e) => {
      if (!dragging || dragging === ref) return;
      e.preventDefault();
      const after = e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
      move(dragging, rows.indexOf(ref) + (after ? 1 : 0));
    });
    title.addEventListener("keydown", (e) => {
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const i = rows.indexOf(ref);
        move(ref, e.key === "ArrowUp" ? i - 1 : i + 2);
        title.focus();
      }
    });
    title.addEventListener("keydown", (e) => {
      // Invio = nuova attività; Maiusc+Invio = a capo nella stessa
      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); const n = addRow(); n.title.focus(); }
    });
    wrap.insertBefore(row, addBtn);
    return ref;
  };
  const addBtn = h("button", { class: "btn btn-sm btn-ghost", type: "button", style: { alignSelf: "flex-start" }, onclick: () => addRow().title.focus() }, icon("plus"), "Aggiungi");
  wrap.append(addBtn);
  items.forEach(addRow);
  return {
    node: wrap,
    value: () => rows.map((r) => ({ id: r.id, title: r.title.value.trim(), done: r.done.checked, outcome: r.out?.value.trim() || "" })).filter((r) => r.title),
  };
}

// ------------------------------------------------------------------ timer
export async function startTimer(task) {
  try {
    await post("/api/timer/start", { task_id: task?.id || null });
    toast(task ? `Timer avviato: ${task.title}` : "Timer avviato", "ok");
    emit("timer");
    changed();
  } catch (err) { showError(err); }
}
export async function stopTimer() {
  try {
    const r = await post("/api/timer/stop");
    toast(`Registrati ${r.entry.minutes} min`, "ok");
    emit("timer");
    changed();
  } catch (err) { showError(err); }
}

// ------------------------------------------------------------------ task
export async function openTaskEditor(task, { prefill = {}, onSave = changed } = {}) {
  const isNew = !task?.id;
  const subtasks = isNew ? [] : await get(`/api/tasks/${task.id}/subtasks`);
  const sub = subtasksEditor(subtasks);
  let historyBox = null;
  return openEditor("tasks", task, {
    prefill, onSave,
    hide: task?.kind === "consulenza" ? ["linked_consultation_id"] : [],
    title: isNew ? "Nuovo task" : task.kind === "consulenza" ? "Task di consulenza" : "Task",
    extra: () => [
      h("div", { class: "field" }, h("span", { class: "small", style: { fontWeight: 600, color: "var(--muted)" } }, "Sotto-task"), sub.node),
      !isNew ? h("div", { class: "row small muted" },
        task.meeting_id ? h("a", { href: `#/riunioni/${task.meeting_id}`, onclick: () => closePanel() }, `Dal verbale: ${task.meeting_title}`) : null,
        task.consultation_id ? h("a", { href: `#/consulenze?id=${task.consultation_id}`, onclick: () => closePanel() }, "Apri la consulenza") : null,
        task.minutes_spent ? h("span", {}, `Tempo registrato: ${Math.round(task.minutes_spent)} min`) : null,
        task.created_at ? h("span", {}, `Creato ${fmtDateTime(task.created_at)}${task.owner_name && isTeam() ? ` da ${task.owner_name}` : ""}`) : null) : null,
      !isNew ? (historyBox = h("details", {}, h("summary", { class: "small" }, "Storico delle modifiche"), h("ul", { class: "list history" }))) : null,
    ],
    footExtra: () => isNew ? null : [
      h("button", { class: "btn", type: "button", title: "Avvia il timer su questo task", onclick: () => { closePanel(); startTimer(task); } }, icon("play"), "Timer"),
      task.planned_for !== todayISO() ? h("button", { class: "btn", type: "button", onclick: async () => {
        await put(`/api/tasks/${task.id}`, { planned_for: todayISO() }); toast("Aggiunto al piano di oggi", "ok"); closePanel(); changed();
      } }, "Oggi") : null,
    ],
    afterSave: async (saved) => {
      await put(`/api/tasks/${saved.id}/subtasks`, { subtasks: sub.value() });
    },
  }).then((form) => {
    if (historyBox) historyBox.addEventListener("toggle", async () => {
      if (!historyBox.open) return;
      const items = await get(`/api/tasks/${task.id}/history`);
      clear(historyBox.querySelector("ul"), items.map((l) => h("li", {}, h("b", {}, `${fmtDateTime(l.at)} · ${l.action}`),
        l.user_name && isTeam() ? ` (${l.user_name})` : "", l.detail ? h("div", { class: "muted" }, l.detail) : null)));
    }, { once: true });
    return form;
  });
}

// ------------------------------------------------------------------ appuntamenti, modifiche, scadenze, attese…
const EVERY = { giorni: ["giorno", "giorni"], settimane: ["settimana", "settimane"], mesi: ["mese", "mesi"], anni: ["anno", "anni"] };
export function recurrenceText(e) {
  if (!e.recurrence_unit || e.recurrence_unit === "nessuna") return "";
  const [one, many] = EVERY[e.recurrence_unit];
  const n = Number(e.recurrence_every) || 1;
  return `ogni ${n === 1 ? one : `${n} ${many}`}${e.recurrence_until ? ` fino al ${fmtDate(e.recurrence_until, { year: true })}` : ""}`;
}

export const openEventEditor = (ev, { prefill = {}, onSave = changed } = {}) =>
  openEditor("events", ev, {
    prefill: ev?.id ? prefill : { start: nowLocal().slice(0, 11) + "09:00", ...prefill }, onSave,
    extra: async (v, form) => {
      // la ripetizione: «Ogni» e «Fino al» servono solo se si ripete
      const unit = form.elements.namedItem("recurrence_unit");
      const sync = () => {
        const on = unit.value !== "nessuna";
        for (const n of ["recurrence_every", "recurrence_until"]) form.elements.namedItem(n).closest(".field").style.visibility = on ? "" : "hidden";
      };
      unit.addEventListener("change", sync);
      setTimeout(sync, 0);
      // la serie di riunioni: suggerisce quelle già usate
      const series = await get("/api/meetings/series").catch(() => []);
      form.elements.namedItem("series").setAttribute("list", "event-series-list");
      const info = ev?.recurrence_group ? h("div", { class: "banner" }, icon("calendario"),
        `Appuntamento ricorrente (${recurrenceText(ev)}): è il ${ev.occurrence_index}° di ${ev.occurrences}. Salvando o eliminando puoi scegliere se cambiare solo questo o anche i successivi.`) : null;
      return [h("datalist", { id: "event-series-list" }, series.map((s) => h("option", { value: s }))),
        h("p", { class: "hint" }, "«Ripeti» crea in calendario tutte le date fino a «Fino al» (senza data: per un anno). «Serie di riunioni» fa nascere il verbale già nella serie, con le azioni aperte delle riunioni precedenti."),
        info];
    },
    save: async (data, isNew) => {
      if (isNew) return post("/api/events", data);
      const ruleChanged = ["recurrence_unit", "recurrence_every", "recurrence_until"].some((k) => String(data[k] ?? "") !== String(ev[k] ?? ""));
      if (!ev.recurrence_group) return put(`/api/events/${ev.id}/recurring`, { scope: "this", data });
      const scope = ruleChanged ? "following" : await choiceDialog("Appuntamento ricorrente: cosa vuoi modificare?", [
        ["this", "Solo questo"], ["following", "Questo e i successivi", "btn-primary"]]);
      if (!scope) return undefined;
      if (ruleChanged && !(await confirmDialog("Cambiare la ripetizione da questo appuntamento in poi?", { confirm: "Cambia", danger: false,
        detail: "Le date successive vengono ricreate con la nuova regola; quelle che hanno già un verbale restano." }))) return undefined;
      return put(`/api/events/${ev.id}/recurring`, { scope, data });
    },
    remove: async (item) => {
      if (!item.recurrence_group) {
        if (!(await confirmDialog(`Eliminare «${item.title}»?`, { confirm: "Elimina", detail: "Si eliminano anche gli allegati." }))) return false;
        await del(`/api/events/${item.id}`);
        toast("Eliminato");
        return true;
      }
      const scope = await choiceDialog(`Eliminare «${item.title}»?`, [["this", "Solo questo", "btn-danger"], ["following", "Questo e i successivi", "btn-danger"]],
        { detail: "È un appuntamento ricorrente. I verbali collegati restano." });
      if (!scope) return false;
      const r = await del(`/api/events/${item.id}/recurring?scope=${scope}`);
      toast(r.deleted === 1 ? "Eliminato" : `Eliminati ${r.deleted} appuntamenti`);
      return true;
    },
    footExtra: (v) => ev?.id ? h("button", { class: "btn", type: "button", onclick: () => {
      closePanel();
      location.hash = ev.meeting_id ? `#/riunioni/${ev.meeting_id}` : `#/riunioni/new?event_id=${ev.id}`;
    } }, ev.meeting_id ? "Verbale" : "+ Verbale") : null,
  });

export function openChangeEditor(ch, { prefill = {}, onSave = changed } = {}) {
  const warn = h("div", { class: "banner warn", hidden: true });
  return openEditor("changes", ch, {
    prefill, onSave,
    extra: (v, form) => {
      const check = async () => {
        const data = readForm(form, { customer_id: { type: "fk" }, planned_at: { type: "datetime" } });
        if (!data.planned_at) { warn.hidden = true; return; }
        const fz = await get(`/api/changes/check?customer_id=${data.customer_id || ""}&planned_at=${encodeURIComponent(data.planned_at)}`).catch(() => []);
        warn.hidden = !fz.length;
        clear(warn, icon("bell"), `Periodo di blocco: ${fz.map((f) => `${f.title} (${fmtDate(f.start_date)}–${fmtDate(f.end_date)})`).join(", ")}`);
      };
      setTimeout(() => { form.addEventListener("change", check); check(); }, 0);
      return [warn];
    },
    footExtra: () => ch?.id ? h("button", { class: "btn", type: "button", onclick: () => checklistFor(ch) }, "Checklist") : null,
  });
}

async function checklistFor(ch) {
  const templates = await get("/api/checklist_templates");
  if (!templates.length) { toast("Nessun modello di checklist: creane uno nella sezione Checklist"); return; }
  const sel = h("select", {}, templates.map((t) => h("option", { value: t.id }, t.name)));
  const form = h("form", { class: "form" }, h("p", {}, `Avvia una checklist per «${ch.title}»`), h("label", { class: "field" }, "Modello", sel),
    h("div", { class: "panel-foot" }, h("button", { class: "btn btn-primary", type: "submit" }, "Avvia")));
  onSubmitOnce(form, async () => {
    try {
      const run = await post(`/api/checklist_templates/${sel.value}/start`, { customer_id: ch.customer_id, change_id: ch.id });
      closePanel();
      location.hash = `#/checklist/${run.id}`;
    } catch (err) { showError(err); }
  });
  openPanel("Avvia checklist", form);
}

export const openDeadlineEditor = (d, { prefill = {}, onSave = changed } = {}) =>
  openEditor("deadlines", d, {
    prefill, onSave,
    footExtra: () => d?.id && d.status === "attiva" ? h("button", { class: "btn", type: "button", onclick: () => completeDeadline(d, onSave) }, "Fatta…") : null,
  });

export function completeDeadline(d, onSave = changed) {
  const input = h("input", { type: "date", value: todayISO(), required: true });
  const form = h("form", { class: "form" }, h("p", {}, h("b", {}, d.title)), h("label", { class: "field" }, "Fatta il", input),
    h("p", { class: "small muted" }, d.recurrence_unit !== "nessuna" ? "È ricorrente: la prossima scadenza si crea a partire da questa data." : "Scadenza una tantum."),
    h("div", { class: "panel-foot" }, h("button", { class: "btn btn-primary", type: "submit" }, "Segna come fatta"),
      h("button", { class: "btn", type: "button", onclick: () => closePanel() }, "Annulla")));
  onSubmitOnce(form, async () => {
    try {
      const r = await post(`/api/deadlines/${d.id}/complete`, { done_date: input.value });
      toast(r.next ? `Fatta. Prossima: ${fmtDate(r.next.due_date, { year: true })}` : "Scadenza fatta", "ok");
      closePanel();
      onSave(r.done);
    } catch (err) { showError(err); }
  });
  openPanel("Segna come fatta", form);
}

export const openWaitingEditor = (w, { prefill = {}, onSave = changed } = {}) =>
  openEditor("waiting_items", w, {
    prefill: w?.id ? prefill : { requested_on: todayISO(), follow_up_on: addDays(todayISO(), 3), ...prefill }, onSave,
    footExtra: () => w?.id && w.status === "in_attesa" ? h("button", { class: "btn", type: "button", onclick: () => followUp(w, onSave) }, "Sollecita") : null,
  });

export async function followUp(w, onSave = changed) {
  try {
    const r = await post(`/api/waiting_items/${w.id}/follow_up`);
    toast(`Sollecito registrato. Prossimo: ${fmtDate(r.follow_up_on)}`, "ok");
    if (w.contact_email) window.open(`mailto:${encodeURIComponent(w.contact_email)}?subject=${encodeURIComponent(`Sollecito: ${w.title}${w.ticket_ref ? ` (${w.ticket_ref})` : ""}`)}`);
    closePanel();
    onSave(r);
  } catch (err) { showError(err); }
}

export const openNoteEditor = (n, { prefill = {}, onSave = changed } = {}) => openEditor("sticky_notes", n, {
  prefill, onSave, title: n?.id ? "Post-it" : "Nuovo post-it",
  footExtra: () => n?.id ? h("button", { class: "btn", type: "button", onclick: () => { closePanel(); noteToTask(n); } }, "→ Task") : null,
});
export function noteToTask(n) {
  openTaskEditor(null, { prefill: { title: n.title || (n.body || "").split("\n")[0].slice(0, 200), notes: [n.body, n.command].filter(Boolean).join("\n\n"),
    customer_id: n.customer_id, project_id: n.project_id } });
}

export const openProjectEditor = (p, opts = {}) => openEditor("projects", p, { onSave: changed, ...opts });
export const openFreezeEditor = (f, opts = {}) => openEditor("change_freezes", f, { onSave: changed, title: f?.id ? "Blocco modifiche" : "Nuovo blocco modifiche", ...opts });
export const openTimeEditor = (e, opts = {}) => openEditor("time_entries", e, {
  onSave: changed, prefill: e?.id ? {} : { date: todayISO(), minutes: 30, ...(opts.prefill || {}) }, title: e?.id ? "Ore registrate" : "Registra ore",
  layout: [["date", "minutes"], ["customer_id", "project_id"], ["note"]], ...opts,
});
export const openCustomerEditor = (c, opts = {}) => openEditor("customers", c, { onSave: changed, ...opts });

export async function openContactEditor(c, opts = {}) {
  const customers = await loadCustomers();
  const selected = new Set((c?.sm_customers || []).map((x) => x.id));
  const boxes = customers.filter((x) => x.active || selected.has(x.id)).map((x) =>
    h("label", { class: "check" }, h("input", { type: "checkbox", value: x.id, checked: selected.has(x.id) }), x.code ? `${x.code} · ${x.name}` : x.name));
  const smBox = h("fieldset", { class: "card card-pad", style: { border: "1px solid var(--line)" } },
    h("legend", { class: "small", style: { fontWeight: 600 } }, "Clienti seguiti come service manager"),
    boxes.length ? h("div", { class: "form-row" }, boxes) : h("span", { class: "muted small" }, "Nessun cliente"));
  return openEditor("contacts", c, {
    onSave: changed, ...opts,
    extra: (v, form) => {
      const sync = () => { smBox.hidden = !form.elements.namedItem("is_service_manager").checked; };
      setTimeout(() => { form.elements.namedItem("is_service_manager").addEventListener("change", sync); sync(); }, 0);
      return smBox;
    },
    transform: (data) => ({ sm_customer_ids: boxes.map((b) => b.querySelector("input")).filter((i) => i.checked).map((i) => Number(i.value)) }),
    beforeSave: (data) => checkDuplicateContact(data, c?.id),
  });
}

/** Avvisa se in rubrica c'è già una persona con lo stesso nome e cognome (o la stessa email). */
async function checkDuplicateContact(data, id) {
  const norm = (s) => String(s || "").trim().toLocaleLowerCase("it");
  const first = norm(data.first_name), last = norm(data.last_name), email = norm(data.email);
  if (!first && !last) return true;
  const found = await get(`/api/contacts?q=${encodeURIComponent(data.last_name || data.first_name)}`).catch(() => []);
  const extra = email ? await get(`/api/contacts?q=${encodeURIComponent(data.email)}`).catch(() => []) : [];
  const same = [...found, ...extra].filter((x, i, all) => x.id !== id && all.findIndex((y) => y.id === x.id) === i
    && ((norm(x.first_name) === first && norm(x.last_name) === last) || (email && norm(x.email) === email)));
  if (!same.length) return true;
  const who = same.map((x) => `${[x.last_name, x.first_name].filter(Boolean).join(" ") || x.name}${x.company ? ` (${x.company})` : ""}${x.email ? ` · ${x.email}` : ""}`).join(", ");
  return confirmDialog("Questo contatto sembra già in rubrica", { detail: `Esiste già: ${who}. Vuoi salvarlo comunque?`, confirm: "Salva comunque", danger: false });
}

// ------------------------------------------------------------------ task collegati alle consulenze
/** Sceglie la consulenza a cui collegare un task (prima quelle dello stesso cliente). */
export async function linkTaskToConsultation(task, onDone = changed) {
  const all = (await get("/api/consultations")).filter((c) => c.status !== "chiusa" || c.id === task.linked_consultation_id)
    .sort((a, b) => a.date_start.localeCompare(b.date_start));
  const cust = task.eff_customer_id || task.customer_id;
  const same = cust ? all.filter((c) => c.customer_id === cust) : [];
  const others = all.filter((c) => !same.includes(c));
  const link = async (cid) => {
    try {
      await put(`/api/tasks/${task.id}`, { linked_consultation_id: cid });
      toast(cid ? "Task collegato alla consulenza" : "Task scollegato dalla consulenza", "ok");
      closePanel();
      onDone();
    } catch (err) { showError(err); }
  };
  const row = (c) => h("li", { class: `item${c.id === task.linked_consultation_id ? " current" : ""}`, onclick: () => link(c.id) },
    h("div", { class: "main-col" }, h("div", { class: "t-title" }, `${fmtDate(c.date_start, { weekday: true })} · ${c.consultant_name || "Consulente?"}`),
      h("div", { class: "meta" }, customerChip(c), c.title ? h("span", {}, c.title) : null, c.location ? h("span", {}, c.location) : null,
        c.status === "in_corso" ? badge("in corso", "info") : null)),
    c.id === task.linked_consultation_id ? badge("collegato", "accent") : h("span", { class: "small muted" }, "Collega"));
  openPanel("Collega a una consulenza", h("div", { class: "form" },
    h("p", {}, h("b", {}, task.title)),
    h("p", { class: "hint" }, "Il task resta nell'elenco dei task con la sua scadenza, e compare anche nella consulenza e nel rapportino. "
      + "Chiudendo la giornata, se è ancora aperto passa alla consulenza successiva."),
    !all.length ? h("div", { class: "empty" }, "Nessuna consulenza pianificata. Creane una dalla sezione Consulenze.") : null,
    same.length ? [h("div", { class: "group-title" }, "Dello stesso cliente"), h("ul", { class: "list card" }, same.map(row))] : null,
    others.length ? [h("div", { class: "group-title" }, same.length ? "Altre consulenze" : "Consulenze aperte"), h("ul", { class: "list card" }, others.map(row))] : null,
    task.linked_consultation_id ? h("div", {}, h("button", { class: "btn", type: "button", onclick: () => link(null) }, icon("x"), "Scollega dalla consulenza")) : null));
}

/** Riquadro «Task collegati» dentro la consulenza. */
function linkedTasksBox(cons, onChange) {
  const box = h("div", { class: "field" });
  const draw = (items) => clear(box,
    h("span", { class: "small", style: { fontWeight: 600, color: "var(--muted)" } }, "Task collegati"),
    items.length ? h("ul", { class: "list linked-tasks" }, items.map((t) => {
      const done = t.status === "chiuso";
      return h("li", { class: `item${done ? " done" : ""}` },
        h("input", { type: "checkbox", checked: done, "aria-label": done ? "Riapri" : "Segna come fatto", onchange: async (e) => {
          try { await put(`/api/tasks/${t.id}`, { status: e.target.checked ? "chiuso" : "da_fare" }); reload(); onChange(); } catch (err) { showError(err); }
        } }),
        h("div", { class: "main-col" }, h("div", { class: "t-title" }, t.title),
          h("div", { class: "meta" }, customerChip(t), t.due_date ? h("span", { class: dueClass(t.due_date, done) }, `scad. ${fmtDate(t.due_date)}`) : null)),
        h("button", { class: "icon-btn", type: "button", title: "Scollega dalla consulenza", "aria-label": `Scollega ${t.title}`, onclick: async () => {
          try { await put(`/api/tasks/${t.id}`, { linked_consultation_id: null }); reload(); onChange(); } catch (err) { showError(err); }
        } }, icon("x")));
    })) : h("span", { class: "small muted" }, "Nessuno. Collega qui i task da fare durante la giornata (restano anche nell'elenco dei task)."),
    h("button", { class: "btn btn-sm btn-ghost", type: "button", style: { alignSelf: "flex-start" }, onclick: () => pickTask(items) }, icon("link"), "Collega un task"));
  const reload = async () => draw((await get(`/api/consultations/${cons.id}`)).linked_tasks || []);
  const pickTask = async (current) => {
    const open = (await get("/api/tasks?open=1")).filter((t) => t.kind !== "consulenza" && !current.some((c) => c.id === t.id));
    const q = h("input", { type: "search", placeholder: "Cerca tra i task aperti…", "aria-label": "Cerca task" });
    const list = h("ul", { class: "list card", style: { maxHeight: "50vh", overflowY: "auto" } });
    const fill = () => {
      const s = q.value.trim().toLocaleLowerCase("it");
      const shown = open.filter((t) => !s || t.title.toLocaleLowerCase("it").includes(s))
        .sort((a, b) => (b.eff_customer_id === cons.customer_id) - (a.eff_customer_id === cons.customer_id));
      clear(list, shown.length ? shown.slice(0, 100).map((t) => h("li", { class: "item", onclick: async () => {
        try { await put(`/api/tasks/${t.id}`, { linked_consultation_id: cons.id }); pop.close(); reload(); onChange(); } catch (err) { showError(err); }
      } }, h("div", { class: "main-col" }, h("div", { class: "t-title" }, t.title),
        h("div", { class: "meta" }, customerChip(t), t.linked_consultation_id ? h("span", {}, "già in un'altra consulenza") : null,
          t.due_date ? h("span", {}, `scad. ${fmtDate(t.due_date)}`) : null)))) : h("li", { class: "empty" }, "Nessun task aperto"));
    };
    q.addEventListener("input", fill);
    const pop = h("dialog", { "aria-label": "Collega un task", style: { width: "min(560px, 92vw)" } },
      h("div", { class: "dialog-body stack" }, h("h2", {}, "Collega un task alla consulenza"), q, list),
      h("div", { class: "dialog-foot" }, h("button", { class: "btn", type: "button", onclick: () => pop.close() }, "Chiudi")));
    pop.addEventListener("close", () => pop.remove());
    document.body.append(pop);
    fill();
    pop.showModal();
    q.focus();
  };
  draw(cons.linked_tasks || []);
  return box;
}

// ------------------------------------------------------------------ consulenze
export async function openConsultationEditor(cons, { prefill = {}, onSave = changed } = {}) {
  const isNew = !cons?.id;
  const full = isNew ? null : await get(`/api/consultations/${cons.id}`);
  const [contacts, customers, projects] = await Promise.all([loadContacts(), loadCustomers(), loadProjects()]);
  const fk = { contacts, customers, projects };
  const v = { date_start: todayISO(), status: "pianificata", ...(full || {}), ...prefill };
  const fields = store.schema.resources.consultations.fields;
  const extraFields = {
    title: { type: "text", label: "Titolo" }, project_id: { type: "fk", label: "Progetto", options: "projects" },
    notes: { type: "longtext", label: "Note", options: "rich" },
  };
  const acts = subtasksEditor(full?.activities || [], { placeholder: "Attività della giornata…" });
  const form = h("form", { class: "form" },
    h("div", { class: "row", style: { justifyContent: "flex-end", marginBottom: "-6px" } }, fontButton("consulenze")),
    h("div", { class: "form-row" }, field("consultant_id", fields.consultant_id, v.consultant_id, fk), field("customer_id", fields.customer_id, v.customer_id, fk)),
    field("title", extraFields.title, v.title || "", fk),
    h("div", { class: "form-row" }, field("date_start", fields.date_start, v.date_start, fk), field("date_end", fields.date_end, v.date_end, fk)),
    h("div", { class: "form-row" }, field("location", fields.location, v.location, fk), field("project_id", extraFields.project_id, v.project_id, fk)),
    h("div", { class: "field" }, h("span", { class: "small", style: { fontWeight: 600, color: "var(--muted)" } }, "Attività"), acts.node),
    !isNew ? linkedTasksBox(full, () => {}) : h("p", { class: "hint" }, "Dopo aver creato la consulenza potrai collegarle dei task già esistenti."),
    field("closing_note", fields.closing_note, v.closing_note, fk),
    field("notes", extraFields.notes, v.notes, fk),
    h("fieldset", { class: "card card-pad next-cons" },
      h("legend", { class: "small", style: { fontWeight: 600 } }, "Prossima consulenza"),
      h("div", { class: "form-row" }, field("next_mode", fields.next_mode, v.next_mode || "nessuna", fk), field("next_date", fields.next_date, v.next_date, fk)),
      field("carry_open", fields.carry_open, v.carry_open ?? 1, fk),
      h("p", { class: "hint" }, "Quando premi «Chiudi giornata» nasce la prossima consulenza con lo stesso consulente, cliente e luogo. "
        + "Le attività non chiuse vengono copiate nella prossima consulenza del consulente (anche se l'hai già pianificata tu)."),
      !isNew && full.next_id ? h("a", { class: "small", href: `#/consulenze?id=${full.next_id}`, onclick: () => closePanel() }, "Apri la consulenza successiva") : null),
    !isNew ? attachmentsBox("consultations", cons.id) : null);
  const all = { ...fields, ...extraFields };
  const nextMode = form.elements.namedItem("next_mode");
  const syncNext = () => { form.elements.namedItem("next_date").closest(".field").style.visibility = nextMode.value === "data" ? "" : "hidden"; };
  nextMode.addEventListener("change", syncNext);
  syncNext();
  applyFont(form, "consulenze");
  const pasted = pasteImages(form, "consultations", isNew ? null : cons.id);
  const foot = h("div", { class: "panel-foot" },
    h("button", { class: "btn btn-primary", type: "submit" }, isNew ? "Crea" : "Salva"),
    !isNew && full.status !== "chiusa" ? h("button", { class: "btn", type: "button", onclick: () => saveThen("close") }, "Chiudi giornata") : null,
    !isNew && full.status === "chiusa" ? h("button", { class: "btn", type: "button", onclick: () => saveThen("reopen") }, "Riapri") : null,
    h("span", { class: "spacer" }),
    !isNew ? h("button", { class: "icon-btn", type: "button", title: "Altre azioni", "aria-label": "Altre azioni", onclick: (e) => popMenu(e.currentTarget, [
      ["Stampa rapportino", "print", () => printConsultation(full)],
      ["Copia riepilogo per mail", "copy", () => copyText(consultationText(full))],
      ["Duplica per la prossima settimana", "plus", async () => {
        try { const c = await post(`/api/consultations/${cons.id}/duplicate`); toast(`Creata per il ${fmtDate(c.date_start)}`, "ok"); closePanel(); onSave(c); } catch (err) { showError(err); }
      }],
      ["Elimina", "trash", async () => {
        if (!(await confirmDialog("Eliminare questa consulenza?", { confirm: "Elimina" }))) return;
        try { await (await import("./api.js")).del(`/api/consultations/${cons.id}`); closePanel(); onSave(null); } catch (err) { showError(err); }
      }],
    ]) }, icon("menu")) : null);
  form.append(foot);
  form.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); } });
  const collect = async () => { await resolveCombos(form); return { ...readForm(form, all), activities: acts.value() }; };
  async function saveThen(action) {
    try {
      const saved = await put(`/api/consultations/${cons.id}`, await collect());
      const r = action === "close" ? await post(`/api/consultations/${cons.id}/close`, { closing_note: form.elements.namedItem("closing_note").value })
        : await post(`/api/consultations/${cons.id}/reopen`);
      if (action === "close") {
        const n = r?.next;
        toast(n ? `Giornata chiusa. ${r.next_created ? "Creata la prossima consulenza" : "Prossima consulenza"}: ${fmtDate(n.date_start, { weekday: true })}`
          + (r.carried ? ` · ${r.carried === 1 ? "1 attività riportata" : `${r.carried} attività riportate`}` : "")
          + (r.moved_tasks ? ` · ${r.moved_tasks === 1 ? "1 task collegato spostato" : `${r.moved_tasks} task collegati spostati`}` : "") : "Giornata chiusa", "ok", 6000);
      } else toast("Riaperta", "ok");
      closePanel();
      onSave(r || saved);
    } catch (err) { showError(err); }
  }
  onSubmitOnce(form, async () => {
    try {
      const data = await collect();
      const saved = isNew ? await post("/api/consultations", data) : await put(`/api/consultations/${cons.id}`, data);
      if (isNew && saved?.id) await pasted.flush(saved.id);
      toast(isNew ? "Consulenza creata" : "Salvata", "ok");
      closePanel();
      onSave(saved);
    } catch (err) { showError(err); }
  });
  openPanel(isNew ? "Nuova consulenza" : "Consulenza", form);
}

export function consultationText(c) {
  const acts = [...(c.activities || []).map((a) => `- [${a.done ? "x" : " "}] ${a.title}${a.outcome ? ` — ${a.outcome}` : ""}`),
    ...(c.linked_tasks || []).map((t) => `- [${t.status === "chiuso" ? "x" : " "}] ${t.title}`)].join("\n");
  return [`Consulenza ${fmtDate(c.date_start, { year: true })}${c.date_end && c.date_end !== c.date_start ? ` – ${fmtDate(c.date_end, { year: true })}` : ""}`,
    `Consulente: ${c.consultant_name || ""}${c.consultant_company ? ` (${c.consultant_company})` : ""}`,
    c.customer_name ? `Cliente: ${c.customer_name}` : "", c.location ? `Luogo: ${c.location}` : "", "", "Attività:", acts || "—",
    c.closing_note ? `\nNote di chiusura:\n${toPlain(c.closing_note)}` : ""].filter((x) => x !== "").join("\n");
}

export async function printConsultation(c) {
  const images = await imagesOf("consultations", c.id);
  const used = new Set();
  const notes = c.notes ? renderRich(c.notes, { images, used }) : null;
  const closing = c.closing_note ? renderRich(c.closing_note, { images, used }) : null;
  const rest = images.filter((a) => !used.has(a.name));
  printDoc(h("div", { style: printFontStyle("consulenze") },
    h("h1", {}, "Rapportino di consulenza"),
    h("div", { class: "meta" }, `${fmtDate(c.date_start, { year: true })}${c.date_end && c.date_end !== c.date_start ? ` – ${fmtDate(c.date_end, { year: true })}` : ""}`,
      ` · Consulente: ${c.consultant_name || ""}${c.consultant_company ? ` (${c.consultant_company})` : ""}`,
      c.customer_name ? ` · Cliente: ${c.customer_name}` : "", c.location ? ` · ${c.location}` : ""),
    h("h2", {}, "Attività"),
    h("table", {}, h("tr", {}, h("th", {}, "Attività"), h("th", {}, "Fatto"), h("th", {}, "Esito")),
      (c.activities || []).map((a) => h("tr", {}, h("td", {}, a.title), h("td", {}, a.done ? "Sì" : "No"), h("td", {}, a.outcome || ""))),
      (c.linked_tasks || []).map((t) => h("tr", {}, h("td", {}, t.title), h("td", {}, t.status === "chiuso" ? "Sì" : "No"), h("td", {}, "")))),
    notes ? [h("h2", {}, "Note"), h("div", { class: "rich-print" }, notes)] : null,
    closing ? [h("h2", {}, "Note di chiusura"), h("div", { class: "rich-print" }, closing)] : null,
    rest.length ? [h("h2", {}, "Immagini"), h("div", { class: "print-images" }, rest.map((a) => h("figure", {}, h("img", { src: `/api/attachments/${a.id}/file`, alt: a.name }), h("figcaption", {}, a.name))))] : null,
    h("div", { class: "sign" }, h("div", {}, "Firma del consulente"), h("div", {}, "Firma per il cliente"))));
}

// ------------------------------------------------------------------ menu "Nuovo"
export const NEW_ACTIONS = [
  ["Task", "task", () => openTaskEditor(null)],
  ["Appuntamento", "calendario", () => openEventEditor(null)],
  ["Verbale di riunione", "riunioni", () => { location.hash = "#/riunioni/new"; }],
  ["Consulenza", "consulenze", () => openConsultationEditor(null)],
  ["Modifica", "modifiche", () => openChangeEditor(null)],
  ["Scadenza", "scadenze", () => openDeadlineEditor(null)],
  ["Attesa", "attese", () => openWaitingEditor(null)],
  ["Post-it", "note", () => openNoteEditor(null)],
  ["Procedura", "procedure", () => import("./views/procedure.js").then((m) => m.openProcedureEditor(null))],
  ["Ore lavorate", "ore", () => openTimeEditor(null)],
  ["Cliente", "clienti", () => openCustomerEditor(null)],
  ["Contatto", "contatti", () => openContactEditor(null)],
  ["Progetto", "progetti", () => openProjectEditor(null)],
];
export const newMenu = (anchor) => popMenu(anchor, NEW_ACTIONS);
export { label };
