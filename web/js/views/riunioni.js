// Riunioni: verbali con azioni (diventano task), serie ricorrenti con le azioni aperte che passano alla successiva.
import { del, get, post, put, qs } from "../api.js";
import { setLeaveGuard } from "../app.js";
import { attachmentsBox } from "../attachments.js";
import { field, readForm } from "../form.js";
import { pasteImages } from "../paste.js";
import { meetingRow, taskRow } from "../rows.js";
import {
  badge, clear, confirmDialog, customerFilter, fmtDate, fmtDateTime, h, icon, isTeam, label, loadCustomers, loadProjects, loadUsers,
  listOrCards, nowLocal, pageHead, printDoc, resolveCombos, select, showError, store, toast, viewMode, viewToggle,
} from "../ui.js";

const state = { customer_id: "", series: "", q: "" };
let view = viewMode("riunioni");

export async function render(root, ctx) {
  if (ctx.id) return renderDoc(root, ctx);
  const customers = await loadCustomers();
  const series = await get("/api/meetings/series");
  const items = await get(`/api/meetings${qs(state)}`);
  if (!ctx.isCurrent()) return;
  const bySeries = state.series ? null : items.reduce((acc, m) => ((acc[m.series || ""] = acc[m.series || ""] || []).push(m), acc), {});
  clear(root,
    pageHead("Riunioni", "Verbali da modello: le azioni diventano task, quelle aperte passano alla riunione successiva della serie",
      h("a", { class: "btn btn-primary", href: "#/riunioni/new" }, icon("plus"), "Nuovo verbale")),
    h("div", { class: "filters" },
      h("input", { type: "search", placeholder: "Cerca nei verbali…", value: state.q, onchange: (e) => { state.q = e.target.value; render(root, ctx); } }),
      customerFilter(customers, state.customer_id, (e) => { state.customer_id = e.target.value; render(root, ctx); }),
      select("series", [["", "Tutte le serie"], ...series.map((s) => [s, s])], state.series, { "aria-label": "Serie", onchange: (e) => { state.series = e.target.value; render(root, ctx); } }),
      h("span", { class: "spacer" }), viewToggle("riunioni", view, (v) => { view = v; render(root, ctx); })),
    items.length ? (bySeries
      ? Object.entries(bySeries).sort(([a], [b]) => (a === "") - (b === "") || a.localeCompare(b)).map(([s, ms]) => [
        h("div", { class: "group-title" }, s || "Riunioni singole", ` · ${ms.length}`),
        h("ul", { class: listOrCards(view) }, ms.map(meetingRow))])
      : h("ul", { class: listOrCards(view) }, items.map(meetingRow)))
      : h("div", { class: "card" }, h("div", { class: "empty" }, "Nessun verbale. Creane uno: partecipanti, ordine del giorno, decisioni e azioni.")));
}

