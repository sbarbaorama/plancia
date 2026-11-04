// Palette comandi (Ctrl K): vai a, crea, cerca ovunque, crea un task scrivendo una frase.
import { get, post } from "./api.js";
import {
  NEW_ACTIONS, emit, openChangeEditor, openConsultationEditor, openContactEditor, openCustomerEditor, openDeadlineEditor,
  openEventEditor, openNoteEditor, openProjectEditor, openTaskEditor, openWaitingEditor, stopTimer, startTimer,
} from "./editors.js";
import { openImportPanel } from "./importa.js";
import { addDays, clear, debounce, fmtDate, h, icon, loadCustomers, showError, store, toast, todayISO, toISO } from "./ui.js";

const NAV_ITEMS = () => import("./app.js").then((m) => Object.entries(m.SECTIONS).filter(([k]) => k !== "cerca"));

const KIND = {
  tasks: ["Task", (x) => openTaskEditor(x)], events: ["Appuntamento", (x) => openEventEditor(x)],
  meetings: ["Verbale", (x) => { location.hash = `#/riunioni/${x.id}`; }], projects: ["Progetto", (x) => { location.hash = `#/progetti/${x.id}`; }],
  customers: ["Cliente", (x) => { location.hash = `#/clienti/${x.id}`; }], contacts: ["Contatto", (x) => openContactEditor(x)],
  changes: ["Modifica", (x) => openChangeEditor(x)], deadlines: ["Scadenza", (x) => openDeadlineEditor(x)],
  waiting_items: ["Attesa", (x) => openWaitingEditor(x)], sticky_notes: ["Post-it", (x) => openNoteEditor(x)],
  consultations: ["Consulenza", (x) => openConsultationEditor(x)], inbox_items: ["Inbox", () => { location.hash = "#/inbox"; }],
  checklist_templates: ["Checklist", () => { location.hash = "#/checklist"; }], change_freezes: ["Blocco", () => { location.hash = "#/modifiche?tab=blocchi"; }],
  time_entries: ["Ore", () => { location.hash = "#/ore"; }],
  attachments: ["Allegato", (x) => { window.open(x.kind === "file" ? `/api/attachments/${x.id}/file` : x.url, "_blank", "noopener"); }],
};
const titleOf = (x) => x.title || x.name || x.text || x.location || x.note || "";
const subOf = (x) => [x.customer_code || x.customer_name, x.due_date ? `scad. ${fmtDate(x.due_date)}` : null, x.date_start ? fmtDate(x.date_start) : null, x.company].filter(Boolean).join(" · ");

const WEEKDAYS = { lun: 1, mar: 2, mer: 3, gio: 4, ven: 5, sab: 6, dom: 0,
  "lunedì": 1, "martedì": 2, "mercoledì": 3, "giovedì": 4, "venerdì": 5, "sabato": 6, "domenica": 0,
  lunedi: 1, martedi: 2, mercoledi: 3, giovedi: 4, venerdi: 5 };
