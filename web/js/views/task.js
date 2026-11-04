// Task: elenco raggruppato per scadenza oppure Kanban per stato, con filtri.
import { get, put, qs } from "../api.js";
import { openTaskEditor } from "../editors.js";
import { taskRow } from "../rows.js";
import {
  addDays, avatar, clear, customerChip, customerFilter, dueClass, fmtDue, h, icon, isTeam, label, loadCustomers, loadProjects,
  loadUsers, pageHead, segmented, select, showError, todayISO,
} from "../ui.js";

const state = { customer_id: "", project_id: "", priority: "", assignee: "", q: "", mode: localStorage.getItem("plancia-task-mode") || "lista" };

export async function render(root, ctx) {
  Object.assign(state, Object.fromEntries(Object.entries(ctx.query).filter(([k]) => k in state)));
  const [customers, projects, users] = await Promise.all([loadCustomers(), loadProjects(), isTeam() ? loadUsers() : []]);
  const body = h("div");
  const reload = () => load().catch(showError);

  async function load() {
    const f = { customer_id: state.customer_id, project_id: state.project_id, priority: state.priority, q: state.q };
    if (state.assignee === "me") f.mine = "1"; else if (state.assignee) f.assignee_id = state.assignee;
    const [open, closed] = await Promise.all([
      get(`/api/tasks${qs({ ...f, open: "1" })}`),
      state.mode === "kanban" ? get(`/api/tasks${qs({ ...f, status: "chiuso", limit: 20 })}`) : Promise.resolve([]),
    ]);
    if (!ctx.isCurrent()) return;
    if (state.mode === "kanban") return drawKanban([...open, ...closed]);
    const t = todayISO(), week = addDays(t, 7);
    const groups = [
      ["In ritardo", open.filter((x) => x.due_date && x.due_date < t), "danger"],
      ["Oggi", open.filter((x) => x.due_date === t), "warn"],
      ["Prossimi 7 giorni", open.filter((x) => x.due_date > t && x.due_date <= week)],
      ["Più avanti", open.filter((x) => x.due_date > week)],
      ["Senza scadenza", open.filter((x) => !x.due_date)],
    ].filter(([, items]) => items.length);
    clear(body, groups.length ? groups.map(([title, items, cls]) => [
      h("div", { class: `group-title ${cls || ""}` }, `${title} · ${items.length}`),
      h("ul", { class: "list card" }, items.map((x) => taskRow(x, { onChange: reload }))),
    ]) : h("div", { class: "card" }, h("div", { class: "empty" }, "Nessun task aperto con questi filtri.")));
  }

  function drawKanban(items) {
    const cols = [["da_fare", "Da fare"], ["in_corso", "In corso"], ["in_attesa", "In attesa"], ["chiuso", "Chiusi di recente"]];
    clear(body, h("div", { class: "kanban" }, cols.map(([status, title]) => {
      const list = items.filter((x) => x.status === status);
      const col = h("div", { class: "kcol", dataset: { status } }, h("h3", {}, title, h("span", { class: "progress-txt" }, list.length)),
        list.map((t) => h("div", { class: "tcard", draggable: "true", dataset: { id: t.id },
          ondragstart: (e) => e.dataTransfer.setData("text/plain", String(t.id)), onclick: () => openTaskEditor(t, { onSave: reload }) },
        h("span", { class: `prio ${t.priority}`, style: { marginTop: "6px" } }),
        h("div", { class: "body" }, h("div", { class: "ttl", style: status === "chiuso" ? { textDecoration: "line-through", color: "var(--muted)" } : null }, t.title),
          h("div", { class: "sub" }, customerChip(t), t.subtasks_total ? h("span", { class: "progress-txt" }, `${t.subtasks_done}/${t.subtasks_total}`) : null,
            t.due_date && status !== "chiuso" ? h("span", { class: dueClass(t.due_date) }, fmtDue(t.due_date)) : null)),
        isTeam() && t.assignee_name ? avatar(t.assignee_name) : null)));
      col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("drop-over"); });
      col.addEventListener("dragleave", (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove("drop-over"); });
      col.addEventListener("drop", async (e) => {
        e.preventDefault();
        col.classList.remove("drop-over");
        const id = Number(e.dataTransfer.getData("text/plain"));
        if (!id) return;
        try { await put(`/api/tasks/${id}`, { status }); reload(); } catch (err) { showError(err); }
      });
      return col;
    })));
  }

  const setF = (k) => (e) => { state[k] = e.target.value; reload(); };
  let searchTimer;
  clear(root,
    pageHead("Task", "Tutto quello che c'è da fare, per scadenza o per stato",
      segmented([["lista", "Lista"], ["kanban", "Kanban"]], state.mode, (v) => { state.mode = v; localStorage.setItem("plancia-task-mode", v); render(root, ctx); }, "Vista"),
      h("button", { class: "btn btn-primary", type: "button", onclick: () => openTaskEditor(null, { prefill: { customer_id: state.customer_id || null, project_id: state.project_id || null }, onSave: reload }) }, icon("plus"), "Nuovo task")),
    h("div", { class: "filters" },
      h("input", { type: "search", placeholder: "Filtra per testo…", value: state.q, "aria-label": "Filtra",
        oninput: (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.q = e.target.value; reload(); }, 250); } }),
      customerFilter(customers, state.customer_id, setF("customer_id")),
      select("project_id", [["", "Tutti i progetti"], ...projects.filter((p) => p.status !== "chiuso").map((p) => [p.id, p.name])], state.project_id, { "aria-label": "Progetto", onchange: setF("project_id") }),
      select("priority", [["", "Ogni priorità"], ...["alta", "media", "bassa"].map((p) => [p, label(p)])], state.priority, { "aria-label": "Priorità", onchange: setF("priority") }),
      isTeam() ? select("assignee", [["", "Tutto il team"], ["me", "Assegnati a me"], ...users.filter((u) => u.active).map((u) => [u.id, u.name])], state.assignee, { "aria-label": "Assegnatario", onchange: setF("assignee") }) : null,
      h("a", { class: "btn btn-ghost", href: "#/archivio" }, "Archivio dei chiusi")),
    body);
  await load();
}
