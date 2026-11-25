// Procedure: piccola documentazione (come si fa una cosa, come funziona uno script…) da cercare e copiare.
import { get, qs } from "../api.js";
import { attachmentsBox } from "../attachments.js";
import { openEditor } from "../form.js";
import { applyFont, fontButton, printFontStyle } from "../fonts.js";
import { plainText } from "../markdown.js";
import { isRich, renderRich, toPlain } from "../richtext.js";
import { imagesOf } from "../paste.js";
import {
  badge, clear, copyText, customerChip, customerFilter, fmtDate, h, icon, loadCustomers, pageHead, printDoc, viewMode, viewToggle,
} from "../ui.js";

const state = { q: "", category: "", customer_id: "", view: viewMode("procedure", "schede") };
const tagsOf = (p) => String(p.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
const textOf = (body) => (isRich(body) ? toPlain(body) : plainText(body));
const excerpt = (p) => textOf(p.body).split("\n").filter(Boolean).slice(0, 3).join(" · ").slice(0, 220);

const HELP = "Usa la barra sopra il testo: T titolo, t sottotitolo, { } blocco di codice (nella procedura avrà il pulsante Copia), `c` codice nel testo. "
  + "Le immagini si incollano con Ctrl+V.";

export function openProcedureEditor(p, { onSave, prefill = {} } = {}) {
  return openEditor("procedures", p, {
    prefill, wide: true, title: p?.id ? "Modifica procedura" : "Nuova procedura",
    onSave: (saved) => { if (onSave) onSave(saved); else if (saved) location.hash = `#/procedure/${saved.id}`; },
    extra: async (v, form) => {
      applyFont(form, "procedure");
      const cats = await get("/api/procedures").then((all) => [...new Set(all.map((x) => x.category).filter(Boolean))]).catch(() => []);
      form.elements.namedItem("category").setAttribute("list", "proc-cats");
      return [h("datalist", { id: "proc-cats" }, cats.map((c) => h("option", { value: c }))),
        h("div", { class: "row", style: { justifyContent: "space-between" } }, h("p", { class: "hint", style: { flex: 1 } }, HELP), fontButton("procedure"))];
    },
  });
}

export async function render(root, ctx) {
  if (ctx.id) return renderOne(root, ctx);
  const customers = await loadCustomers();
  const all = await get(`/api/procedures${qs({ q: state.q, customer_id: state.customer_id })}`);
  if (!ctx.isCurrent()) return;
  const reload = () => render(root, ctx);
  const cats = [...new Set(all.map((p) => p.category || "Senza categoria"))].sort((a, b) => a.localeCompare(b, "it"));
  const items = state.category ? all.filter((p) => (p.category || "Senza categoria") === state.category) : all;
  const open = (p) => { location.hash = `#/procedure/${p.id}`; };
  const copyBtn = (p) => h("button", { class: "btn btn-sm", type: "button", title: "Copia il testo della procedura",
    onclick: (e) => { e.stopPropagation(); copyText(textOf(p.body), e.currentTarget); } }, icon("copy"), "Copia");
  const meta = (p) => [p.pinned ? badge("in evidenza", "accent") : null, p.category ? badge(p.category, "violet") : null, customerChip(p),
    tagsOf(p).map((t) => h("span", { class: "tag" }, `#${t}`))];
  const card = (p) => h("article", { class: "card card-pad proc-card", onclick: () => open(p) },
    h("h3", {}, p.title), h("div", { class: "row small", style: { flexWrap: "wrap", gap: "4px 8px" } }, meta(p)),
    h("p", { class: "small muted proc-excerpt" }, excerpt(p) || "—"),
    h("div", { class: "row" }, h("span", { class: "small muted", style: { flex: 1 } }, `agg. ${fmtDate(p.updated_at)}`), copyBtn(p)));
  const row = (p) => h("li", { class: "item", onclick: () => open(p) },
    h("div", { class: "main-col" }, h("div", { class: "t-title" }, p.title), h("div", { class: "meta" }, meta(p), h("span", {}, excerpt(p).slice(0, 120)))),
    h("div", { class: "side-col" }, fmtDate(p.updated_at)), copyBtn(p));
  const groups = state.category ? [[state.category, items]] : cats.map((c) => [c, items.filter((p) => (p.category || "Senza categoria") === c)]);
  clear(root,
    pageHead("Procedure", "Piccola documentazione: come si fa una cosa, come funziona uno script, i comandi da ricordare. Cerca e copia al volo",
      h("button", { class: "btn btn-primary", type: "button", onclick: () => openProcedureEditor(null, { prefill: { category: state.category && state.category !== "Senza categoria" ? state.category : "", customer_id: state.customer_id || null } }) }, icon("plus"), "Nuova procedura")),
    h("div", { class: "filters" },
      h("input", { type: "search", placeholder: "Cerca nel titolo, nel testo, nelle etichette…", value: state.q, onchange: (e) => { state.q = e.target.value; reload(); } }),
      customerFilter(customers, state.customer_id, (e) => { state.customer_id = e.target.value; reload(); }),
      h("span", { class: "spacer" }), viewToggle("procedure", state.view, (v) => { state.view = v; reload(); })),
    cats.length > 1 ? h("div", { class: "chips-filter" },
      [["", `Tutte · ${all.length}`], ...cats.map((c) => [c, `${c} · ${all.filter((p) => (p.category || "Senza categoria") === c).length}`])].map(([v, l]) =>
        h("button", { type: "button", class: `chip-btn${state.category === v ? " on" : ""}`, onclick: () => { state.category = v; reload(); } }, l))) : null,
    !items.length ? h("div", { class: "card" }, h("div", { class: "empty" }, state.q ? "Nessuna procedura trovata." : "Nessuna procedura. Scrivi la prima: passi da seguire, comandi, come funziona uno script."))
      : groups.filter(([, l]) => l.length).map(([c, l]) => [h("div", { class: "group-title" }, `${c} · ${l.length}`),
        state.view === "lista" ? h("ul", { class: "list card" }, l.map(row)) : h("div", { class: "grid cards-grid" }, l.map(card))]));
}

async function renderOne(root, ctx) {
  const p = await get(`/api/procedures/${ctx.id}`);
  const images = p.attachments_count ? await imagesOf("procedures", p.id) : [];
  if (!ctx.isCurrent()) return;
  const reload = () => render(root, ctx);
  const body = applyFont(h("article", { class: "card card-pad doc-body proc-body" }, p.body ? renderRich(p.body, { images, markdown: true }) : h("p", { class: "muted" }, "Nessun testo.")), "procedure");
  clear(root,
    pageHead(p.title, { eyebrow: h("a", { href: "#/procedure" }, "← Procedure") },
      h("button", { class: "btn", type: "button", onclick: (e) => copyText(textOf(p.body), e.currentTarget) }, icon("copy"), "Copia tutto"),
      h("button", { class: "btn", type: "button", onclick: () => printDoc(h("div", { style: printFontStyle("procedure") }, h("h1", {}, p.title), h("div", { class: "doc-body" }, renderRich(p.body, { images, markdown: true })))) }, icon("print"), "Stampa / PDF"),
      fontButton("procedure"),
      h("button", { class: "btn btn-primary", type: "button", onclick: () => openProcedureEditor(p, { onSave: (x) => x ? reload() : (location.hash = "#/procedure") }) }, icon("edit"), "Modifica")),
    h("div", { class: "row small", style: { flexWrap: "wrap", gap: "6px 10px", marginBottom: "14px" } },
      p.pinned ? badge("in evidenza", "accent") : null, p.category ? badge(p.category, "violet") : null, customerChip(p),
      tagsOf(p).map((t) => h("a", { class: "tag", href: "#/procedure", onclick: () => { state.q = t; state.category = ""; } }, `#${t}`)),
      h("span", { class: "muted" }, `aggiornata il ${fmtDate(p.updated_at, { year: true })}`)),
    h("div", { class: "cols" },
      h("div", { class: "col-main" }, body),
      h("div", { class: "col-side" }, h("section", { class: "card card-pad" }, attachmentsBox("procedures", p.id)))));
}