async function renderDoc(root, ctx) {
  const isNew = ctx.id === "new";
  const [customers, projects, users, series] = await Promise.all([loadCustomers(), loadProjects(), isTeam() ? loadUsers() : [], get("/api/meetings/series")]);
  let m = isNew ? { title: "", date: nowLocal(), visibility: "team" } : await get(`/api/meetings/${ctx.id}`);
  if (isNew && ctx.query.event_id) {
    const ev = await get(`/api/events/${ctx.query.event_id}`).catch(() => null);
    if (ev) m = { ...m, title: ev.title, date: ev.start, event_id: ev.id, customer_id: ev.customer_id, project_id: ev.project_id };
  }
  if (isNew && ctx.query.series) m.series = ctx.query.series;
  const actions = isNew ? [] : await get(`/api/meetings/${m.id}/actions`);
  const carried = isNew ? [] : await get(`/api/meetings/${m.id}/carried`);
  if (!ctx.isCurrent()) return;
  const F = store.schema.resources.meetings.fields;
  const fk = { customers, projects };
  const form = h("form", { class: "form" });
  const seriesInput = field("series", F.series, m.series, fk);
  seriesInput.querySelector("input").setAttribute("list", "series-list");
  form.append(
    h("div", { class: "form-row doc-meta" }, field("title", F.title, m.title, fk), field("date", F.date, m.date, fk),
      seriesInput, field("customer_id", F.customer_id, m.customer_id, fk), field("project_id", F.project_id, m.project_id, fk)),
    h("datalist", { id: "series-list" }, series.map((s) => h("option", { value: s }))),
    h("div", { class: "doc-pair" }, field("attendees", F.attendees, m.attendees, fk), field("agenda", F.agenda, m.agenda, fk)),
    h("div", { class: "doc-big" }, field("discussion", F.discussion, m.discussion, fk)),
    h("div", { class: "doc-pair" }, field("decisions", F.decisions, m.decisions, fk), field("next_meeting", F.next_meeting, m.next_meeting, fk)));
  if (isTeam()) form.append(field("visibility", F.visibility, m.visibility, fk));
  const pasted = pasteImages(form, "meetings", isNew ? null : m.id);

  // azioni
  const rowsBox = h("div", { class: "action-list" });
  const addAction = (a = {}) => {
    const item = h("div", { class: "action-item", dataset: { id: a.id || "" } },
      h("input", { type: "text", value: a.title || "", placeholder: "Cosa fare…", "aria-label": "Azione" }),
      h("div", { class: "action-meta" },
        isTeam() ? select("assignee_id", [["", "Chi —"], ...users.map((u) => [u.id, u.name])], a.assignee_id, { "aria-label": "Chi" }) : null,
        h("input", { type: "date", value: a.due_date || "", "aria-label": "Entro" }),
        select("status", ["da_fare", "in_corso", "chiuso"].map((x) => [x, label(x)]), a.status || "da_fare", { "aria-label": "Stato" }),
        h("button", { class: "icon-btn", type: "button", "aria-label": "Togli azione", onclick: () => { item.remove(); dirty = true; } }, icon("x"))));
    rowsBox.append(item);
    return item;
  };
  actions.forEach(addAction);
  const readActions = () => [...rowsBox.children].map((tr) => {
    const title = tr.querySelector("input[type=text]");
    const get2 = (n) => tr.querySelector(`[name=${n}]`)?.value || null;
    return { id: tr.dataset.id ? Number(tr.dataset.id) : undefined, title: title.value.trim(), due_date: tr.querySelector("input[type=date]").value || null,
      status: get2("status"), assignee_id: get2("assignee_id") ? Number(get2("assignee_id")) : null };
  }).filter((a) => a.title);

  let dirty = false;
  root.addEventListener("input", () => { dirty = true; });
  setLeaveGuard(() => dirty);

  async function save(silent = false) {
    try {
      await resolveCombos(form);
      const data = readForm(form, F);
      const created = isNew && !m.id;
      const saved = created ? await post("/api/meetings", { ...data, event_id: m.event_id || null }) : await put(`/api/meetings/${m.id}`, data);
      m = saved;
      if (created) await pasted.flush(m.id);
      await put(`/api/meetings/${m.id}/actions`, { actions: readActions() });
      dirty = false;
      setLeaveGuard(null);
      if (!silent) toast("Verbale salvato", "ok");
      if (isNew) location.replace(`#/riunioni/${m.id}`);
      else render(root, { ...ctx, id: String(m.id) });
    } catch (err) { showError(err); }
  }
  form.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); } });
  root.onkeydown = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); } };

  const sm = customers.find((c) => c.id === m.customer_id);
  const suggest = async () => {
    const cid = Number(form.elements.namedItem("customer_id").value);
    if (!cid) return;
    const c = await get(`/api/customers/${cid}`);
    const att = form.elements.namedItem("attendees");
    const missing = (c.service_managers || []).filter((s) => !att.value.includes(s.name));
    if (missing.length && await confirmDialog(`Aggiungere ai partecipanti il service manager (${missing.map((s) => s.name).join(", ")})?`, { confirm: "Aggiungi", danger: false })) {
      att.value = [att.value.trim(), ...missing.map((s) => s.name)].filter(Boolean).join("\n");
      att.dispatchEvent(new Event("input"));
    }
  };
  form.elements.namedItem("customer_id").addEventListener("change", suggest);
  void sm;

  clear(root, h("div", { class: "doc" },
    pageHead(isNew ? "Nuovo verbale" : m.title, { eyebrow: h("a", { href: "#/riunioni" }, "← Riunioni") },
      !isNew ? h("button", { class: "btn", type: "button", onclick: () => print(m, readActions()) }, icon("print"), "Stampa / PDF") : null,
      !isNew && m.series ? h("a", { class: "btn", href: `#/riunioni/new?series=${encodeURIComponent(m.series)}` }, "Prossima della serie") : null,
      !isNew ? h("button", { class: "btn btn-danger", type: "button", onclick: async () => {
        if (!(await confirmDialog("Eliminare il verbale? Le azioni restano come task.", { confirm: "Elimina" }))) return;
        await del(`/api/meetings/${m.id}`).catch(showError);
        setLeaveGuard(null);
        location.hash = "#/riunioni";
      } }, "Elimina") : null,
      h("button", { class: "btn focus-btn", type: "button", onclick: toggleFocus, title: "Nasconde menu e barra in alto e porta il verbale a schermo intero" }, icon("maximize"), h("span", { class: "on-off" }, "Schermo intero")),
      h("button", { class: "btn btn-primary", type: "button", onclick: () => save() }, "Salva ", h("kbd", {}, "Ctrl S"))),
    h("div", { class: "doc-cols" },
      h("div", { class: "col-main" }, h("div", { class: "card card-pad" }, form)),
      h("div", { class: "col-side" },
        h("section", { class: "card" },
          h("div", { class: "card-head" }, h("h2", {}, "Azioni"), h("span", { class: "meta" }, "diventano task")),
          h("div", { class: "card-body" }, rowsBox,
            h("button", { class: "btn btn-sm btn-ghost", type: "button", style: { marginTop: "8px" }, onclick: () => { addAction().querySelector("input").focus(); dirty = true; } }, icon("plus"), "Aggiungi azione"))),
        carried.length ? h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, "Azioni aperte dalle riunioni precedenti"), badge(m.series, "violet")),
          h("ul", { class: "list" }, carried.map((t) => taskRow(t, { onChange: () => render(root, ctx), customer: false, extra: t.meeting_title ? h("span", {}, `da «${t.meeting_title}»`) : null })))) : null,
        !isNew ? h("section", { class: "card card-pad" }, attachmentsBox("meetings", m.id)) : null))));
}

