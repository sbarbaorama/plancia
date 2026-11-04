// Avvio di Plancia: cornice, navigazione, router, timer, notifiche, palette comandi, login (team).
import { ApiError, get, post, setHandlers } from "./api.js";
import { emit, newMenu, openTaskEditor, stopTimer } from "./editors.js";
import { openImportPanel, initDropImport } from "./importa.js";
import { openPalette } from "./palette.js";
import {
  clear, closePanel, debounce, fmtMin, h, icon, initials, isAdmin, isTeam, loadSchema, me, panelOpen, showError, store, toast,
} from "./ui.js";

export const NAV = [
  { title: "Pianifica", items: [["oggi", "Oggi"], ["pianifica", "Pianifica"], ["calendario", "Calendario"], ["timeline", "Timeline"]] },
  { title: "Lavoro", items: [["task", "Task"], ["progetti", "Progetti"], ["riunioni", "Riunioni"], ["consulenze", "Consulenze"], ["note", "Note"], ["inbox", "Inbox"]] },
  { title: "Operazioni", items: [["modifiche", "Modifiche"], ["scadenze", "Scadenze"], ["attese", "In attesa di"], ["checklist", "Checklist"]] },
  { title: "Clienti", items: [["clienti", "Clienti"], ["contatti", "Contatti"]] },
  { title: "Resoconti", items: [["ore", "Ore"], ["riepilogo", "Riepilogo"], ["archivio", "Archivio"]] },
];
export const SECTIONS = Object.fromEntries(NAV.flatMap((g) => g.items));
SECTIONS.impostazioni = "Impostazioni";
SECTIONS.cerca = "Cerca";
const VIEW_FILE = { ...Object.fromEntries(Object.keys(SECTIONS).map((k) => [k, k])) };

