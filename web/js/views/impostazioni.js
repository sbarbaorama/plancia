// Impostazioni: aspetto, giornata, notifiche, backup, dati, import da Activity Desk, team.
import { del, get, post, put } from "../api.js";
import { BASE_THEMES, THEMES, applyTheme, previewTheme } from "../app.js";
import { openEditor } from "../form.js";
import {
  avatar, badge, card, clear, closePanel, combo, confirmDialog, fmtDate, h, icon, invalidate, isAdmin, isTeam, label, loadUsers, me,
  onSubmitOnce, openPanel, pageHead, select, showError, store, toast,
} from "../ui.js";

export async function render(root, ctx) {
  const s = await get("/api/settings");
  store.settings = s;
  if (!ctx.isCurrent()) return;
  const reload = () => render(root, ctx);
  const save = async (data, msg = "Impostazioni salvate") => {
    try { store.settings = await put("/api/settings", data); applyTheme(store.settings); toast(msg, "ok"); } catch (err) { showError(err); }
  };
  const admin = isAdmin();

  // tema: passando col mouse (o con Tab) si vede l'anteprima, il clic lo sceglie
  const restore = () => applyTheme(store.settings, false);
  const themeBtn = ([v, l, , sw]) => h("button", {
    type: "button", class: `theme-opt${v === s.theme ? " on" : ""}`, "aria-pressed": String(v === s.theme),
    onmouseenter: () => previewTheme(v), onfocus: () => previewTheme(v), onmouseleave: restore, onblur: restore,
    onclick: () => save({ theme: v }, `Tema: ${l}`).then(reload),
  }, h("span", { class: "theme-sw", style: { "--a": sw[0], "--b": sw[1], "--c": sw[2] } }), h("span", {}, l));
  const look = card("Aspetto", h("div", { class: "card-body form" },
    h("div", { class: "field" }, h("span", {}, "Tema ", h("span", { class: "hint" }, "— passa sopra un tema per vederlo, fai clic per sceglierlo")),
      ["Base", "Tenui", "Decisi"].map((g) => h("div", { class: "theme-group" }, h("div", { class: "small muted" }, g),
        h("div", { class: "theme-grid" }, [...BASE_THEMES, ...THEMES].filter((t) => t[2] === g).map(themeBtn))))),
    h("p", { class: "hint" }, "I temi tenui hanno anche una versione scura, usata quando Windows è in modalità scura."),
    h("div", { class: "form-row" },
      h("label", { class: "field" }, "Densità degli elenchi", select("density", [["comoda", "Comoda"], ["compatta", "Compatta"]], s.density, { onchange: (e) => save({ density: e.target.value }) })))));

  const dayForm = h("form", { class: "card-body form" },
    h("div", { class: "form-row" },
      h("label", { class: "field" }, "Ore disponibili al giorno", h("input", { name: "work_hours", type: "number", step: "0.5", min: "0.5", max: "16", value: s.work_hours })),
      h("label", { class: "field" }, "Inizio giornata", h("input", { name: "day_start", type: "time", value: s.day_start })),
      h("label", { class: "field" }, "Fine giornata", h("input", { name: "day_end", type: "time", value: s.day_end }))),
    h("p", { class: "hint" }, "Servono alla pagina Pianifica: la capacità del giorno è data da queste ore meno le riunioni."),
    h("div", {}, h("button", { class: "btn btn-primary", type: "submit" }, "Salva")));
  dayForm.addEventListener("submit", (e) => { e.preventDefault(); save(Object.fromEntries(new FormData(dayForm))); });

  const notif = card("Notifiche del browser", h("div", { class: "card-body stack" },
    h("label", { class: "check" }, h("input", { type: "checkbox", checked: !!s.notifications, onchange: (e) => save({ notifications: e.target.checked ? 1 : 0 }) }),
      "Avvisami di solleciti, scadenze in preavviso, task in ritardo e appuntamenti tra 15 minuti"),
    h("div", { class: "row" },
      h("span", { class: "small muted" }, "Permesso del browser: ", h("b", {}, "Notification" in window ? ({ granted: "concesso", denied: "negato", default: "da chiedere" }[Notification.permission]) : "non supportato")),
      "Notification" in window && Notification.permission !== "granted" ? h("button", { class: "btn btn-sm", type: "button", onclick: async () => {
        const p = await Notification.requestPermission(); toast(p === "granted" ? "Notifiche attive" : "Permesso non concesso", p === "granted" ? "ok" : "warn"); reload();
      } }, "Attiva nel browser") : null),
    h("p", { class: "hint" }, "Le notifiche arrivano mentre Plancia è aperta (anche ridotta a icona).")));

  const backupForm = h("form", { class: "card-body form" },
    h("label", { class: "field" }, "Cartella dei backup", h("input", { name: "backup_dir", value: s.backup_dir, placeholder: s.backup_dir_effective }),
      h("span", { class: "hint" }, "Consiglio: una cartella dentro OneDrive, così ogni backup va anche online. Ora: ", h("span", { class: "mono" }, s.backup_dir_effective))),
    h("label", { class: "field", style: { maxWidth: "220px" } }, "Giorni da conservare", h("input", { name: "retention_days", type: "number", min: 1, max: 3650, value: s.retention_days })),
    h("div", { class: "row" },
      h("button", { class: "btn btn-primary", type: "submit" }, "Salva"),
      h("button", { class: "btn", type: "button", onclick: async () => {
        try { await post("/api/backup"); toast("Backup creato", "ok"); reload(); } catch (err) { showError(err); }
      } }, "Fai un backup adesso"),
      h("span", { class: "small muted" }, s.last_backup ? `Ultimo backup: ${fmtDate(s.last_backup, { year: true })}` : "Nessun backup ancora"),
      s.last_backup_error ? badge(`Errore: ${s.last_backup_error}`, "danger") : null));
  backupForm.addEventListener("submit", (e) => { e.preventDefault(); save(Object.fromEntries(new FormData(backupForm))); });

  const fileIn = h("input", { type: "file", accept: ".json", hidden: true, onchange: async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (!(await confirmDialog("Importare il file? SOSTITUISCE tutti i dati attuali.", { confirm: "Importa e sostituisci", detail: "Prima dell'import viene fatto un backup dei dati attuali." }))) return;
    try {
      const data = JSON.parse(await f.text());
      const r = await post("/api/import", data);
      toast(`Import completato: ${r.counts.tasks || 0} task, ${r.counts.customers || 0} clienti`, "ok", 5000);
      invalidate("customers", "projects", "contacts", "users");
    } catch (err) { showError(err); }
  } });
  const data = card("Dati", h("div", { class: "card-body stack" },
    h("p", { class: "muted" }, "L'export JSON contiene tutti i dati (non i file allegati, che restano nella cartella «data/allegati» e nella copia dei backup)."),
    h("div", { class: "row" },
      h("a", { class: "btn", href: "/api/export" }, icon("download"), "Esporta JSON"),
      h("button", { class: "btn", type: "button", onclick: () => fileIn.click() }, icon("upload"), "Importa JSON…"), fileIn)));

  const pathIn = h("input", { value: s.legacy_db_path || s.legacy_default, placeholder: "C:\\Users\\…\\activity_desk\\data\\activity_desk.db", class: "mono" });
  const legacy = card("Importa da Activity Desk", h("div", { class: "card-body stack" },
    h("p", {}, "Copia in Plancia tutti i dati della vecchia app (clienti, task, verbali, consulenze, modifiche, scadenze, attese, note, checklist, allegati). Il database di Activity Desk viene solo letto: la vecchia app resta com'è."),
    h("p", { class: "small muted" }, "Gli incidenti non vengono importati: i task collegati a un incidente prendono il suo cliente e ne riportano il titolo nelle note."),
    h("label", { class: "field" }, "Database di Activity Desk", pathIn),
    h("div", { class: "row" }, h("button", { class: "btn btn-primary", type: "button", onclick: async () => {
      let replace = false;
      if (s.has_data) {
        if (!(await confirmDialog("Plancia contiene già dei dati: l'import li SOSTITUISCE.", { confirm: "Sostituisci", detail: "Prima viene fatto un backup dei dati attuali." }))) return;
        replace = true;
      }
      try {
        const r = await post("/api/legacy/import", { path: pathIn.value.trim(), replace });
        const c = r.counts;
        toast(`Importati: ${c.tasks} task, ${c.customers} clienti, ${c.meetings} verbali, ${c.attachments} allegati`, "ok", 7000);
        invalidate("customers", "projects", "contacts");
        reload();
      } catch (err) { showError(err); }
    } }, "Importa"), s.has_data ? h("span", { class: "small muted" }, "Plancia contiene già dei dati") : null)));

  let team;
  if (isTeam()) {
    const users = await loadUsers(true);
    team = card("Team", h("div", { class: "card-body stack" },
      h("ul", { class: "list compact-list" }, users.map((u) => h("li", { class: "item" }, avatar(u.name, u.color),
        h("div", { class: "main-col" }, h("b", {}, u.name), h("div", { class: "meta" }, h("span", { class: "mono" }, u.username), badge(label(u.role), u.role === "admin" ? "info" : ""), !u.active ? badge("disattivato", "warn") : null)),
        admin || u.id === me().id ? h("button", { class: "btn btn-sm", type: "button", onclick: () => editUser(u, reload) }, "Modifica") : null))),
      admin ? h("div", {}, h("button", { class: "btn btn-primary", type: "button", onclick: () => newUser(reload) }, icon("plus"), "Aggiungi collega")) : null,
      h("p", { class: "hint" }, "Ogni elemento può essere «Team» (visibile a tutti) o «Privato» (solo tuo). I task si assegnano ai colleghi; ognuno vede il proprio piano e le proprie ore.")));
  } else {
    team = card("Condividere con i colleghi", h("div", { class: "card-body stack" },
      h("p", {}, "Plancia ora gira in ", h("b", {}, "modalità personale"), ": risponde solo a questo PC e non chiede l'accesso."),
      h("p", {}, "Per lavorare in team si avvia lo stesso programma in ", h("b", {}, "modalità team"), " su un PC o una VM sempre accesa raggiungibile dai colleghi: ognuno entra con il suo account, i task si assegnano, gli elementi sono «Team» o «Privati». Le istruzioni sono nel file ", h("span", { class: "mono" }, "docs/TEAM.md"), ".")));
  }

  clear(root,
    pageHead("Impostazioni", `Plancia ${store.session.version} · modalità ${store.session.mode}`),
    h("div", { class: "cols" },
      h("div", { class: "col-main" }, look, card("Giornata", dayForm), notif, await companiesCard(reload), admin ? card("Backup", backupForm) : null),
      h("div", { class: "col-side" }, team, admin ? data : null, admin ? legacy : null,
        card("Scorciatoie", h("div", { class: "card-body small stack", style: { gap: "6px" } },
          h("div", {}, h("kbd", {}, "Ctrl K"), " palette: cerca, vai a, crea («task @SIGLA titolo ven»)"),
          h("div", {}, h("kbd", {}, "N"), " nuovo task"), h("div", {}, h("kbd", {}, "/"), " cerca"),
          h("div", {}, h("kbd", {}, "Ctrl Invio"), " salva il modulo aperto"), h("div", {}, h("kbd", {}, "Ctrl S"), " salva il verbale"),
          h("div", {}, h("kbd", {}, "Esc"), " chiude il pannello"))))));
}

