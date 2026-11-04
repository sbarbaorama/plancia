// Strumenti comuni dell'interfaccia: creazione elementi, icone, pannello, avvisi, formati, cache.
import { ApiError, ServerUnreachable, get } from "./api.js";

// ------------------------------------------------------------------ DOM
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") {
      for (const [sk, sv] of Object.entries(v)) if (sk.startsWith("--")) el.style.setProperty(sk, sv); else el.style[sk] = sv;
    }
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "value" && (tag === "input" || tag === "textarea" || tag === "select")) el.value = v;
    else if (k === "checked") el.checked = !!v;
    else if (k === "html") el.innerHTML = v; // solo per SVG interni
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

// ------------------------------------------------------------------ icone (tratto, 24×24)
const P = {
  oggi: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  pianifica: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M8.5 15l2.2 2.2 4.8-4.7"/>',
  task: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',
  calendario: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  timeline: '<path d="M4 6h9M7 12h11M4 18h7"/><path d="M3 3v18"/>',
  riunioni: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  progetti: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  consulenze: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
  note: '<path d="M5 3h14v12l-6 6H5z"/><path d="M13 21v-6h6"/>',
  inbox: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
  modifiche: '<path d="M4 7h13l-3-3M20 17H7l3 3"/>',
  scadenze: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
  attese: '<path d="M6 2h12M6 22h12M7 2c0 6 10 6 10 10s-10 4-10 10M17 2c0 6-10 6-10 10"/>',
  checklist: '<path d="m3 6 2 2 3-3M3 13l2 2 3-3M3 20l2 2"/><path d="M11 7h10M11 14h10M11 21h10"/>',
  clienti: '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M2 21h20M8 7h4M8 11h4M8 15h4"/>',
  contatti: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M17 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>',
  ore: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M10 2h4M19 5l1.5-1.5"/>',
  riepilogo: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  archivio: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  impostazioni: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  grip: '<circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  clip: '<path d="m21 11-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6L15.5 6"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  upload: '<path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  pin: '<path d="M12 17v5M5 17h14l-2-4V5h1V3H6v2h1v8z"/>',
  external: '<path d="M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
  collapse: '<path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  cards: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
  team: '<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2 20a6 6 0 0 1 12 0M14 20a5 5 0 0 1 8-3.5"/>',
};
export function icon(name, cls = "") {
  const span = document.createElement("span");
  span.className = `ic ${cls}`.trim();
  span.style.display = "inline-flex";
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name] || P.task}</svg>`;
  return span;
}

// ------------------------------------------------------------------ avvisi
export function toast(message, type = "info", ms = 3200) {
  const el = h("div", { class: `toast ${type}`, role: type === "error" ? "alert" : "status" }, message);
  document.getElementById("toasts").append(el);
  setTimeout(() => el.remove(), ms);
}
export function showError(err) {
  if (err instanceof ServerUnreachable) return;
  if (err instanceof ApiError && err.status === 401) return;
  console.error(err);
  toast(err?.message || String(err), "error", 5000);
}
export function confirmDialog(message, { confirm = "Conferma", danger = true, detail = "" } = {}) {
  return new Promise((resolve) => {
    const dlg = h("dialog", { "aria-label": "Conferma" },
      h("div", { class: "dialog-body" }, h("p", { style: { fontWeight: "600" } }, message), detail ? h("p", { class: "muted small" }, detail) : null),
      h("div", { class: "dialog-foot" },
        h("button", { class: "btn", type: "button", onclick: () => dlg.close("no") }, "Annulla"),
        h("button", { class: `btn ${danger ? "btn-danger" : "btn-primary"}`, type: "button", onclick: () => dlg.close("yes") }, confirm)));
    dlg.addEventListener("close", () => { resolve(dlg.returnValue === "yes"); dlg.remove(); });
    document.body.append(dlg);
    dlg.showModal();
  });
}
/** Finestra con testo da copiare (riepiloghi). */
export function textDialog(title, text, extra = null) {
  const area = h("textarea", { rows: 14, value: text, readonly: true, style: { fontFamily: "var(--mono)", fontSize: "12.5px" } });
  const dlg = h("dialog", { "aria-label": title, style: { width: "min(640px, 92vw)" } },
    h("div", { class: "dialog-body" }, h("h2", { style: { marginBottom: "12px" } }, title), extra, area),
    h("div", { class: "dialog-foot" },
      h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, "Chiudi"),
      h("button", { class: "btn btn-primary", type: "button", onclick: (e) => copyText(text, e.currentTarget) }, icon("copy"), "Copia")));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

// ------------------------------------------------------------------ pannello laterale
let panelClose = null;
export function openPanel(title, content, { onClose, wide = false } = {}) {
  const panel = document.getElementById("panel");
  const backdrop = document.getElementById("panel-backdrop");
  if (!panel) return;
  closePanel(true);
  document.getElementById("panel-title").textContent = title;
  clear(document.getElementById("panel-body"), content);
  panel.style.width = wide ? "min(760px, 100vw)" : "";
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
  backdrop.hidden = false;
  panelClose = onClose || null;
  setTimeout(() => {
    const first = panel.querySelector("input:not([type=hidden]):not([type=checkbox]), textarea, select");
    if (first) first.focus();
  }, 60);
}
export function closePanel(silent = false) {
  const panel = document.getElementById("panel");
  if (!panel || !panel.classList.contains("open")) return;
  panel.classList.remove("open");
  panel.setAttribute("aria-hidden", "true");
  document.getElementById("panel-backdrop").hidden = true;
  const fn = panelClose;
  panelClose = null;
  if (fn && !silent) fn();
}
export const panelOpen = () => document.getElementById("panel")?.classList.contains("open");

/** Menu a comparsa accanto a un pulsante. */
export function popMenu(anchor, items) {
  document.querySelectorAll(".menu").forEach((m) => m.remove());
  const r = anchor.getBoundingClientRect();
  const menu = h("div", { class: "menu", role: "menu", style: { top: `${r.bottom + window.scrollY + 6}px`, left: `${Math.max(8, Math.min(r.left, window.innerWidth - 240))}px` } },
    items.map(([label, ic, fn]) => h("button", { type: "button", role: "menuitem", onclick: () => { menu.remove(); fn(); } }, ic ? icon(ic) : null, label)));
  document.body.append(menu);
  const off = (e) => { if (!menu.contains(e.target) && e.target !== anchor) { menu.remove(); document.removeEventListener("mousedown", off); } };
  setTimeout(() => document.addEventListener("mousedown", off), 0);
  menu.querySelector("button")?.focus();
  menu.addEventListener("keydown", (e) => { if (e.key === "Escape") { menu.remove(); anchor.focus(); } });
}

// ------------------------------------------------------------------ date e numeri
const pad = (n) => String(n).padStart(2, "0");
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => toISO(new Date());
export function parseISO(s) {
  if (!s) return null;
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  const out = new Date(y, m - 1, d);
  if (s.length > 10) { const [hh, mm] = s.slice(11, 16).split(":").map(Number); out.setHours(hh || 0, mm || 0); }
  return out;
}
export const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
export const daysBetween = (a, b) => Math.round((parseISO(b.slice(0, 10)) - parseISO(a.slice(0, 10))) / 86400000);
export function mondayOf(iso) { const d = parseISO(iso); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return toISO(d); }
export const nowLocal = () => { const d = new Date(); return `${toISO(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
export const monthName = (m) => MESI[m];
export const dayName = (d) => GIORNI[d];
export function fmtDate(iso, { year = false, weekday = false } = {}) {
  if (!iso) return "";
  const d = parseISO(iso);
  const base = `${d.getDate()} ${MESI[d.getMonth()].slice(0, 3)}${year || d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ""}`;
  return weekday ? `${GIORNI[d.getDay()].slice(0, 3)} ${base}` : base;
}
export function fmtLongDate(iso) {
  const d = parseISO(iso);
  return `${GIORNI[d.getDay()][0].toUpperCase()}${GIORNI[d.getDay()].slice(1)} ${d.getDate()} ${MESI[d.getMonth()]} ${d.getFullYear()}`;
}
export const fmtTime = (iso) => (iso && iso.length > 10 ? iso.slice(11, 16) : "");
export const fmtDateTime = (iso) => (iso ? `${fmtDate(iso)}${iso.length > 10 ? ` ${fmtTime(iso)}` : ""}` : "");
/** "oggi", "domani", "ieri", "tra 3 gg", "4 gg fa", altrimenti la data. */
export function fmtDue(iso) {
  if (!iso) return "";
  const n = daysBetween(todayISO(), iso);
  if (n === 0) return "oggi";
  if (n === 1) return "domani";
  if (n === -1) return "ieri";
  if (n < 0 && n > -15) return `${-n} gg fa`;
  if (n > 0 && n < 7) return GIORNI[parseISO(iso).getDay()].slice(0, 3) + " " + parseISO(iso).getDate();
  return fmtDate(iso);
}
export const dueClass = (iso, done = false) => (!iso || done ? "" : iso < todayISO() ? "late" : iso === todayISO() ? "soon" : "");
export function fmtMin(m) {
  m = Math.round(m || 0);
  const hh = Math.floor(m / 60), mm = m % 60;
  return hh ? `${hh} h${mm ? ` ${pad(mm)}` : ""}` : `${mm} min`;
}
export const fmtHours = (m) => `${(Math.round((m || 0) / 6) / 10).toLocaleString("it-IT")} h`;
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export function initials(name) {
  return (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join("");
}

// ------------------------------------------------------------------ stato condiviso
export const store = { schema: null, session: null, settings: null, customers: null, projects: null, users: null, contacts: null, companies: null };
export const isTeam = () => store.session?.mode === "team";
export const me = () => store.session?.user || { id: 1, name: "Io", role: "admin" };
export const isAdmin = () => !isTeam() || me().role === "admin";
export function label(value) {
  return store.schema?.enum_labels?.[value] ?? value ?? "";
}
export async function loadSchema() {
  if (!store.schema) store.schema = await get("/api/schema");
  return store.schema;
}
const cached = (key, url) => async (force = false) => {
  if (force || !store[key]) store[key] = await get(url);
  return store[key];
};
export const loadCustomers = cached("customers", "/api/customers");
export const loadProjects = cached("projects", "/api/projects");
export const loadUsers = cached("users", "/api/users");
export const loadContacts = cached("contacts", "/api/contacts");
export function invalidate(...keys) { for (const k of keys) store[k] = null; }

// ------------------------------------------------------------------ piccoli componenti
export function customerChip(item) {
  const code = item.customer_code || item.customer_name;
  const id = item.eff_customer_id || item.customer_id;
  if (!code) return null;
  return h("a", { class: "chip", href: `#/clienti/${id}`, title: item.customer_name || "", onclick: (e) => e.stopPropagation() }, code);
}
export function avatar(name, color) {
  return h("span", { class: "avatar", title: name || "", style: color ? { background: color } : null }, initials(name));
}
export function badge(text, tone = "") { return h("span", { class: `badge ${tone}` }, text); }
export function empty(text) { return h("div", { class: "empty" }, text); }
export function kpi(l, v, n = "", tone = "", href = null) {
  return h(href ? "a" : "div", { class: `kpi ${tone}`, href }, h("span", { class: "l" }, l), h("span", { class: "v" }, v), n ? h("span", { class: `n ${tone === "warn" ? "warn" : ""}` }, n) : null);
}
export function card(title, body, { actions = null, meta = null, cls = "" } = {}) {
  return h("section", { class: `card ${cls}` },
    title ? h("div", { class: "card-head" }, h("h2", {}, title), meta ? h("span", { class: "meta" }, meta) : null, actions) : null, body);
}
export function pageHead(title, sub, ...actions) {
  return h("div", { class: "page-head" },
    h("div", { class: "titles" }, typeof sub === "object" && sub?.eyebrow ? h("div", { class: "eyebrow" }, sub.eyebrow) : null,
      h("h1", {}, title), typeof sub === "string" && sub ? h("div", { class: "page-sub" }, sub) : null),
    h("div", { class: "toolbar" }, actions));
}
export function select(name, options, value, attrs = {}) {
  return h("select", { name, ...attrs },
    options.map(([v, l]) => h("option", { value: v ?? "", selected: String(v ?? "") === String(value ?? "") }, l)));
}
export function customerFilter(customers, value, onchange) {
  return select("customer_id", [["", "Tutti i clienti"], ...customers.filter((c) => c.active || String(c.id) === String(value)).map((c) => [c.id, c.code ? `${c.code} · ${c.name}` : c.name])],
    value, { "aria-label": "Cliente", onchange });
}
export function segmented(options, value, onchange, label = "") {
  const wrap = h("div", { class: "segmented", role: "group", "aria-label": label });
  for (const [v, l] of options) {
    wrap.append(h("button", { type: "button", class: v === value ? "on" : "", "aria-pressed": String(v === value), onclick: () => onchange(v) }, l));
  }
  return wrap;
}
export function tabs(items, active, onchange) {
  return h("div", { class: "tabs", role: "tablist" }, items.map(([key, text, count]) =>
    h("button", { type: "button", role: "tab", class: key === active ? "on" : "", "aria-selected": String(key === active), onclick: () => onchange(key) },
      text, count !== undefined && count !== null ? h("span", { class: "count" }, count) : null)));
}
export function checkButton(on, onclick, label = "Completa") {
  return h("button", { type: "button", class: `check-btn ${on ? "on" : ""}`, "aria-label": label, "aria-pressed": String(!!on),
    onclick: (e) => { e.stopPropagation(); onclick(e); } }, on ? icon("check") : null);
}
export async function copyText(text, button = null) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h("textarea", { value: text, style: { position: "fixed", opacity: "0" } });
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  if (button) {
    const old = button.innerHTML;
    button.textContent = "Copiato";
    setTimeout(() => { button.innerHTML = old; }, 1300);
  } else toast("Copiato negli appunti", "ok");
}
export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
/** La casella di testo si allunga con il contenuto (anche dopo che compare a schermo). */
export function autoGrow(ta) {
  const fit = () => {
    if (!ta.isConnected || !ta.offsetParent) return;
    const top = ta.closest(".panel-body, .main") ;
    const keep = top ? top.scrollTop : 0;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight + 2}px`;
    if (top) top.scrollTop = keep;
  };
  ta.classList.add("autogrow");
  ta.addEventListener("input", fit);
  ta.addEventListener("focus", fit);
  if (typeof ResizeObserver !== "undefined") {
    let lastW = 0;
    new ResizeObserver(() => { if (ta.offsetWidth && ta.offsetWidth !== lastW) { lastW = ta.offsetWidth; fit(); } }).observe(ta);
  }
  requestAnimationFrame(fit);
  return ta;
}
/** Evita doppi invii dello stesso modulo. */
export function onSubmitOnce(form, fn) {
  let busy = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    form.querySelectorAll("button[type=submit]").forEach((b) => { b.disabled = true; });
    try { await fn(e); } finally {
      busy = false;
      form.querySelectorAll("button[type=submit]").forEach((b) => { b.disabled = false; });
    }
  });
}
/** Stampa un documento preparato (verbale, rapportino…). */
export async function printDoc(...nodes) {
  const doc = document.getElementById("print-doc");
  clear(doc, nodes);
  document.body.classList.add("printing");
  const done = () => { document.body.classList.remove("printing"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  // aspetta le immagini (al massimo 4 secondi) prima di aprire la stampa
  await Promise.all([...doc.querySelectorAll("img")].map((img) => img.complete ? null
    : new Promise((r) => { img.addEventListener("load", r); img.addEventListener("error", r); setTimeout(r, 4000); })));
  setTimeout(() => window.print(), 50);
}
export function mailto(to, subject, body = "") {
  return `mailto:${encodeURIComponent(to || "")}?subject=${encodeURIComponent(subject || "")}&body=${encodeURIComponent(body)}`;
}

// ------------------------------------------------------------------ campo con elenco e "Aggiungi"
/**
 * Casella con menu a tendina filtrabile; se la voce non esiste si può aggiungere.
 * options: [[valore, etichetta, ...altre parole che la identificano]].
 * freeText: il valore è il testo stesso (es. Azienda); altrimenti un id in un campo nascosto (es. Cliente).
 * create(testo) → Promise<[valore, etichetta]> crea la voce nuova.
 */
export function combo({ name, id, options = [], value = "", placeholder = "", freeText = false, create = null, createLabel = "Aggiungi", emptyLabel = "" }) {
  const norm = (s) => String(s ?? "").trim().toLocaleLowerCase("it");
  let opts = options.filter(([v]) => v !== "" && v !== null && v !== undefined);
  const labelOf = (v) => opts.find(([x]) => String(x) === String(v))?.[1] ?? "";
  const hidden = freeText ? null : h("input", { type: "hidden", name, value: value ?? "" });
  const input = h("input", {
    type: "text", id, name: freeText ? name : null, value: freeText ? (value ?? "") : labelOf(value), placeholder: placeholder || emptyLabel,
    autocomplete: "off", maxlength: 300, role: "combobox", "aria-autocomplete": "list", "aria-expanded": "false",
  });
  const list = h("div", { class: "combo-list", role: "listbox", hidden: true });
  const toggle = h("button", { class: "combo-btn", type: "button", tabindex: "-1", "aria-label": "Mostra l'elenco" }, icon("down"));
  const wrap = h("div", { class: "combo" }, input, toggle, list, hidden);
  let active = -1, shown = [];

  const exact = (text) => opts.find((o) => o.slice(1).some((k) => norm(k) === norm(text)));
  const setValue = (v, l) => {
    input.value = l;
    if (hidden && hidden.value !== String(v ?? "")) {
      hidden.value = v ?? "";
      hidden.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (freeText) input.dispatchEvent(new Event("change", { bubbles: true }));
    close();
  };
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
  function draw(all = false) {
    const q = all ? "" : norm(input.value);
    shown = opts.filter((o) => !q || o.slice(1).some((k) => norm(k).includes(q))).slice(0, 80).map((o) => ({ o }));
    const text = input.value.trim();
    if (create && text && !exact(text)) shown.push({ create: text });
    clear(list, shown.length ? shown.map((s, i) => h("div", {
      class: `combo-opt${s.create ? " create" : ""}${i === active ? " on" : ""}`, role: "option",
      onmousedown: (e) => { e.preventDefault(); pick(i); },
    }, s.create ? [icon("plus"), `${createLabel} «${s.create}»`] : s.o[1])) : h("div", { class: "combo-empty" }, "Nessuna voce"));
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }
  async function pick(i) {
    const s = shown[i];
    if (!s) return;
    if (s.o) return setValue(s.o[0], s.o[1]);
    await add(s.create);
  }
  async function add(text) {
    try {
      const made = await create(text, wrap);
      if (!made) return;
      opts = [...opts, made];
      setValue(made[0], made[1]);
    } catch (err) { showError(err); }
  }
  input.addEventListener("input", () => { active = -1; draw(); if (hidden && !input.value.trim()) setValue("", ""); });
  input.addEventListener("focus", () => draw(true));
  input.addEventListener("blur", () => setTimeout(() => {
    close();
    const m = exact(input.value);
    if (m) setValue(m[0], m[1]);
  }, 120));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (list.hidden) draw(true);
      active = Math.max(0, Math.min(shown.length - 1, active + (e.key === "ArrowDown" ? 1 : -1)));
      [...list.children].forEach((el, i) => el.classList.toggle("on", i === active));
      list.children[active]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && !list.hidden && (active >= 0 || shown.length === 1)) {
      e.preventDefault();
      pick(active >= 0 ? active : 0);
    } else if (e.key === "Escape" && !list.hidden) {
      e.stopPropagation();
      close();
    }
  });
  toggle.addEventListener("click", () => { if (list.hidden) { input.focus(); draw(true); } else close(); });
  /** Prima di salvare: il testo scritto senza sceglierlo dall'elenco diventa una voce nuova. */
  wrap.resolve = async () => {
    const text = input.value.trim();
    if (freeText || !text) return;
    const m = exact(text);
    if (m) { setValue(m[0], m[1]); return; }
    if (create && await confirmDialog(`«${text}» non è nell'elenco: aggiungerlo?`, { confirm: createLabel, danger: false })) await add(text);
  };
  return wrap;
}
export async function resolveCombos(form) {
  for (const c of form.querySelectorAll(".combo")) if (c.resolve) await c.resolve();
}
export const loadCompanies = cached("companies", "/api/companies");

// ------------------------------------------------------------------ vista a lista o a schede
const VIEW_KEY = (k) => `plancia-view-${k}`;
/** Vista scelta per una sezione ("lista" o "schede"), ricordata su questo PC. */
export function viewMode(key, fallback = "lista") {
  try { return localStorage.getItem(VIEW_KEY(key)) || fallback; } catch { return fallback; }
}
export function viewToggle(key, value, onchange) {
  const set = (v) => { try { localStorage.setItem(VIEW_KEY(key), v); } catch { /* */ } onchange(v); };
  const wrap = h("div", { class: "segmented view-toggle", role: "group", "aria-label": "Vista" });
  for (const [v, ic, l] of [["lista", "list", "Lista"], ["schede", "cards", "Schede"]]) {
    wrap.append(h("button", { type: "button", class: v === value ? "on" : "", "aria-pressed": String(v === value), title: `Vista a ${l.toLowerCase()}`, onclick: () => set(v) }, icon(ic), l));
  }
  return wrap;
}
/** Elenco di righe (li.item) mostrato come lista o come griglia di schede. */
export function listOrCards(mode, cls = "list card") {
  return mode === "schede" ? "list as-cards" : cls;
}

// ------------------------------------------------------------------ tabella ordinabile
/**
 * columns: [{ key, label, value(item) → valore per l'ordinamento, cell(item) → contenuto, cls, sortable }]
 * sort: { key, dir } (dir 1 = crescente, -1 = decrescente); onSort(nuovoSort).
 */
export function sortItems(items, columns, sort) {
  const col = columns.find((c) => c.key === sort.key) || columns[0];
  const val = col.value || ((x) => x[col.key]);
  const coll = new Intl.Collator("it", { sensitivity: "base", numeric: true });
  return [...items].sort((a, b) => {
    const x = val(a), y = val(b);
    const ex = x === null || x === undefined || x === "", ey = y === null || y === undefined || y === "";
    if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1; // i vuoti sempre in fondo
    const r = typeof x === "number" && typeof y === "number" ? x - y : coll.compare(String(x), String(y));
    return r * sort.dir;
  });
}
export function sortableTable({ columns, items, sort, onSort, onRow }) {
  const head = columns.map((c) => {
    if (c.sortable === false) return h("th", { class: c.cls || "" }, c.label);
    const on = sort.key === c.key;
    return h("th", { class: `${c.cls || ""} sortable${on ? " on" : ""}`, "aria-sort": on ? (sort.dir > 0 ? "ascending" : "descending") : "none" },
      h("button", { type: "button", class: "th-sort", onclick: () => onSort({ key: c.key, dir: on ? -sort.dir : 1 }) },
        c.label, h("span", { class: "arrow", "aria-hidden": "true" }, on ? (sort.dir > 0 ? "▲" : "▼") : "↕")));
  });
  return h("table", { class: "t" },
    h("thead", {}, h("tr", {}, head)),
    h("tbody", {}, sortItems(items, columns, sort).map((it) => h("tr", { style: onRow ? { cursor: "pointer" } : null, onclick: onRow ? () => onRow(it) : null },
      columns.map((c) => h("td", { class: c.cls || "" }, c.cell ? c.cell(it) : it[c.key] ?? ""))))));
}
