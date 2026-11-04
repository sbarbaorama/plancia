// Pianifica la giornata: da pianificare → piano di oggi (con stime e capacità) → giornata a blocchi orari.
import { get, post, put } from "../api.js";
import { openChangeEditor, openConsultationEditor, openEventEditor, openTaskEditor, startTimer } from "../editors.js";
import { layoutDay } from "../calendar-layout.js";
import { toggleTask } from "../rows.js";
import {
  addDays, checkButton, clear, customerChip, dueClass, fmtDue, fmtLongDate, fmtMin, h, icon, popMenu, showError, textDialog,
  toast, todayISO,
} from "../ui.js";

const PX = 1; // pixel per minuto nella colonna "Giornata"
const toMin = (hm) => { const [a, b] = (hm || "0:0").split(":").map(Number); return a * 60 + b; };
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export async function render(root, ctx) {
  const day = ctx.query.date || todayISO();
  const p = await get(`/api/plan?date=${day}`);
  if (!ctx.isCurrent()) return;
  const reload = () => render(root, { ...ctx, query: { date: day } });
  const go = (d) => { location.hash = `#/pianifica?date=${d}`; };
  const planIds = () => p.plan.map((t) => t.id);
  const savePlan = async (ids) => {
    try { await put("/api/plan", { date: day, ids }); reload(); } catch (err) { showError(err); }
  };
  const addToPlan = (id, at = null) => {
    const ids = planIds().filter((x) => x !== id);
    ids.splice(at ?? ids.length, 0, id);
    savePlan(ids);
  };

  // ---------------------------------------------------------------- capacità
  const c = p.capacity;
  const pct = c.available_min ? Math.min(100, Math.round((c.planned_min / c.available_min) * 100)) : 100;
  const over = c.planned_min > c.available_min;
  const capacity = h("div", { class: "capacity" },
    h("div", { class: "nums" }, h("span", {}, h("b", {}, fmtMin(c.planned_min)), " pianificate"),
      h("span", { class: over ? "soon" : "muted" }, `disponibili ${fmtMin(c.available_min)}${c.meetings_min ? ` (riunioni ${fmtMin(c.meetings_min)})` : ""}`)),
    h("div", { class: "bar", role: "img", "aria-label": `Carico ${pct}%` }, h("span", { class: over ? "over" : "", style: { width: `${pct}%` } })));

  // ---------------------------------------------------------------- schede trascinabili
  function card(t, where, index) {
    const inPlan = where === "plan";
    const done = t.status === "chiuso";
    const el = h("div", {
      class: `tcard${inPlan && t.status === "in_corso" ? " current" : ""}`, draggable: "true", dataset: { id: t.id },
      ondragstart: (e) => { e.dataTransfer.setData("text/plain", String(t.id)); e.dataTransfer.effectAllowed = "move"; el.classList.add("dragging"); },
      ondragend: () => el.classList.remove("dragging"),
    },
      inPlan ? checkButton(done, () => toggleTask(t, reload)) : h("span", { class: "grip" }, icon("grip")),
      h("div", { class: "body", onclick: () => openTaskEditor(t, { onSave: reload }), style: { cursor: "pointer" } },
        h("div", { class: "ttl", style: done ? { textDecoration: "line-through", color: "var(--muted)" } : null }, t.title),
        h("div", { class: "sub" }, customerChip(t), t.project_name ? h("span", {}, t.project_name) : null,
          t.due_date ? h("span", { class: dueClass(t.due_date, done) }, `scad. ${fmtDue(t.due_date)}`) : null,
          t.subtasks_total ? h("span", { class: "progress-txt" }, `${t.subtasks_done}/${t.subtasks_total}`) : null,
          inPlan && t.plan_time ? h("span", { class: "mono" }, t.plan_time) : null)),
      h("button", { class: "est", type: "button", title: "Stima", onclick: (e) => estimateMenu(e.currentTarget, t) }, t.estimate_min ? fmtMin(t.estimate_min) : "stima"),
      inPlan
        ? h("div", { class: "row", style: { gap: "0", flexWrap: "nowrap" } },
          !done ? h("button", { class: "icon-btn", type: "button", "aria-label": "Avvia timer", title: "Avvia timer", onclick: () => startTimer(t) }, icon("play")) : null,
          h("button", { class: "icon-btn", type: "button", "aria-label": "Sposta su", title: "Su", onclick: () => move(index, -1) }, "↑"),
          h("button", { class: "icon-btn", type: "button", "aria-label": "Togli dal piano", title: "Togli dal piano", onclick: async () => {
            await post(`/api/tasks/${t.id}/unplan`).catch(showError); reload();
          } }, icon("x")))
        : h("button", { class: "icon-btn", type: "button", "aria-label": `Aggiungi «${t.title}» al piano`, title: "Aggiungi al piano", onclick: () => addToPlan(t.id) }, icon("plus")));
    return el;
  }
  function move(i, delta) {
    const ids = planIds();
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    savePlan(ids);
  }
  function estimateMenu(anchor, t) {
    popMenu(anchor, [15, 30, 45, 60, 90, 120, 180, 240].map((m) => [fmtMin(m), null, async () => {
      try { await put(`/api/tasks/${t.id}`, { estimate_min: m }); reload(); } catch (err) { showError(err); }
    }]).concat([["Nessuna stima", null, async () => { await put(`/api/tasks/${t.id}`, { estimate_min: null }).catch(showError); reload(); }]]));
  }

  // ---------------------------------------------------------------- colonna 1: da pianificare
  const backlog = h("section", { class: "plan-col", "aria-label": "Da pianificare" },
    h("h2", {}, "Da pianificare", h("span", { class: "hint" }, "trascina nel piano")));
  let anything = false;
  for (const g of p.backlog) {
    if (!g.items.length) continue;
    anything = true;
    backlog.append(h("div", { class: `group-title ${g.key === "overdue" ? "danger" : ""}` }, `${g.title} · ${g.items.length}`), ...g.items.map((t) => card(t, "backlog")));
  }
  if (p.inbox.length) {
    anything = true;
    backlog.append(h("div", { class: "group-title" }, `Inbox · ${p.inbox.length}`), ...p.inbox.map((n) => h("div", { class: "tcard", style: { cursor: "default" } },
      h("span", { class: "grip" }, icon("inbox")), h("div", { class: "body" }, h("div", { class: "ttl" }, n.text.split("\n")[0])),
      h("button", { class: "btn btn-sm", type: "button", title: "Trasforma in task e mettilo nel piano", onclick: async () => {
        try { const r = await post(`/api/inbox_items/${n.id}/convert`, { type: "tasks" }); addToPlan(r.item.id); } catch (err) { showError(err); }
      } }, "→ piano"))));
  }
  if (!anything) backlog.append(h("div", { class: "drop-hint" }, "Niente in arretrato. ", h("button", { class: "btn btn-sm", type: "button", onclick: () => openTaskEditor(null, { prefill: { planned_for: day }, onSave: reload }) }, "+ Task")));

  // ---------------------------------------------------------------- colonna 2: piano
  const planList = h("div", { class: "plan-list", "aria-label": "Il piano del giorno" },
    p.plan.map((t, i) => card(t, "plan", i)),
    h("button", { class: "drop-hint", type: "button", style: { width: "100%", background: "transparent", cursor: "pointer" },
      onclick: () => openTaskEditor(null, { prefill: { planned_for: day }, onSave: reload }) }, p.plan.length ? "+ Aggiungi un task al piano" : "Trascina qui i task della giornata, oppure aggiungine uno"));
  planList.addEventListener("dragover", (e) => { e.preventDefault(); planList.classList.add("drop-over"); });
  planList.addEventListener("dragleave", (e) => { if (!planList.contains(e.relatedTarget)) planList.classList.remove("drop-over"); });
  planList.addEventListener("drop", (e) => {
    e.preventDefault();
    planList.classList.remove("drop-over");
    const id = Number(e.dataTransfer.getData("text/plain"));
    if (!id) return;
    const cards = [...planList.querySelectorAll(".tcard")].filter((c2) => Number(c2.dataset.id) !== id);
    let at = cards.findIndex((c2) => e.clientY < c2.getBoundingClientRect().top + c2.offsetHeight / 2);
    if (at < 0) at = cards.length;
    addToPlan(id, at);
  });
  const doneCount = p.plan.filter((t) => t.status === "chiuso").length;
  const planCol = h("section", { class: "plan-col" },
    h("h2", {}, "Il piano", h("span", { class: "hint" }, `${p.plan.length} attività · ${doneCount} fatte`)), planList);

  // ---------------------------------------------------------------- colonna 3: giornata
  const startM = Math.floor(toMin(p.day_start) / 60) * 60;
  const endM = Math.ceil(toMin(p.day_end) / 60) * 60;
  const height = (endM - startM) * PX;
  const line = h("div", { class: "dayline", style: { height: `${height}px` } });
  for (let m = startM; m <= endM; m += 60) {
    line.append(h("div", { class: "hr", style: { top: `${(m - startM) * PX - 7}px` } }, h("span", {}, hm(m)), h("i")));
  }
  const now = new Date();
  if (day === todayISO()) {
    const nm = now.getHours() * 60 + now.getMinutes();
    if (nm >= startM && nm <= endM) line.append(h("div", { class: "now", style: { top: `${(nm - startM) * PX}px` } }));
  }
  const blocks = [];
  const block = (top, mins, cls, title, sub, onclick) => {
    if (top > endM) return;
    blocks.push({ startMin: Math.max(startM, top), endMin: Math.max(Math.max(startM, top) + 20, Math.min(top + mins, endM)), cls, title, sub, onclick });
  };
  const allDay = [];
  for (const e of p.events) {
    if (e.all_day) { allDay.push(h("div", { class: "cal-item", onclick: () => openEventEditor(e, { onSave: reload }) }, e.title)); continue; }
    const s = toMin(e.start.slice(11, 16));
    const en = e.end && e.end.slice(0, 10) === day ? toMin(e.end.slice(11, 16)) : s + 60;
    block(s, Math.max(15, en - s), "meet", e.title, `${e.start.slice(11, 16)} · ${e.location || ""}`, () => openEventEditor(e, { onSave: reload }));
  }
  for (const cn of p.consultations) allDay.push(h("div", { class: "cal-item cons", onclick: () => openConsultationEditor(cn, { onSave: reload }) }, `Consulenza: ${cn.consultant_name || ""} ${cn.customer_code ? `· ${cn.customer_code}` : ""}`));
  for (const ch of p.changes) {
    const s = toMin((ch.planned_at || "").slice(11, 16) || "09:00");
    block(s, 45, "change", `Modifica: ${ch.title}`, ch.customer_code || "", () => openChangeEditor(ch, { onSave: reload }));
  }
  for (const t of p.plan.filter((x) => x.plan_time)) {
    block(toMin(t.plan_time), t.estimate_min || 30, "task", t.title, `${t.plan_time} · ${fmtMin(t.estimate_min || 30)}`, () => openTaskEditor(t, { onSave: reload }));
  }
  for (const pl of layoutDay(blocks)) {
    const b = pl.item;
    const mins = b.endMin - b.startMin;
    line.append(h("div", {
      class: `blk ${b.cls}`, title: `${b.title} ${b.sub}`, onclick: b.onclick,
      style: { top: `${(b.startMin - startM) * PX}px`, height: `${Math.max(22, mins * PX - 2)}px`,
        left: `calc(8px + (100% - 14px) * ${pl.col / pl.cols})`, right: "auto", width: `calc((100% - 14px) / ${pl.cols} - 3px)` },
    }, h("b", {}, b.title), mins >= 40 ? h("span", {}, b.sub) : null));
  }
  line.addEventListener("dragover", (e) => { e.preventDefault(); line.classList.add("drop-over"); });
  line.addEventListener("dragleave", () => line.classList.remove("drop-over"));
  line.addEventListener("drop", async (e) => {
    e.preventDefault();
    line.classList.remove("drop-over");
    const id = Number(e.dataTransfer.getData("text/plain"));
    if (!id) return;
    const y = e.clientY - line.getBoundingClientRect().top;
    const minute = Math.round((startM + y / PX) / 15) * 15;
    try {
      await put(`/api/tasks/${id}`, { plan_time: hm(Math.max(startM, Math.min(endM - 15, minute))), planned_for: day });
      if (!planIds().includes(id)) addToPlan(id); else reload();
    } catch (err) { showError(err); }
  });
  const dayCol = h("section", { class: "plan-col card card-pad" },
    h("h2", {}, "Giornata", h("span", { class: "hint" }, "trascina un task su un orario")),
    allDay.length ? h("div", { class: "stack", style: { gap: "4px", marginBottom: "10px" } }, allDay) : null,
    line);

  // ---------------------------------------------------------------- chiusura
  async function closeDay() {
    try {
      const r = await post("/api/plan/close", { date: day });
      textDialog("Fine giornata", r.text, h("p", { class: "muted" }, `${r.done} fatte · ${r.moved} spostate al ${fmtLongDate(r.next_day)}`));
      reload();
    } catch (err) { showError(err); }
  }
  const foot = h("div", { class: "dayfoot" },
    h("b", {}, "Fine giornata"),
    h("span", {}, `${doneCount} completate · ${p.plan.length - doneCount} da spostare · ${fmtMin(c.logged_min)} registrate`),
    h("span", { class: "spacer" }),
    h("button", { class: "btn", type: "button", onclick: closeDay }, "Chiudi la giornata e copia il riepilogo"));

  clear(root,
    h("div", { class: "page-head" },
      h("div", { class: "titles" }, h("div", { class: "eyebrow" }, fmtLongDate(day)), h("h1", {}, day === todayISO() ? "Pianifica la giornata" : "Piano del giorno")),
      capacity,
      h("div", { class: "toolbar" },
        h("button", { class: "icon-btn", type: "button", "aria-label": "Giorno precedente", onclick: () => go(addDays(day, -1)) }, icon("left")),
        h("button", { class: "btn btn-sm", type: "button", onclick: () => go(todayISO()) }, "Oggi"),
        h("button", { class: "icon-btn", type: "button", "aria-label": "Giorno successivo", onclick: () => go(addDays(day, 1)) }, icon("right")),
        h("input", { type: "date", value: day, "aria-label": "Vai al giorno", style: { width: "auto" }, onchange: (e) => e.target.value && go(e.target.value) }))),
    h("div", { class: "plan-cols" }, backlog, planCol, dayCol),
    foot);
  if (ctx.query.close === "1" && !ctx.refresh) { history.replaceState(null, "", "#/pianifica"); closeDay(); }
  void toast;
}
