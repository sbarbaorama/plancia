// Oggi: il quadro della giornata, fatto di pannelli che ognuno sceglie, sposta e ridimensiona.
import { get } from "../api.js";
import { openEventEditor, openNoteEditor, openTaskEditor } from "../editors.js";
import { newsCard, weatherCard, weatherChip } from "../esterni.js";
import { HEIGHTS, PANELS, ZONES, loadLayout, panelTitle, resetLayout, saveLayout } from "../home.js";
import { changeRow, consultationRow, deadlineRow, eventRow, list, taskRow, waitRow } from "../rows.js";
import {
  addDays, card, clear, fmtDate, fmtLongDate, fmtMin, h, icon, kpi, me, mondayOf, plural, popMenu, store, toast,
} from "../ui.js";

let editing = false;

function greeting() {
  const hr = new Date().getHours();
  const name = store.session?.mode === "team" ? `, ${me().name.split(" ")[0]}` : "";
  return `${hr < 13 ? "Buongiorno" : hr < 18 ? "Buon pomeriggio" : "Buonasera"}${name}`;
}

/** Un pannello che si riempie dopo (dati presi a parte). */
function lazyCard(title, loadBody, opts = {}) {
  const body = h("div", { class: "card-body" }, h("div", { class: "muted small" }, "Carico…"));
  loadBody().then((nodes) => clear(body, nodes)).catch(() => clear(body, h("div", { class: "muted small" }, "Non disponibile.")));
  return card(title, body, opts);
}

/** I pannelli: ognuno restituisce il suo riquadro, o null se non c'è niente da mostrare. */
function builders(d) {
  const open = d.plan.filter((t) => t.status !== "chiuso");
  const doneN = d.plan.length - open.length;
  const late = [...d.overdue, ...d.due_today.filter((t) => t.planned_for !== d.today)];
  const progress = d.in_progress.filter((t) => t.planned_for !== d.today);
  const agenda = [...d.consultations_today.map((c) => ({ t: "00:00", node: consultationRow(c) })),
    ...d.events_today.map((e) => ({ t: e.all_day ? "00:00" : e.start.slice(11, 16), node: eventRow(e) }))].sort((a, b) => a.t.localeCompare(b.t));
  return {
    kpis: () => h("div", { class: "kpis", style: { marginBottom: 0 } },
      kpi("In ritardo", d.overdue.length, d.overdue.length ? `il più vecchio: ${fmtDate(d.overdue[0].due_date)}` : "tutto in pari", d.overdue.length ? "danger" : "", "#/task"),
      kpi("Piano di oggi", `${doneN}/${d.plan.length}`, open.length ? `${fmtMin(open.reduce((s, t) => s + (t.estimate_min || 0), 0))} stimati` : "", "", "#/pianifica"),
      kpi("Da sollecitare", d.waiting_followup.length, plural(d.waiting_followup.length, "attesa", "attese"), d.waiting_followup.length ? "warn" : "", "#/attese"),
      kpi("Scadenze in preavviso", d.deadlines_due.length, d.deadlines_due[0] ? `${d.deadlines_due[0].title} · ${fmtDate(d.deadlines_due[0].due_date)}` : "nessuna", d.deadlines_due.length ? "warn" : "", "#/scadenze"),
      kpi("Ore registrate", fmtMin(d.minutes_today), `settimana: ${fmtMin(d.minutes_week)}`, "", "#/ore")),
    plan: () => card("Il piano di oggi", d.plan.length
      ? h("div", {}, h("div", { style: { padding: "0 18px 8px" } }, h("div", { class: "bar" }, h("span", { style: { width: `${Math.round((doneN / d.plan.length) * 100)}%` } }))), list(d.plan, taskRow, ""))
      : h("div", { class: "empty" }, "Nessun task nel piano di oggi. ", h("a", { href: "#/pianifica" }, "Pianifica la giornata →")),
    { meta: d.plan.length ? `${doneN} fatti su ${d.plan.length}` : "", actions: h("a", { class: "btn btn-sm", href: "#/pianifica" }, "Pianifica") }),
    late: () => late.length ? card("In ritardo e in scadenza oggi", list(late, taskRow, ""), { meta: plural(late.length, "task", "task") }) : null,
    week: () => d.due_week.length ? card("Scadono nei prossimi 7 giorni", list(d.due_week, taskRow, "")) : null,
    progress: () => progress.length ? card("In corso", list(progress, taskRow, "")) : null,
    agenda: () => card("Agenda", agenda.length ? h("ul", { class: "list" }, agenda.map((a) => a.node)) : h("div", { class: "empty" }, "Nessun appuntamento oggi"),
      { actions: h("button", { class: "btn btn-sm", type: "button", onclick: () => openEventEditor(null) }, "+") }),
    followup: () => d.waiting_followup.length ? card("Da sollecitare", list(d.waiting_followup, waitRow, "")) : null,
    deadlines: () => d.deadlines_due.length ? card("Scadenze in arrivo", list(d.deadlines_due, deadlineRow, "")) : null,
    changes: () => d.changes_upcoming.length ? card("Modifiche in programma", list(d.changes_upcoming, changeRow, ""), { meta: "7 giorni" }) : null,
    inbox: () => d.inbox_count ? h("a", { class: "banner", href: "#/inbox", style: { marginBottom: 0 } }, icon("inbox"), `${plural(d.inbox_count, "nota", "note")} da smistare nell'Inbox`) : null,
    meetings: () => d.recent_meetings.length ? card("Ultimi verbali", h("ul", { class: "list" }, d.recent_meetings.map((m) =>
      h("li", { class: "item", onclick: () => { location.hash = `#/riunioni/${m.id}`; } }, h("div", { class: "main-col" }, h("div", { class: "t-title" }, m.title),
        h("div", { class: "meta" }, m.customer_code ? h("span", { class: "chip" }, m.customer_code) : null, m.actions_open ? h("span", { class: "soon" }, `${m.actions_open} azioni aperte`) : null)),
      h("div", { class: "side-col" }, m.date ? fmtDate(m.date) : ""))))) : null,
    notes: () => lazyCard("Post-it fissati", async () => {
      const notes = (await get("/api/sticky_notes")).filter((n) => n.pinned);
      return notes.length ? h("div", { class: "mini-notes" }, notes.slice(0, 8).map((n) => h("article", { class: `postit mini ${n.color}`, onclick: () => openNoteEditor(n) },
        n.title ? h("b", {}, n.title) : null, h("div", { class: "body" }, (n.body || n.command || "").slice(0, 220)))))
        : h("div", { class: "empty" }, "Nessun post-it fissato. In Note usa la puntina per fissarne uno.");
    }, { actions: h("a", { class: "btn btn-sm", href: "#/note" }, "Note") }),
    procedures: () => lazyCard("Procedure in evidenza", async () => {
      const all = await get("/api/procedures");
      const pinned = all.filter((p) => p.pinned);
      const shown = (pinned.length ? pinned : [...all].sort((a, b) => b.updated_at.localeCompare(a.updated_at))).slice(0, 8);
      return shown.length ? h("ul", { class: "list" }, shown.map((p) => h("li", { class: "item", onclick: () => { location.hash = `#/procedure/${p.id}`; } },
        h("div", { class: "main-col" }, h("div", { class: "t-title" }, p.title), h("div", { class: "meta" }, p.category ? h("span", {}, p.category) : null)))))
        : h("div", { class: "empty" }, "Nessuna procedura. ", h("a", { href: "#/procedure" }, "Scrivine una →"));
    }, { actions: h("a", { class: "btn btn-sm", href: "#/procedure" }, "Procedure") }),
    consultations: () => lazyCard("Consulenze della settimana", async () => {
      const mon = mondayOf(d.today);
      const items = (await get(`/api/consultations?from=${mon}&to=${addDays(mon, 6)}`)).sort((a, b) => a.date_start.localeCompare(b.date_start));
      return items.length ? h("ul", { class: "list" }, items.map((c) => consultationRow(c))) : h("div", { class: "empty" }, "Nessuna consulenza questa settimana.");
    }, { actions: h("a", { class: "btn btn-sm", href: "#/consulenze" }, "Consulenze") }),
    news: () => newsCard(),
    weather: () => weatherCard(),
  };
}