function newUser(reload) {
  openEditor("users", null, {
    title: "Nuovo collega", layout: [["name", "username"], ["role", "color"]], prefill: { role: "membro", color: "#2456d3" },
    extra: () => h("label", { class: "field" }, "Password iniziale (almeno 10 caratteri)", h("input", { name: "password", type: "password", autocomplete: "new-password", required: true })),
    transform: (d, form) => ({ password: form.elements.namedItem("password").value }),
    onSave: () => { invalidate("users"); reload(); }, deletable: false,
  });
}

function editUser(u, reload) {
  const self = u.id === me().id;
  openEditor("users", u, {
    title: self ? "Il mio account" : u.name,
    layout: isAdmin() ? [["name", "username"], ["role", "color"], ["active"]] : [["name", "color"]],
    extra: () => [
      self ? h("label", { class: "field" }, "Password attuale (solo per cambiarla)", h("input", { name: "current_password", type: "password", autocomplete: "current-password" })) : null,
      h("label", { class: "field" }, self ? "Nuova password" : "Nuova password (per reimpostarla)", h("input", { name: "password", type: "password", autocomplete: "new-password" }))],
    transform: (d, form) => {
      const out = {};
      const pw = form.elements.namedItem("password").value;
      if (pw) { out.password = pw; out.current_password = form.elements.namedItem("current_password")?.value || ""; }
      return out;
    },
    onSave: () => { invalidate("users"); reload(); }, deletable: false,
  });
}