/** Verbale a schermo intero: nasconde menu e barra in alto (e usa lo schermo intero del browser se disponibile). */
function toggleFocus() {
  const app = document.getElementById("app");
  const on = !app.classList.contains("focus");
  app.classList.toggle("focus", on);
  document.querySelectorAll(".focus-btn .on-off").forEach((el) => { el.textContent = on ? "Esci da schermo intero" : "Schermo intero"; });
  if (on && document.documentElement.requestFullscreen && !document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => { /* resta la sola modalità senza menu */ });
  } else if (!on && document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}
document.addEventListener("fullscreenchange", () => {
  if (document.fullscreenElement) return;
  document.getElementById("app")?.classList.remove("focus");
  document.querySelectorAll(".focus-btn .on-off").forEach((el) => { el.textContent = "Schermo intero"; });
});

function print(m, actions) {
  printDoc(
    h("h1", {}, m.title),
    h("div", { class: "meta" }, [m.date ? fmtDateTime(m.date) : "", m.customer_name, m.project_name, m.series ? `Serie: ${m.series}` : ""].filter(Boolean).join(" · ")),
    m.attendees ? [h("h2", {}, "Partecipanti"), h("pre", {}, m.attendees)] : null,
    m.agenda ? [h("h2", {}, "Ordine del giorno"), h("pre", {}, m.agenda)] : null,
    m.discussion ? [h("h2", {}, "Discussione"), h("pre", {}, m.discussion)] : null,
    m.decisions ? [h("h2", {}, "Decisioni"), h("pre", {}, m.decisions)] : null,
    actions.length ? [h("h2", {}, "Azioni"), h("table", {}, h("tr", {}, h("th", {}, "Azione"), h("th", {}, "Entro"), h("th", {}, "Stato")),
      actions.map((a) => h("tr", {}, h("td", {}, a.title), h("td", {}, a.due_date ? fmtDate(a.due_date, { year: true }) : ""), h("td", {}, label(a.status)))))] : null,
    m.next_meeting ? [h("h2", {}, "Prossimo incontro"), h("pre", {}, m.next_meeting)] : null);
}
