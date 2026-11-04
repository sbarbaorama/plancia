// Ore: registrazioni da timer o a mano, totali per cliente (con ore a contratto), progetto e giorno; export CSV.
import { del, get, qs } from "../api.js";
import { openTimeEditor, startTimer } from "../editors.js";
import {
  addDays, card, clear, confirmDialog, customerFilter, fmtDate, fmtHours, fmtMin, h, icon, isAdmin, isTeam, kpi, loadCustomers,
  mondayOf, pageHead, parseISO, segmented, showError, todayISO, toISO,
} from "../ui.js";

const state = { period: "mese", user: "me", customer_id: "" };

function range(period) {
  const t = todayISO();
  if (period === "settimana") return [mondayOf(t), addDays(mondayOf(t), 6)];
  if (period === "mese_scorso") {
    const d = parseISO(t); d.setDate(1); d.setMonth(d.getMonth() - 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return [toISO(d), toISO(end)];
  }
  const end = new Date(parseISO(t).getFullYear(), parseISO(t).getMonth() + 1, 0);
  return [t.slice(0, 8) + "01", toISO(end)];
}

export async function render(root, ctx) {
  if (ctx.query.customer_id && !ctx.refresh) state.customer_id = ctx.query.customer_id;
  const [from, to] = range(state.period);
  const customers = await loadCustomers();
  const s = await get(`/api/time/summary${qs({ from, to, user: state.user })}`);
  if (!ctx.isCurrent()) return;
  const reload = () => render(root, ctx);
  const entries = state.customer_id ? s.entries.filter((e) => String(e.customer_id) === String(state.customer_id)) : s.entries;
  const total = entries.reduce((x, e) => x + e.minutes, 0);
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const perDay = Object.fromEntries(days.map((d) => [d, 0]));
  entries.forEach((e) => { perDay[e.date] = (perDay[e.date] || 0) + e.minutes; });
  const maxDay = Math.max(60, ...Object.values(perDay));
  const maxCust = Math.max(1, ...s.by_customer.map((x) => x.minutes));

  clear(root,
    pageHead("Ore", "Il tempo registrato con il timer (▶ su ogni task) o inserito a mano",
      h("a", { class: "btn", href: `/api/time/export.csv${qs({ from, to, user: state.user })}` }, icon("download"), "Esporta CSV"),
      h("button", { class: "btn", type: "button", onclick: () => startTimer(null) }, icon("play"), "Timer"),
      h("button", { class: "btn btn-primary", type: "button", onclick: () => openTimeEditor(null, { onSave: reload, prefill: { customer_id: state.customer_id || null } }) }, icon("plus"), "Registra ore")),
    h("div", { class: "filters" },
      segmented([["settimana", "Questa settimana"], ["mese", "Questo mese"], ["mese_scorso", "Mese scorso"]], state.period, (v) => { state.period = v; reload(); }, "Periodo"),
      customerFilter(customers, state.customer_id, (e) => { state.customer_id = e.target.value; reload(); }),
      isTeam() && isAdmin() ? segmented([["me", "Le mie"], ["all", "Tutto il team"]], state.user, (v) => { state.user = v; reload(); }, "Utenti") : null),
    h("div", { class: "kpis" },
      kpi("Totale", fmtHours(total), `${fmtDate(from)} – ${fmtDate(to)}`),
      kpi("Media per giorno lavorato", fmtHours(total / Math.max(1, Object.values(perDay).filter(Boolean).length)), ""),
      kpi("Clienti seguiti", s.by_customer.filter((x) => x.id).length, ""),
      kpi("Registrazioni", entries.length, "")),
    h("div", { class: "cols" },
      h("div", { class: "col-main" },
        card("Per giorno", h("div", { class: "card-body" }, h("div", { class: "daybars", role: "img", "aria-label": "Ore per giorno" }, days.map((d) => {
          const wd = parseISO(d).getDay();
          return h("div", { class: wd === 0 || wd === 6 ? "we" : "", style: { height: `${(perDay[d] / maxDay) * 100}%` }, title: `${fmtDate(d, { weekday: true })}: ${fmtMin(perDay[d])}` });
        })), h("div", { class: "row small muted", style: { justifyContent: "space-between" } }, h("span", {}, fmtDate(from)), h("span", {}, fmtDate(to))))),
        card("Registrazioni", entries.length ? h("div", { class: "table-wrap" }, h("table", { class: "t" },
          h("thead", {}, h("tr", {}, h("th", {}, "Giorno"), isTeam() && state.user === "all" ? h("th", {}, "Chi") : null, h("th", {}, "Cliente"), h("th", {}, "Task / nota"), h("th", { class: "num" }, "Tempo"), h("th"))),
          h("tbody", {}, [...entries].reverse().map((e) => h("tr", {},
            h("td", { class: "nowrap" }, fmtDate(e.date, { weekday: true })),
            isTeam() && state.user === "all" ? h("td", {}, e.user_name || "") : null,
            h("td", {}, e.customer_code ? h("span", { class: "chip" }, e.customer_code) : "—"),
            h("td", {}, e.task_title || e.note || "—", e.task_title && e.note ? h("div", { class: "small muted" }, e.note) : null, e.started_at && !e.ended_at ? h("span", { class: "badge accent" }, "in corso") : null),
            h("td", { class: "num" }, fmtMin(e.minutes)),
            h("td", { class: "nowrap" },
              h("button", { class: "icon-btn", type: "button", "aria-label": "Modifica", onclick: () => openTimeEditor(e, { onSave: reload }) }, icon("edit")),
              h("button", { class: "icon-btn", type: "button", "aria-label": "Elimina", onclick: async () => {
                if (!(await confirmDialog("Eliminare questa registrazione?", { confirm: "Elimina" }))) return;
                await del(`/api/time_entries/${e.id}`).catch(showError); reload();
              } }, icon("trash"))))))))
          : h("div", { class: "empty" }, "Nessuna registrazione nel periodo."))),
      h("div", { class: "col-side" },
        card("Per cliente", s.by_customer.length ? h("div", { class: "card-body stack" }, s.by_customer.map((x) => h("div", { class: "stack", style: { gap: "4px" } },
          h("div", { class: "row" }, h("span", { style: { flex: 1 } }, x.label), h("b", {}, fmtHours(x.minutes)),
            x.contract_hours ? h("span", { class: x.minutes / 60 > x.contract_hours ? "soon small" : "muted small" }, `/ ${x.contract_hours} h`) : null),
          h("div", { class: "bar" }, h("span", { class: x.contract_hours && x.minutes / 60 > x.contract_hours ? "over" : "", style: { width: `${x.contract_hours ? Math.min(100, (x.minutes / 60 / x.contract_hours) * 100) : (x.minutes / maxCust) * 100}%` } })))))
          : h("div", { class: "empty" }, "—")),
        card("Per progetto", s.by_project.length ? h("ul", { class: "list compact-list card-body" }, s.by_project.map((x) => h("li", { class: "item" }, h("span", { class: "main-col" }, x.label === "—" ? "Senza progetto" : x.label), h("b", {}, fmtMin(x.minutes)))))
          : h("div", { class: "empty" }, "—")),
        card("Task con più tempo", s.by_task.filter((x) => x.id).length ? h("ul", { class: "list compact-list card-body" }, s.by_task.filter((x) => x.id).slice(0, 10).map((x) => h("li", { class: "item" }, h("span", { class: "main-col" }, x.label === "—" ? "Senza progetto" : x.label), h("b", {}, fmtMin(x.minutes)))))
          : h("div", { class: "empty" }, "—")))));
}
