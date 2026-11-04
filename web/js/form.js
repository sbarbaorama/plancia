// Moduli generici: costruiti dalla descrizione delle risorse che manda il server (/api/schema).
import { del, post, put } from "./api.js";
import { attachmentsBox } from "./attachments.js";
import {
  autoGrow, closePanel, confirmDialog, h, isTeam, label, loadContacts, loadCustomers, loadProjects, loadUsers, onSubmitOnce,
  openPanel, showError, store, toast, invalidate,
} from "./ui.js";

const FK_LOADERS = { customers: loadCustomers, projects: loadProjects, users: loadUsers, contacts: loadContacts };
const TEAM_ONLY = new Set(["visibility", "assignee_id"]);
const URL_OF = (res) => `/api/${res}`;

function fkOptions(target, items, value, field) {
  let list = items || [];
  if (target === "customers") list = list.filter((c) => c.active || String(c.id) === String(value));
  if (target === "projects") list = list.filter((p) => p.status !== "chiuso" || String(p.id) === String(value));
  if (target === "users") list = list.filter((u) => u.active || String(u.id) === String(value));
  if (target === "contacts" && field === "consultant_id") list = list.filter((c) => c.is_consultant || String(c.id) === String(value));
  const text = (x) => target === "customers" ? (x.code ? `${x.code} · ${x.name}` : x.name)
    : target === "projects" ? (x.customer_code ? `${x.name} (${x.customer_code})` : x.name)
      : target === "contacts" ? (x.company ? `${x.name} — ${x.company}` : x.name) : (x.name || x.title);
  return [["", target === "users" ? "Nessuno" : "—"], ...list.map((x) => [x.id, text(x)])];
}

/** Crea il controllo per un campo. */
export function widget(name, spec, value, fk = {}) {
  const common = { name, id: `f-${name}` };
  switch (spec.type) {
    case "longtext":
      return autoGrow(h("textarea", { ...common, rows: name === "command" ? 3 : 4, value: value ?? "", class: name === "command" ? "mono" : "" }));
    case "enum":
      return h("select", common, spec.options.map((o) => h("option", { value: o, selected: o === value }, label(o))));
    case "fk": {
      const opts = fkOptions(spec.options, fk[spec.options], value, name);
      return h("select", common, opts.map(([v, l]) => h("option", { value: v, selected: String(v) === String(value ?? "") }, l)));
    }
    case "date": return h("input", { ...common, type: "date", value: value || "" });
    case "datetime": return h("input", { ...common, type: "datetime-local", value: value ? value.slice(0, 16) : "" });
    case "time": return h("input", { ...common, type: "time", value: value || "" });
    case "int": return h("input", { ...common, type: "number", step: 1, min: spec.options?.[0], max: spec.options?.[1], value: value ?? "" });
    case "float": return h("input", { ...common, type: "number", step: "0.5", min: spec.options?.[0], value: value ?? "" });
    case "bool": return h("input", { ...common, type: "checkbox", checked: !!value });
    case "color": return h("input", { ...common, type: "color", value: value || "#2456d3" });
    case "email": return h("input", { ...common, type: "email", value: value ?? "", autocomplete: "off" });
    case "steps": return autoGrow(h("textarea", { ...common, rows: 6, value: Array.isArray(value) ? value.join("\n") : value || "", placeholder: "Un passo per riga" }));
    default: return h("input", { ...common, type: "text", value: value ?? "", maxlength: 300, autocomplete: "off" });
  }
}

export function field(name, spec, value, fk) {
  const w = widget(name, spec, value, fk);
  if (spec.type === "bool") return h("label", { class: "check" }, w, spec.label);
  return h("label", { class: "field", for: w.id }, spec.label, w);
}

/** Legge i valori del modulo come oggetto pronto per l'API. */
export function readForm(form, fields) {
  const out = {};
  for (const [name, spec] of Object.entries(fields)) {
    const el = form.elements.namedItem(name);
    if (!el) continue;
    if (spec.type === "bool") out[name] = el.checked;
    else if (spec.type === "fk") out[name] = el.value ? Number(el.value) : null;
    else if (spec.type === "int" || spec.type === "float") out[name] = el.value === "" ? null : Number(el.value);
    else if (spec.type === "steps") out[name] = el.value.split("\n").map((s) => s.trim()).filter(Boolean);
    else out[name] = el.value;
  }
  return out;
}