export async function render(root, ctx) {
  if (ctx.query.personalizza && !ctx.refresh) editing = true;
  const [d, layout] = await Promise.all([get("/api/dashboard"), loadLayout()]);
  if (!ctx.isCurrent()) return;
  const build = builders(d);
  const rerender = () => render(root, { ...ctx, query: {}, refresh: true });

  // un pannello nella pagina (in «Personalizza» con maniglia e comandi)
  const panelNode = (p) => {
    let node = build[p.id]?.();
    if (!node && !editing) return null;
    if (!node) node = card(panelTitle(p.id), h("div", { class: "empty" }, "Ora non c'è niente da mostrare: comparirà quando servirà."));
    const wrap = h("div", { class: `home-panel h-${p.height}`, dataset: { id: p.id } }, node);
    if (editing) {
      const cycle = (arr, v) => arr[(arr.findIndex(([k]) => k === v) + 1) % arr.length][0];
      wrap.prepend(h("div", { class: "home-tools" },
        h("span", { class: "home-grip", title: "Trascina per spostare", "aria-hidden": "true" }, icon("grip")),
        h("b", { class: "small", style: { flex: 1 } }, panelTitle(p.id)),
        h("button", { class: "btn btn-sm", type: "button", title: "Larghezza: intera, larga o stretta", onclick: () => { p.zone = { side: "main", main: "top", top: "side" }[p.zone]; persist(); } },
          `↔ ${ZONES.find(([k]) => k === p.zone)[1]}`),
        h("button", { class: "btn btn-sm", type: "button", title: "Altezza: automatica, compatta o alta", onclick: () => { p.height = cycle(HEIGHTS, p.height); persist(); } },
          `↕ ${HEIGHTS.find(([k]) => k === p.height)[1]}`),
        h("button", { class: "icon-btn", type: "button", title: "Togli dalla pagina", "aria-label": `Togli ${panelTitle(p.id)}`,
          onclick: () => { layout.panels = layout.panels.filter((x) => x !== p); persist(); } }, icon("x"))));
      // in «Personalizza» si trascina tutto il pannello (i suoi contenuti sono fermi)
      wrap.draggable = true;
      wrap.addEventListener("dragstart", (e) => { dragId = p.id; wrap.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", p.id); });
      wrap.addEventListener("dragend", () => { wrap.classList.remove("dragging"); dragId = null; });
    }
    return wrap;
  };
  let dragId = null;
  const persist = async (msg) => {
    const saved = await saveLayout(layout);
    if (saved) { if (msg) toast(msg, "ok"); rerender(); }
  };
  const zoneNode = (zone, cls) => {
    const z = h("div", { class: `home-zone ${cls}`, dataset: { zone } }, layout.panels.filter((p) => p.zone === zone).map(panelNode));
    if (editing) {
      z.addEventListener("dragover", (e) => {
        if (!dragId) return;
        e.preventDefault();
        const moving = root.querySelector(`.home-panel[data-id="${dragId}"]`);
        const after = [...z.querySelectorAll(".home-panel:not(.dragging)")].find((el) => e.clientY < el.getBoundingClientRect().top + el.offsetHeight / 2);
        if (moving) z.insertBefore(moving, after || null);
      });
      z.addEventListener("drop", (e) => {
        e.preventDefault();
        // il nuovo ordine si legge dalla pagina
        const order = [...root.querySelectorAll(".home-zone")].flatMap((el) => [...el.querySelectorAll(".home-panel")].map((p) => [p.dataset.id, el.dataset.zone]));
        const byId = Object.fromEntries(layout.panels.map((p) => [p.id, p]));
        layout.panels = order.map(([id, zn]) => ({ ...byId[id], zone: zn }));
        persist();
      });
      if (!z.children.length) z.append(h("div", { class: "home-drop" }, "Trascina qui un pannello"));
    }
    return z;
  };
  const hidden = PANELS.filter(([id]) => !layout.panels.some((p) => p.id === id));

  clear(root,
    h("div", { class: "page-head" },
      h("div", { class: "titles" }, h("div", { class: "eyebrow" }, fmtLongDate(d.today)), h("h1", {}, greeting())),
      h("div", { class: "toolbar" },
        layout.weatherChip ? weatherChip() : null,
        h("a", { class: "btn", href: "#/pianifica" }, icon("pianifica"), "Pianifica la giornata"),
        h("button", { class: `btn${editing ? " btn-primary" : ""}`, type: "button", title: "Scegli, sposta e ridimensiona i pannelli",
          onclick: () => { editing = !editing; rerender(); } }, icon(editing ? "check" : "edit"), editing ? "Fine" : "Personalizza"),
        !editing ? h("button", { class: "btn btn-primary", type: "button", onclick: () => openTaskEditor(null) }, icon("plus"), "Task") : null)),
    editing ? h("div", { class: "banner home-edit-bar" },
      h("span", { style: { flex: 1 } }, "Trascina i pannelli dove vuoi. «↔» cambia la larghezza (stretta, larga, intera), «↕» l'altezza (automatica, compatta, alta), «×» toglie il pannello. I pannelli vuoti qui («Ora non c'è niente da mostrare») nella pagina compaiono solo quando servono."),
      hidden.length ? h("button", { class: "btn btn-sm", type: "button", onclick: (e) => popMenu(e.currentTarget, hidden.map(([id, title]) => [title, "plus", () => {
        layout.panels.push({ id, zone: ["kpis"].includes(id) ? "top" : ["plan", "late", "week", "progress", "news"].includes(id) ? "main" : "side", height: "auto" });
        persist(`Aggiunto: ${title}`);
      }])) }, icon("plus"), "Aggiungi pannello") : null,
      h("label", { class: "check small" }, h("input", { type: "checkbox", checked: layout.weatherChip, onchange: (e) => { layout.weatherChip = e.target.checked; persist(); } }), "Meteo compatto"),
      h("button", { class: "btn btn-sm btn-ghost", type: "button", onclick: async () => { if (await resetLayout()) rerender(); } }, "Ripristina")) : null,
    d.last_backup_error ? h("div", { class: "banner danger" }, `Backup non riuscito: ${d.last_backup_error}. `, h("a", { href: "#/impostazioni" }, "Controlla le impostazioni"))
      : d.backup_stale ? h("div", { class: "banner warn" }, `Ultimo backup: ${d.last_backup ? fmtDate(d.last_backup) : "mai"}. `, h("a", { href: "#/impostazioni" }, "Fai un backup ora")) : null,
    h("div", { class: `home${editing ? " editing" : ""}` },
      zoneNode("top", "home-top"),
      h("div", { class: "cols" }, zoneNode("main", "col-main"), zoneNode("side", "col-side"))));
}
