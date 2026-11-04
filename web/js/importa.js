// Import da Outlook: testo incollato, file .eml e .ics → appuntamento, task, attesa o nota dell'Inbox.
import { post } from "./api.js";
import { emit, openEventEditor, openTaskEditor, openWaitingEditor } from "./editors.js";
import { clear, closePanel, fmtDateTime, h, openPanel, parseISO, showError, toast, toISO, todayISO, addDays } from "./ui.js";

const MAX_FILE = 5 * 1024 * 1024;
const MAX_NOTES = 4000;

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function notesFor(r) {
  const when = r.sent_at || r.start;
  const head = `Da Outlook: ${[r.subject || "(senza oggetto)", r.sender || r.sender_email, when ? fmtDateTime(when) : ""].filter(Boolean).join(" — ")}`;
  let body = r.body || "";
  if (body.length > MAX_NOTES) body = `${body.slice(0, MAX_NOTES)}…`;
  return body ? `${head}\n\n${body}` : head;
}
function endOrHourLater(r) {
  if (r.end) return r.end;
  if (!r.start) return undefined;
  const d = parseISO(r.start);
  d.setHours(d.getHours() + 1);
  return `${toISO(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const ACTIONS = [
  ["event", "Appuntamento", (r) => openEventEditor(null, { prefill: { title: r.subject, location: r.location || "", notes: notesFor(r), all_day: !!r.all_day,
    ...(r.start ? { start: r.start, end: endOrHourLater(r) } : {}) } })],
  ["task", "Task", (r) => openTaskEditor(null, { prefill: { title: r.subject, notes: notesFor(r) } })],
  ["waiting", "Attesa (risposta da ricevere)", (r) => openWaitingEditor(null, { prefill: { title: r.subject, who: r.sender || r.sender_email, notes: notesFor(r),
    requested_on: (r.sent_at || todayISO()).slice(0, 10), follow_up_on: addDays(todayISO(), 3) } })],
  ["inbox", "Nota nell'Inbox", async (r) => {
    await post("/api/inbox_items", { text: `${r.subject || "Da Outlook"}\n${notesFor(r)}` });
    toast("Salvata nell'Inbox", "ok");
    emit("changed");
  }],
];

function preview(r) {
  const def = r.kind === "event" ? "event" : "task";
  const body = h("div", { class: "form" },
    h("div", { class: "card card-pad stack" },
      h("b", {}, r.subject || "(senza oggetto)"),
      h("div", { class: "small muted" }, [r.sender && `Da: ${r.sender}${r.sender_email ? ` <${r.sender_email}>` : ""}`,
        r.sent_at && `Inviato: ${fmtDateTime(r.sent_at)}`, r.start && `Quando: ${fmtDateTime(r.start)}${r.end ? ` – ${fmtDateTime(r.end)}` : ""}`,
        r.location && `Dove: ${r.location}`].filter(Boolean).join(" · ")),
      r.body ? h("div", { class: "small", style: { whiteSpace: "pre-wrap", maxHeight: "180px", overflow: "auto" } }, r.body.slice(0, 1500)) : null,
      r.events_in_file > 1 ? h("div", { class: "banner warn" }, `Il file contiene ${r.events_in_file} appuntamenti: viene importato il primo.`) : null),
    h("p", { class: "small muted" }, "Cosa vuoi creare? Si apre l'editor già compilato: nulla viene salvato finché non confermi."),
    h("div", { class: "stack" }, ACTIONS.map(([key, text, fn]) => h("button", {
      class: `btn ${key === def ? "btn-primary" : ""}`, type: "button", style: { justifyContent: "flex-start" },
      onclick: async () => { closePanel(); try { await fn(r); } catch (err) { showError(err); } },
    }, text))));
  openPanel("Importa da Outlook", body);
}

async function analyze(payload) {
  try { preview(await post("/api/import/parse", payload)); } catch (err) { showError(err); }
}

export async function importFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext === "msg") { toast("I file .msg non sono supportati: in Outlook usa «Salva con nome» → .eml", "error", 6000); return; }
  if (!["eml", "ics"].includes(ext)) { toast("Trascina un file .eml (mail) o .ics (invito)", "error"); return; }
  if (file.size > MAX_FILE) { toast("Il file supera i 5 MB", "error"); return; }
  await analyze({ kind: ext, content_b64: toBase64(await file.arrayBuffer()) });
}

export function openImportPanel() {
  const area = h("textarea", { rows: 10, placeholder: "Incolla qui il testo di una mail o i dettagli di un appuntamento (Da, Inviato, Oggetto, Quando, Dove…)" });
  const file = h("input", { type: "file", accept: ".eml,.ics", hidden: true, onchange: (e) => e.target.files[0] && importFile(e.target.files[0]) });
  const form = h("form", { class: "form" },
    h("p", { class: "muted small" }, "Plancia non si collega alla posta: legge solo quello che le passi. Puoi anche trascinare un file .eml o .ics in qualsiasi punto della finestra."),
    area,
    h("div", { class: "panel-foot" },
      h("button", { class: "btn btn-primary", type: "submit" }, "Analizza"),
      h("button", { class: "btn", type: "button", onclick: () => file.click() }, "Scegli un file…"), file));
  form.addEventListener("submit", (e) => { e.preventDefault(); if (area.value.trim()) analyze({ kind: "text", content: area.value }); });
  openPanel("Importa da Outlook", form);
}

/** Trascinando un .eml/.ics fuori dai riquadri allegati si apre l'import. */
export function initDropImport() {
  window.addEventListener("dragover", (e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); });
  window.addEventListener("drop", (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    importFile(e.dataTransfer.files[0]);
  });
  void clear;
}
