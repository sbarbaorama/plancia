// Calendario: mese o settimana con appuntamenti, scadenze dei task, consulenze, modifiche e scadenze.
import { get, qs } from "../api.js";
import { layoutDay } from "../calendar-layout.js";
import {
  openChangeEditor, openConsultationEditor, openDeadlineEditor, openEventEditor, openTaskEditor,
} from "../editors.js";
import {
  addDays, clear, customerFilter, h, icon, loadCustomers, monthName, mondayOf, pageHead, parseISO, segmented, todayISO, toISO,
} from "../ui.js";

const state = { mode: localStorage.getItem("plancia-cal-mode") || "mese", customer_id: "" };
const DOW = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

export async function render(root, ctx) {
  const anchor = ctx.query.d || todayISO();
  const customers = await loadCustomers();
  let from, to;
  if (state.mode === "mese") {
    const first = anchor.slice(0, 8) + "01";
    from = mondayOf(first);
    to = addDays(from, 41);
  } else {
    from = mondayOf(anchor);
    to = addDays(from, 6);
  }
  const f = { from, to, customer_id: state.customer_id };
  const [events, tasks, cons, changes, deadlines] = await Promise.all([
    get(`/api/events${qs(f)}`), get(`/api/tasks${qs({ customer_id: state.customer_id, open: "1", due_to: to })}`),
    get(`/api/consultations${qs(f)}`), get(`/api/changes${qs(f)}`), get(`/api/deadlines${qs({ ...f, status: "attiva" })}`),
  ]);
  if (!ctx.isCurrent()) return;
  const reload = () => render(root, ctx);
  const byDay = {};
  const put = (d, item) => { (byDay[d] = byDay[d] || []).push(item); };
  for (const e of events) {
    let d = e.start.slice(0, 10);
    const end = (e.end || e.start).slice(0, 10);
    for (let i = 0; d <= end && i < 60; i++, d = addDays(d, 1)) put(d, { kind: "ev", e, sort: e.all_day ? "00" : e.start.slice(11, 16) });
  }
  for (const t of tasks) if (t.due_date && t.due_date >= from) put(t.due_date, { kind: "task", t, sort: "99" });
  for (const c of cons) {
    let d = c.date_start;
    for (let i = 0; d <= (c.date_end || c.date_start) && i < 30; i++, d = addDays(d, 1)) put(d, { kind: "cons", c, sort: "01" });
  }
  for (const c of changes) { const w = (c.executed_at || c.planned_at); if (w) put(w.slice(0, 10), { kind: "change", c, sort: w.slice(11, 16) }); }
  for (const d of deadlines) put(d.due_date, { kind: "dl", d, sort: "02" });

  const chip = (it) => {
    if (it.kind === "ev") return h("div", { class: "cal-item", title: it.e.title, onclick: (x) => { x.stopPropagation(); openEventEditor(it.e, { onSave: reload }); } },
      it.e.all_day ? "" : `${it.e.start.slice(11, 16)} `, it.e.title);
    if (it.kind === "task") return h("div", { class: `cal-item task ${it.t.due_date < todayISO() ? "late" : ""}`, title: it.t.title, onclick: (x) => { x.stopPropagation(); openTaskEditor(it.t, { onSave: reload }); } }, "☐ ", it.t.title);
    if (it.kind === "cons") return h("div", { class: "cal-item cons", onclick: (x) => { x.stopPropagation(); openConsultationEditor(it.c, { onSave: reload }); } }, `Consulenza ${it.c.consultant_name || ""}`);
    if (it.kind === "change") return h("div", { class: "cal-item change", onclick: (x) => { x.stopPropagation(); openChangeEditor(it.c, { onSave: reload }); } }, `⇄ ${it.c.title}`);
    return h("div", { class: "cal-item dl", onclick: (x) => { x.stopPropagation(); openDeadlineEditor(it.d, { onSave: reload }); } }, `◷ ${it.d.title}`);
  };

  const nav = (delta) => {
    let d;
    if (state.mode === "mese") { const x = parseISO(anchor.slice(0, 8) + "01"); x.setMonth(x.getMonth() + delta); d = toISO(x); } else d = addDays(anchor, 7 * delta);
    location.hash = `#/calendario?d=${d}`;
  };
  const a = parseISO(anchor);
  const title = state.mode === "mese" ? `${monthName(a.getMonth())[0].toUpperCase()}${monthName(a.getMonth()).slice(1)} ${a.getFullYear()}`
    : `Settimana dal ${parseISO(from).getDate()} ${monthName(parseISO(from).getMonth())}`;

  let grid;
  if (state.mode === "mese") {
    grid = h("div", { class: "cal" }, DOW.map((d) => h("div", { class: "dow" }, d)));
    for (let i = 0; i < 42; i++) {
      const d = addDays(from, i);
      const items = (byDay[d] || []).sort((x, y) => x.sort.localeCompare(y.sort));
      grid.append(h("div", {
        class: `day${d.slice(0, 7) !== anchor.slice(0, 7) ? " other" : ""}${d === todayISO() ? " today" : ""}`,
        onclick: () => openEventEditor(null, { prefill: { start: `${d}T09:00`, end: `${d}T10:00` }, onSave: reload }),
        title: "Clic per un nuovo appuntamento",
      }, h("span", { class: "num" }, parseISO(d).getDate()), items.slice(0, 4).map(chip),
      items.length > 4 ? h("span", { class: "cal-more" }, `+${items.length - 4} altri`) : null));
    }
  } else {
    const H0 = 7, H1 = 20, PX = 46;
    grid = h("div", { class: "week" }, h("div", { class: "wh" }));
    const days = [...Array(7)].map((_, i) => addDays(from, i));
    days.forEach((d) => grid.append(h("div", { class: `wh${d === todayISO() ? " today" : ""}` }, `${DOW[(parseISO(d).getDay() + 6) % 7]} ${parseISO(d).getDate()}`)));
    grid.append(h("div", { class: "allday", style: { borderLeft: "0" } }, h("span", { class: "small muted" }, "giorno")));
    days.forEach((d) => grid.append(h("div", { class: "allday" }, (byDay[d] || []).filter((it) => it.kind !== "ev" || it.e.all_day || it.e.start.slice(0, 10) !== d).map(chip))));
    const hours = h("div", { class: "hours", style: { height: `${(H1 - H0) * PX}px` } });
    for (let hr = H0; hr <= H1; hr++) hours.append(h("div", { class: "hlab", style: { top: `${(hr - H0) * PX}px` } }, `${hr}:00`));
    grid.append(hours);
    for (const d of days) {
      const col = h("div", { class: "wcol", style: { height: `${(H1 - H0) * PX}px` }, onclick: (e) => {
        if (e.target !== col) return;
        const hr = Math.min(H1 - 1, Math.max(H0, Math.floor(H0 + e.offsetY / PX)));
        openEventEditor(null, { prefill: { start: `${d}T${String(hr).padStart(2, "0")}:00`, end: `${d}T${String(hr + 1).padStart(2, "0")}:00` }, onSave: reload });
      } });
      for (let hr = H0; hr <= H1; hr++) col.append(h("div", { class: "hline", style: { top: `${(hr - H0) * PX}px` } }));
      const timed = (byDay[d] || []).filter((it) => (it.kind === "ev" && !it.e.all_day && it.e.start.slice(0, 10) === d) || (it.kind === "change" && it.sort))
        .map((it) => {
          const start = it.kind === "ev" ? it.e.start : (it.c.executed_at || it.c.planned_at);
          const s = Number(start.slice(11, 13)) * 60 + Number(start.slice(14, 16));
          const endIso = it.kind === "ev" && it.e.end && it.e.end.slice(0, 10) === d ? it.e.end : null;
          const e = endIso ? Number(endIso.slice(11, 13)) * 60 + Number(endIso.slice(14, 16)) : s + 45;
          return { it, startMin: s, endMin: Math.max(e, s + 20) };
        });
      for (const p of layoutDay(timed)) {
        const { it, startMin, endMin } = p.item;
        const top = Math.max(0, (startMin - H0 * 60) / 60 * PX);
        col.append(h("div", {
          class: `wev ${it.kind === "change" ? "change" : ""}`,
          style: { top: `${top}px`, height: `${Math.max(18, (endMin - startMin) / 60 * PX - 2)}px`, left: `${(p.col / p.cols) * 100}%`, width: `${100 / p.cols}%` },
          onclick: () => it.kind === "ev" ? openEventEditor(it.e, { onSave: reload }) : openChangeEditor(it.c, { onSave: reload }),
        }, h("b", {}, it.kind === "ev" ? it.e.title : `⇄ ${it.c.title}`), h("div", {}, `${String(Math.floor(startMin / 60)).padStart(2, "0")}:${String(startMin % 60).padStart(2, "0")}`)));
      }
      grid.append(col);
    }
  }

  clear(root,
    pageHead(title, "",
      h("button", { class: "icon-btn", type: "button", "aria-label": "Precedente", onclick: () => nav(-1) }, icon("left")),
      h("button", { class: "btn btn-sm", type: "button", onclick: () => { location.hash = "#/calendario"; } }, "Oggi"),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Successivo", onclick: () => nav(1) }, icon("right")),
      segmented([["mese", "Mese"], ["settimana", "Settimana"]], state.mode, (v) => { state.mode = v; localStorage.setItem("plancia-cal-mode", v); render(root, ctx); }, "Vista"),
      customerFilter(customers, state.customer_id, (e) => { state.customer_id = e.target.value; render(root, ctx); }),
      h("button", { class: "btn btn-primary", type: "button", onclick: () => openEventEditor(null, { onSave: reload }) }, icon("plus"), "Appuntamento")),
    h("div", { class: "legend", style: { marginBottom: "10px" } },
      h("span", { style: { "--c": "var(--info)" } }, "Appuntamenti"), h("span", { style: { "--c": "var(--line-strong)" } }, "Task in scadenza"),
      h("span", { style: { "--c": "var(--accent)" } }, "Consulenze"), h("span", { style: { "--c": "var(--warn-solid)" } }, "Modifiche"),
      h("span", { style: { "--c": "var(--violet)" } }, "Scadenze")),
    grid);
}