async function fkData(fields) {
  const needed = new Set(Object.values(fields).filter((s) => s.type === "fk").map((s) => s.options));
  const fk = {};
  await Promise.all([...needed].filter((t) => FK_LOADERS[t]).map(async (t) => { fk[t] = await FK_LOADERS[t]().catch(() => []); }));
  return fk;
}

/**
 * Apre l'editor di una risorsa nel pannello laterale.
 * opts: prefill, onSave(item), title, hide[], layout[][], extra(item, form) → nodi, afterSave(item, isNew)
 */
export async function openEditor(resource, item, opts = {}) {
  const schema = store.schema.resources[resource];
  const isNew = !item?.id;
  const values = { ...(schema.defaults || {}), ...(item || {}), ...(opts.prefill || {}) };
  const hide = new Set(opts.hide || []);
  if (!isTeam()) TEAM_ONLY.forEach((f) => hide.add(f));
  const layout = (opts.layout || schema.form || Object.keys(schema.fields).map((f) => [f]))
    .map((row) => row.filter((f) => !hide.has(f) && schema.fields[f])).filter((row) => row.length);
  const used = Object.fromEntries(layout.flat().map((f) => [f, schema.fields[f]]));
  const fk = await fkData(used);
  const form = h("form", { class: "form", novalidate: true });
  for (const row of layout) {
    const nodes = row.map((f) => field(f, schema.fields[f], values[f], fk));
    form.append(row.length > 1 ? h("div", { class: "form-row" }, nodes) : nodes[0]);
  }
  const extraNodes = opts.extra ? await opts.extra(values, form, isNew) : null;
  if (extraNodes) form.append(...[extraNodes].flat().filter(Boolean));
  if (!isNew && schema.attachments) form.append(attachmentsBox(resource, item.id));
  const foot = h("div", { class: "panel-foot" },
    h("button", { class: "btn btn-primary", type: "submit" }, isNew ? `Crea` : "Salva"),
    h("button", { class: "btn", type: "button", onclick: () => closePanel() }, "Annulla"),
    h("span", { class: "spacer" }),
    opts.footExtra ? opts.footExtra(values) : null,
    !isNew && opts.deletable !== false ? h("button", {
      class: "btn btn-danger", type: "button",
      onclick: async () => {
        if (!(await confirmDialog(`Eliminare «${item[schema.title] || schema.label}»?`, { confirm: "Elimina", detail: "Si eliminano anche gli allegati." }))) return;
        try {
          await del(`${URL_OF(resource)}/${item.id}`);
          toast("Eliminato");
          invalidateFor(resource);
          closePanel();
          opts.onSave?.(null);
        } catch (err) { showError(err); }
      },
    }, "Elimina") : null);
  form.append(foot);
  form.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); } });
  onSubmitOnce(form, async () => {
    const data = readForm(form, used);
    if (opts.transform) Object.assign(data, opts.transform(data, form));
    try {
      const saved = isNew ? await post(URL_OF(resource), { ...(opts.hiddenValues || {}), ...data })
        : await put(`${URL_OF(resource)}/${item.id}`, data);
      if (opts.afterSave) await opts.afterSave(saved, isNew, form);
      invalidateFor(resource);
      toast(isNew ? `Creato: ${schema.label.toLowerCase()}` : "Salvato", "ok");
      if (saved?.freezes?.length) toast(`Attenzione: data in un periodo di blocco (${saved.freezes.map((f) => f.title).join(", ")})`, "warn", 6000);
      closePanel();
      opts.onSave?.(saved);
    } catch (err) { showError(err); }
  });
  openPanel(opts.title || (isNew ? `Nuovo: ${schema.label.toLowerCase()}` : schema.label), form, { wide: opts.wide });
  return form;
}

export function invalidateFor(resource) {
  if (resource === "customers") invalidate("customers");
  if (resource === "projects") invalidate("projects");
  if (resource === "contacts") invalidate("contacts");
  if (resource === "users") invalidate("users");
}