// ------------------------------------------------------------------ aziende (menu a tendina dei contatti)
async function companiesCard(reload) {
  const items = await get("/api/companies").catch(() => []);
  const done = () => { invalidate("companies", "contacts"); reload(); };
  const rename = (c) => openEditor("companies", c, { title: "Rinomina azienda", deletable: false, onSave: done,
    extra: () => h("p", { class: "hint" }, c.contacts_count ? `Il nuovo nome passa anche ai ${c.contacts_count} contatti di questa azienda.` : "Nessun contatto usa questa azienda.") });
  const merge = (c) => {
    const target = combo({ name: "into_id", id: "merge-into", options: items.filter((x) => x.id !== c.id).map((x) => [x.id, x.name, x.name]), emptyLabel: "Scegli l'azienda che resta" });
    const form = h("form", { class: "form" },
      h("p", {}, `I contatti di «${c.name}» (${c.contacts_count}) passano all'azienda scelta; «${c.name}» viene tolta dall'elenco.`),
      h("div", { class: "field" }, h("label", { for: "merge-into" }, "Unisci in"), target),
      h("div", { class: "panel-foot" }, h("button", { class: "btn btn-primary", type: "submit" }, "Unisci"),
        h("button", { class: "btn", type: "button", onclick: () => closePanel() }, "Annulla")));
    onSubmitOnce(form, async () => {
      const into = form.elements.namedItem("into_id").value;
      if (!into) { toast("Scegli l'azienda in cui unire", "error"); return; }
      try { await post(`/api/companies/${c.id}/merge`, { into_id: Number(into) }); toast("Aziende unite", "ok"); closePanel(); done(); } catch (err) { showError(err); }
    });
    openPanel("Unisci aziende", form);
  };
  const remove = async (c) => {
    if (!(await confirmDialog(`Togliere «${c.name}» dall'elenco delle aziende?`, { confirm: "Togli" }))) return;
    try { await del(`/api/companies/${c.id}`); toast("Azienda tolta", "ok"); done(); } catch (err) { showError(err); }
  };
  return card("Aziende", h("div", { class: "card-body stack" },
    h("p", { class: "hint" }, "L'elenco del menu «Azienda» dei contatti. Rinominando un'azienda si aggiornano i suoi contatti; i doppioni (es. «Acme» e «Acme Srl») si uniscono."),
    items.length ? h("ul", { class: "list compact-list" }, items.map((c) => h("li", { class: "item" },
      h("span", { class: "main-col" }, h("b", {}, c.name), h("span", { class: "small muted" }, ` · ${c.contacts_count === 1 ? "1 contatto" : `${c.contacts_count} contatti`}`)),
      h("button", { class: "btn btn-sm", type: "button", onclick: () => rename(c) }, "Rinomina"),
      items.length > 1 ? h("button", { class: "btn btn-sm", type: "button", onclick: () => merge(c) }, "Unisci in…") : null,
      !c.contacts_count ? h("button", { class: "icon-btn", type: "button", "aria-label": `Togli ${c.name}`, onclick: () => remove(c) }, icon("trash")) : null)))
      : h("div", { class: "muted small" }, "Nessuna azienda. Si aggiungono dal campo «Azienda» dei contatti."),
    h("div", {}, h("button", { class: "btn btn-sm", type: "button", onclick: () => openEditor("companies", null, { title: "Nuova azienda", onSave: done }) }, icon("plus"), "Azienda"))));
}