/** "task FRL rinnovo certificato ven" → titolo, cliente (sigla), scadenza. */
export async function parseQuick(text) {
  const customers = await loadCustomers();
  const words = text.trim().split(/\s+/);
  let customer = null, due = null, priority = null;
  const rest = [];
  for (const w of words) {
    const lw = w.toLowerCase().replace(/^@/, "");
    const c = customers.find((x) => x.code && x.code.toLowerCase() === lw);
    if (c && !customer) { customer = c; continue; }
    if (lw === "oggi") { due = todayISO(); continue; }
    if (lw === "domani") { due = addDays(todayISO(), 1); continue; }
    if (Object.hasOwn(WEEKDAYS, lw)) {
      const target = WEEKDAYS[lw];
      const d = new Date();
      let diff = (target - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      due = toISO(d);
      continue;
    }
    const m = lw.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (m) {
      const d = new Date(new Date().getFullYear(), Number(m[2]) - 1, Number(m[1]));
      if (toISO(d) < todayISO()) d.setFullYear(d.getFullYear() + 1);
      due = toISO(d);
      continue;
    }
    if (lw === "!" || lw === "!alta" || lw === "urgente") { priority = "alta"; continue; }
    rest.push(w);
  }
  return { title: rest.join(" "), customer, due, priority };
}

export function openPalette() {
  if (document.querySelector(".palette-wrap")) return;
  const input = h("input", { type: "text", placeholder: "Cerca, vai a una sezione, oppure scrivi «task …» o «nota …»", "aria-label": "Comando", autocomplete: "off" });
  const listEl = h("div", { class: "palette-list", role: "listbox" });
  const wrap = h("div", { class: "palette-wrap", onmousedown: (e) => { if (e.target === wrap) close(); } },
    h("div", { class: "palette", role: "dialog", "aria-label": "Palette comandi" },
      h("label", { class: "palette-input" }, icon("search"), input),
      listEl,
      h("div", { class: "palette-foot" }, h("span", {}, "↑ ↓ scegli"), h("span", {}, "Invio esegui"),
        h("span", {}, "«task @SIGLA titolo ven» crea un task"), h("span", { style: { marginLeft: "auto" } }, "Esc chiudi"))));
  document.body.append(wrap);
  input.focus();
  let items = [];
  let sel = 0;
  const prevFocus = document.activeElement;
  function close() { wrap.remove(); prevFocus?.focus?.(); }

  function draw(groups) {
    items = [];
    clear(listEl);
    for (const [title, entries] of groups) {
      if (!entries.length) continue;
      listEl.append(h("div", { class: "palette-group" }, title));
      for (const e of entries) {
        const i = items.length;
        const el = h("div", { class: "palette-item", role: "option", onmousemove: () => select(i), onclick: () => run(i) },
          h("span", { class: "k" }, e.kind), h("span", { class: "tt" }, e.title, e.sub ? h("span", { class: "sub" }, `  ${e.sub}`) : null),
          e.hint ? h("kbd", {}, e.hint) : null);
        items.push({ ...e, el });
        listEl.append(el);
      }
    }
    if (!items.length) listEl.append(h("div", { class: "empty" }, "Nessun risultato"));
    select(0);
  }
  function select(i) {
    if (!items.length) return;
    sel = Math.max(0, Math.min(items.length - 1, i));
    items.forEach((it, j) => { it.el.classList.toggle("sel", j === sel); it.el.setAttribute("aria-selected", String(j === sel)); });
    items[sel].el.scrollIntoView({ block: "nearest" });
  }
  async function run(i) {
    const it = items[i];
    if (!it) return;
    close();
    try { await it.run(); } catch (err) { showError(err); }
  }

  const base = async () => {
    const nav = (await NAV_ITEMS()).map(([k, t]) => ({ kind: "Vai a", title: t, run: () => { location.hash = `#/${k}`; } }));
    const create = NEW_ACTIONS.map(([t, , fn]) => ({ kind: "Crea", title: t, run: fn }));
    const actions = [
      { kind: "Azione", title: "Importa da Outlook", run: () => openImportPanel() },
      { kind: "Azione", title: "Avvia timer senza task", run: () => startTimer(null) },
      { kind: "Azione", title: "Ferma il timer", run: () => stopTimer() },
      { kind: "Azione", title: "Chiudi la giornata", run: () => { location.hash = "#/pianifica?close=1"; } },
    ];
    return [["Crea", create], ["Vai a", nav], ["Azioni", actions]];
  };

  const filterGroups = (groups, q) => groups.map(([t, list]) => [t, list.filter((e) => e.title.toLowerCase().includes(q))]);

  const update = debounce(async () => {
    const q = input.value.trim();
    const lq = q.toLowerCase();
    const groups = await base();
    if (!q) { draw(groups); return; }
    const quick = [];
    const m = q.match(/^(task|t|nota|n|\+)\s+(.+)/i);
    if (m) {
      const kind = m[1].toLowerCase();
      if (kind === "nota" || kind === "n") {
        quick.push({ kind: "Inbox", title: `Salva nota: ${m[2]}`, run: async () => { await post("/api/inbox_items", { text: m[2] }); toast("Nota salvata", "ok"); emit("changed"); } });
      } else {
        const p = await parseQuick(m[2]);
        const sub = [p.customer ? p.customer.code : null, p.due ? `scadenza ${fmtDate(p.due)}` : null, p.priority ? "alta priorità" : null].filter(Boolean).join(" · ");
        quick.push({ kind: "Crea task", title: p.title || "(senza titolo)", sub, hint: "Invio", run: async () => {
          if (!p.title) { openTaskEditor(null, { prefill: { customer_id: p.customer?.id, due_date: p.due } }); return; }
          const t = await post("/api/tasks", { title: p.title, customer_id: p.customer?.id || null, due_date: p.due, priority: p.priority || "media" });
          toast(`Task creato: ${t.title}`, "ok");
          emit("changed");
        } });
        quick.push({ kind: "Crea task", title: "…e apri l'editor", run: () => openTaskEditor(null, { prefill: { title: p.title, customer_id: p.customer?.id, due_date: p.due, priority: p.priority || "media" } }) });
      }
    }
    let found = [];
    if (q.length >= 2 && !m) {
      try {
        const res = await get(`/api/search?q=${encodeURIComponent(q)}&limit=6`);
        for (const [type, rows] of Object.entries(res)) {
          const [kind, open] = KIND[type] || [type, () => {}];
          for (const x of rows) found.push({ kind, title: titleOf(x) || "(senza titolo)", sub: subOf(x), run: () => open(x) });
        }
      } catch { /* ricerca non disponibile */ }
      if (found.length) found.push({ kind: "Cerca", title: `Tutti i risultati per «${q}»`, run: () => { location.hash = `#/cerca?q=${encodeURIComponent(q)}`; } });
    }
    draw([["Crea al volo", quick], ...filterGroups(groups, lq), ["Risultati", found]]);
  }, 160);

  input.addEventListener("input", update);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); select(sel + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); select(sel - 1); }
    else if (e.key === "Enter") { e.preventDefault(); run(sel); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  });
  update();
  void store;
}
