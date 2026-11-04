// Checklist: modelli di procedura (es. "Upgrade NetEye") da avviare e spuntare passo per passo.
import { del, get, post, put } from "../api.js";
import { openEditor } from "../form.js";
import {
  badge, card, clear, confirmDialog, customerChip, fmtDateTime, h, icon, loadCustomers, pageHead, select, showError, toast,
} from "../ui.js";

export async function render(root, ctx) {
  if (ctx.id) return renderRun(root, ctx);
  const [templates, runs, customers] = await Promise.all([get("/api/checklist_templates"), get("/api/checklist_runs"), loadCustomers()]);
  if (!ctx.isCurrent()) return;
  const reload = () => render(root, ctx);
  const startForm = (tpl) => {
    const sel = select("customer_id", [["", "Nessun cliente"], ...customers.filter((c) => c.active).map((c) => [c.id, c.code ? `${c.code} · ${c.name}` : c.name])], "");
    return h("div", { class: "row" }, sel, h("button", { class: "btn btn-sm btn-primary", type: "button", onclick: async () => {
      try { const run = await post(`/api/checklist_templates/${tpl.id}/start`, { customer_id: sel.value || null }); location.hash = `#/checklist/${run.id}`; } catch (err) { showError(err); }
    } }, "Avvia"));
  };
  const openRuns = runs.filter((r) => !r.completed_at), doneRuns = runs.filter((r) => r.completed_at);
  const runRow = (r) => h("li", { class: `item${r.completed_at ? " done" : ""}`, onclick: () => { location.hash = `#/checklist/${r.id}`; } },
    h("div", { class: "main-col" }, h("div", { class: "t-title" }, r.name), h("div", { class: "meta" }, customerChip(r), r.change_title ? h("span", {}, `Modifica: ${r.change_title}`) : null,
      h("span", { class: "progress-txt" }, `${r.steps.filter((s) => s.done).length}/${r.steps.length}`))),
    h("div", { class: "side-col" }, r.completed_at ? `completata ${fmtDateTime(r.completed_at)}` : `avviata ${fmtDateTime(r.started_at)}`));
  clear(root,
    pageHead("Checklist", "Procedure ripetibili: il modello si può cambiare, lo storico delle esecuzioni resta",
      h("button", { class: "btn btn-primary", type: "button", onclick: () => openEditor("checklist_templates", null, { onSave: reload, title: "Nuovo modello di checklist" }) }, icon("plus"), "Nuovo modello")),
    h("div", { class: "cols" },
      h("div", { class: "col-main" },
        card("In corso", openRuns.length ? h("ul", { class: "list" }, openRuns.map(runRow)) : h("div", { class: "empty" }, "Nessuna checklist in corso")),
        doneRuns.length ? card("Completate", h("ul", { class: "list" }, doneRuns.slice(0, 30).map(runRow))) : null),
      h("div", { class: "col-side" },
        card("Modelli", templates.length ? h("ul", { class: "list" }, templates.map((t) => h("li", { class: "item", style: { flexWrap: "wrap", cursor: "default" } },
          h("div", { class: "main-col" }, h("div", { class: "t-title" }, t.name), h("div", { class: "meta" }, `${t.steps.length} passi`, t.description ? h("span", {}, t.description) : null)),
          h("button", { class: "icon-btn", type: "button", "aria-label": `Modifica ${t.name}`, onclick: () => openEditor("checklist_templates", t, { onSave: reload }) }, icon("edit")),
          startForm(t)))) : h("div", { class: "empty" }, "Nessun modello. Esempio: «Upgrade NetEye» con snapshot, upgrade, verifiche.")))));
}

async function renderRun(root, ctx) {
  const run = await get(`/api/checklist_runs/${ctx.id}`);
  if (!ctx.isCurrent()) return;
  const done = run.steps.filter((s) => s.done).length;
  clear(root,
    pageHead(run.name, { eyebrow: h("a", { href: "#/checklist" }, "← Checklist") },
      run.completed_at ? badge("Completata", "ok") : badge(`${done}/${run.steps.length}`, "info"),
      h("button", { class: "btn btn-danger", type: "button", onclick: async () => {
        if (!(await confirmDialog("Eliminare questa esecuzione della checklist?", { confirm: "Elimina" }))) return;
        await del(`/api/checklist_runs/${run.id}`).catch(showError);
        location.hash = "#/checklist";
      } }, "Elimina")),
    h("div", { class: "row small muted", style: { marginBottom: "12px" } }, customerChip(run), run.change_title ? h("span", {}, `Modifica: ${run.change_title}`) : null, `Avviata ${fmtDateTime(run.started_at)}`),
    h("div", { class: "bar", style: { marginBottom: "16px" } }, h("span", { style: { width: `${(done / run.steps.length) * 100}%` } })),
    h("ol", { class: "list card", style: { paddingLeft: 0 } }, run.steps.map((s, i) => h("li", { class: `item${s.done ? " done" : ""}` },
      h("input", { type: "checkbox", checked: s.done, "aria-label": s.text, onchange: async (e) => {
        try { await put(`/api/checklist_runs/${run.id}/steps/${i}`, { done: e.target.checked }); render(root, ctx); } catch (err) { showError(err); }
      } }),
      h("div", { class: "main-col" }, h("div", { class: "t-title" }, `${i + 1}. ${s.text}`), s.done_at ? h("div", { class: "meta" }, `fatto ${fmtDateTime(s.done_at)}`) : null)))),
    h("label", { class: "field", style: { marginTop: "16px" } }, "Note", h("textarea", { rows: 3, value: run.notes || "", onchange: async (e) => {
      await put(`/api/checklist_runs/${run.id}`, { notes: e.target.value }).catch(showError); toast("Note salvate", "ok");
    } })));
}