// ------------------------------------------------------------------ cornice
function shell() {
  const navList = h("nav", { class: "nav", "aria-label": "Sezioni", id: "nav" });
  for (const g of NAV) {
    navList.append(h("div", { class: "nav-group" }, g.title));
    for (const [key, text] of g.items) {
      navList.append(h("a", { href: `#/${key}`, dataset: { section: key }, title: text },
        icon(key), h("span", { class: "label" }, text), h("span", { class: "count", id: `count-${key}` })));
    }
  }
  const user = me();
  const side = h("aside", { class: "side" },
    h("a", { class: "brand", href: "#/oggi" }, h("span", { class: "brand-mark", html: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 19V5h6a5 5 0 0 1 0 10H9"/></svg>' }), h("span", {}, "Plancia")),
    navList,
    h("div", { class: "side-foot" },
      h("nav", { class: "nav" }, h("a", { href: "#/impostazioni", dataset: { section: "impostazioni" }, title: "Impostazioni" }, icon("impostazioni"), h("span", { class: "label" }, "Impostazioni"))),
      isTeam() ? h("div", { class: "user" }, h("span", { class: "avatar", style: { background: user.color } }, initials(user.name)),
        h("span", { class: "txt" }, user.name), h("span", { class: "spacer" }),
        h("button", { class: "icon-btn", type: "button", title: "Esci", "aria-label": "Esci", style: { color: "var(--side-muted)" }, onclick: logout }, icon("logout"))) : null,
      h("button", { class: "side-collapse", type: "button", onclick: toggleRail }, h("span", { class: "row", style: { gap: "8px" } }, icon("collapse"), h("span", { class: "txt" }, "Riduci menu")))));
  const timer = h("div", { id: "timer-slot" });
  const note = h("form", { class: "quick-note", onsubmit: quickNote }, h("input", { id: "quick-note", type: "text", placeholder: "Nota veloce nell'Inbox… (Invio)", "aria-label": "Nota veloce", maxlength: 5000, autocomplete: "off" }));
  const top = h("header", { class: "topbar" },
    h("button", { class: "cmd-btn", type: "button", onclick: () => openPalette() }, icon("search"), h("span", { class: "grow" }, "Cerca o esegui un comando…"), h("kbd", {}, "Ctrl K")),
    note, h("span", { class: "spacer" }), timer,
    h("button", { class: "btn", type: "button", onclick: () => openImportPanel(), title: "Importa una mail o un invito di Outlook" }, icon("upload"), h("span", { class: "label" }, "Importa")),
    h("button", { class: "btn btn-primary", type: "button", onclick: (e) => newMenu(e.currentTarget) }, icon("plus"), "Nuovo"));
  const mobile = h("nav", { class: "mobile-nav", "aria-label": "Sezioni principali" },
    ["oggi", "pianifica", "task", "calendario", "clienti"].map((k) => h("a", { href: `#/${k}`, dataset: { section: k }, "aria-label": SECTIONS[k] }, icon(k))));
  const app = h("div", { class: `app${document.documentElement.dataset.rail === "1" ? " rail" : ""}`, id: "app" },
    side, h("div", { class: "main" }, top, h("main", { id: "view", class: "view", tabindex: "-1" })), mobile);
  const panel = [
    h("div", { class: "panel-backdrop", id: "panel-backdrop", hidden: true, onclick: () => closePanel() }),
    h("aside", { class: "panel", id: "panel", "aria-hidden": "true", role: "dialog", "aria-labelledby": "panel-title" },
      h("div", { class: "panel-head" }, h("h2", { id: "panel-title" }), h("button", { class: "icon-btn", type: "button", "aria-label": "Chiudi", onclick: () => closePanel() }, icon("x"))),
      h("div", { class: "panel-body", id: "panel-body" })),
  ];
  clear(document.getElementById("root"), app, panel);
}

function toggleRail() {
  const app = document.getElementById("app");
  app.classList.toggle("rail");
  try { localStorage.setItem("plancia-rail", app.classList.contains("rail") ? "1" : "0"); } catch { /* */ }
}

async function quickNote(e) {
  e.preventDefault();
  const input = document.getElementById("quick-note");
  const text = input.value.trim();
  if (!text) return;
  try {
    await post("/api/inbox_items", { text });
    input.value = "";
    toast("Nota salvata nell'Inbox", "ok");
    emit("changed");
  } catch (err) { showError(err); }
}

// ------------------------------------------------------------------ router
let leaveGuard = null;
export function setLeaveGuard(fn) { leaveGuard = fn; }
const guarded = () => !!(leaveGuard && leaveGuard());
let current = "";
let token = 0;

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "") || "oggi";
  const [path, query = ""] = raw.split("?");
  const [section, ...rest] = path.split("/").filter(Boolean);
  return { section: SECTIONS[section] ? section : "oggi", id: rest[0] || null, sub: rest[1] || null, query: Object.fromEntries(new URLSearchParams(query)) };
}

async function route() {
  if (guarded() && location.hash !== current && !window.confirm("Ci sono modifiche non salvate. Uscire comunque?")) {
    history.replaceState(null, "", current);
    return;
  }
  leaveGuard = null;
  // lo schermo intero del verbale vale solo per quella pagina
  document.getElementById("app")?.classList.remove("focus");
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  current = location.hash;
  closePanel(true);
  const r = parseHash();
  document.querySelectorAll("[data-section]").forEach((a) => a.classList.toggle("active", a.dataset.section === r.section));
  document.title = `${SECTIONS[r.section]} · Plancia`;
  await render(r, false);
  document.getElementById("view").focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

async function render(r, keepScroll) {
  const root = document.getElementById("view");
  const my = ++token;
  const y = window.scrollY;
  try {
    const mod = await import(`./views/${VIEW_FILE[r.section]}.js`);
    if (my !== token) return;
    if (!keepScroll) clear(root);
    await mod.render(root, { ...r, isCurrent: () => my === token, refresh: keepScroll });
    if (keepScroll) window.scrollTo(0, y);
  } catch (err) {
    if (my !== token) return;
    if (err instanceof ApiError && err.status === 401) return;
    clear(root, h("div", { class: "banner danger" }, err.message || String(err)));
    showError(err);
  }
}

/** Ridisegna la vista corrente (dopo un salvataggio), senza perdere testo non salvato. */
export function refresh() {
  if (guarded() || panelOpen()) return;
  render(parseHash(), true);
}

// ------------------------------------------------------------------ contatori, timer, notifiche
const refreshCounts = debounce(async () => {
  try {
    const d = await get("/api/dashboard");
    const set = (k, n, warn = false) => {
      const el = document.getElementById(`count-${k}`);
      if (el) { el.textContent = n ? String(n) : ""; el.classList.toggle("warn", warn && n > 0); }
    };
    set("oggi", d.overdue.length, true);
    set("inbox", d.inbox_count);
    set("scadenze", d.deadlines_due.length, true);
    set("attese", d.waiting_followup.length, true);
    set("pianifica", d.plan.filter((t) => t.status !== "chiuso").length);
    renderTimer(d.timer);
    if (d.backup_stale || d.last_backup_error) document.getElementById("count-oggi")?.classList.add("warn");
  } catch { /* contatori non essenziali */ }
}, 300);

let timerTick = null;
function renderTimer(t) {
  const slot = document.getElementById("timer-slot");
  if (!slot) return;
  clearInterval(timerTick);
  if (!t) { clear(slot); return; }
  const time = h("span", { class: "t" });
  const tick = () => {
    const [d, hm] = t.started_at.split("T");
    const start = new Date(`${d}T${hm}:00`);
    const min = Math.max(0, Math.floor((Date.now() - start.getTime()) / 60000));
    time.textContent = fmtMin(min);
  };
  tick();
  timerTick = setInterval(tick, 30000);
  clear(slot, h("div", { class: "timer-chip", title: "Timer in corso" }, h("span", { class: "timer-dot" }), time,
    h("span", { class: "what" }, t.task_title || t.note || "Senza task"),
    h("button", { class: "icon-btn", type: "button", "aria-label": "Ferma il timer", title: "Ferma", onclick: stopTimer }, icon("stop"))));
}

const seen = new Set(JSON.parse(sessionStorage.getItem("plancia-seen") || "[]"));
async function checkReminders() {
  if (!store.settings?.notifications || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const items = await get("/api/reminders");
    let fresh = 0;
    for (const r of items) {
      const key = `plancia-n-${r.key}`;
      if (seen.has(key) || localStorage.getItem(key)) continue;
      seen.add(key);
      localStorage.setItem(key, "1");
      if (fresh++ > 4) continue;
      const n = new Notification(r.title, { body: r.body, icon: "/icons/icon-192.png", tag: r.key });
      n.onclick = () => { window.focus(); location.hash = r.href; };
    }
    sessionStorage.setItem("plancia-seen", JSON.stringify([...seen]));
  } catch { /* */ }
}

// ------------------------------------------------------------------ tema, login, avvio
export function applyTheme(settings) {
  const root = document.documentElement;
  const t = settings.theme;
  if (t === "chiaro") root.dataset.theme = "light"; else if (t === "scuro") root.dataset.theme = "dark"; else delete root.dataset.theme;
  root.dataset.density = settings.density || "comoda";
  try { localStorage.setItem("plancia-theme", t); localStorage.setItem("plancia-density", root.dataset.density); } catch { /* */ }
}

async function logout() {
  await post("/api/auth/logout").catch(() => {});
  location.reload();
}

function loginScreen(session) {
  const setup = session.needs_setup;
  const err = h("div", { class: "banner danger", hidden: true });
  const fields = setup
    ? [["name", "Il tuo nome", "text"], ["username", "Nome utente", "text"], ["password", "Password (almeno 10 caratteri)", "password"]]
    : [["username", "Nome utente", "text"], ["password", "Password", "password"]];
  const form = h("form", { class: "form" }, fields.map(([n, l, t]) => h("label", { class: "field" }, l,
    h("input", { name: n, type: t, required: true, autocomplete: n === "password" ? (setup ? "new-password" : "current-password") : "username" }))),
    h("button", { class: "btn btn-primary", type: "submit" }, setup ? "Crea l'amministratore" : "Entra"));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      await post(setup ? "/api/auth/setup" : "/api/auth/login", data);
      location.reload();
    } catch (ex) { err.hidden = false; err.textContent = ex.message; }
  });
  clear(document.getElementById("root"), h("div", { class: "login" }, h("div", { class: "card" },
    h("span", { class: "brand-mark", html: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 19V5h6a5 5 0 0 1 0 10H9"/></svg>' }),
    h("h1", {}, "Plancia"),
    h("p", { class: "muted" }, setup ? "Primo avvio della modalità team: crea l'account amministratore. I dati già presenti diventano suoi." : "Accedi con il tuo account."),
    setup && !session.can_setup ? h("div", { class: "banner warn" }, "Il primo amministratore si crea dal PC dove gira il server (http://127.0.0.1).") : null,
    err, form)));
}

function serverDown() {
  if (document.getElementById("server-wait")) return;
  const box = h("div", { id: "server-wait", class: "palette-wrap", style: { alignItems: "center", paddingTop: 0 } },
    h("div", { class: "card card-pad", style: { maxWidth: "420px" } }, h("h2", {}, "Il server non risponde"),
      h("p", { class: "muted" }, "Plancia si collega al suo server. Subito dopo l'accensione del PC può servire un minuto. Riprovo da solo…")));
  document.body.append(box);
  const poll = setInterval(async () => {
    try {
      const r = await fetch("/api/session", { cache: "no-store" });
      if (r.ok) { clearInterval(poll); box.remove(); refresh(); refreshCounts(); }
    } catch { /* ancora giù */ }
  }, 3000);
}

async function init() {
  setHandlers({ unauthorized: () => { if (isTeam()) location.reload(); }, unreachable: serverDown });
  let session;
  try { session = await get("/api/session"); } catch { serverDown(); return; }
  store.session = session;
  if (session.mode === "team" && !session.user) { loginScreen(session); return; }
  await loadSchema();
  store.settings = await get("/api/settings");
  applyTheme(store.settings);
  shell();
  initDropImport();
  window.addEventListener("hashchange", route);
  window.addEventListener("plancia:changed", () => { refresh(); refreshCounts(); });
  window.addEventListener("plancia:timer", refreshCounts);
  window.addEventListener("beforeunload", (e) => { if (guarded()) { e.preventDefault(); e.returnValue = ""; } });
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
    if (e.key === "Escape" && panelOpen()) { closePanel(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector("dialog[open], .palette-wrap")) return;
    if (e.key === "n") { e.preventDefault(); openTaskEditor(null); }
    if (e.key === "/") { e.preventDefault(); openPalette(); }
  });
  route();
  refreshCounts();
  setInterval(refreshCounts, 120000);
  setInterval(checkReminders, 300000);
  setTimeout(checkReminders, 5000);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  void isAdmin;
}

init();
