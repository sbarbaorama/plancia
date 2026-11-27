// Pagina Oggi personalizzabile: quali pannelli, dove (intera / larga / stretta) e quanto alti.
// La disposizione è di ogni utente e si salva sul server (/api/prefs/home).
import { del, get, put } from "./api.js";
import { card, clear, h, icon, showError, toast } from "./ui.js";

/** Catalogo dei pannelli: [id, titolo, descrizione]. */
export const PANELS = [
  ["kpis", "Numeri della giornata", "In ritardo, piano, solleciti, scadenze, ore"],
  ["plan", "Il piano di oggi", "I task pianificati per oggi"],
  ["late", "In ritardo e in scadenza oggi", "Si vede solo se c'è qualcosa"],
  ["week", "Scadono nei prossimi 7 giorni", "Si vede solo se c'è qualcosa"],
  ["progress", "In corso", "Task in corso non pianificati oggi"],
  ["agenda", "Agenda", "Appuntamenti e consulenze di oggi"],
  ["consultations", "Consulenze della settimana", "Le giornate con i consulenti da lunedì a domenica"],
  ["followup", "Da sollecitare", "Attese con il sollecito scaduto"],
  ["deadlines", "Scadenze in arrivo", "Certificati, licenze, contratti in preavviso"],
  ["changes", "Modifiche in programma", "Nei prossimi 7 giorni"],
  ["meetings", "Ultimi verbali", "I verbali attivi più recenti"],
  ["notes", "Post-it fissati", "I post-it fissati in alto"],
  ["procedures", "Procedure in evidenza", "Le procedure segnate «in evidenza» (o le ultime modificate)"],
  ["inbox", "Inbox da smistare", "Avviso quando ci sono note da smistare"],
  ["news", "Notizie", "Notizie sui tuoi interessi (servono internet e gli interessi)"],
  ["weather", "Meteo (riquadro grande)", "Previsione completa; c'è anche l'icona compatta accanto al titolo"],
];
export const panelTitle = (id) => PANELS.find(([k]) => k === id)?.[1] || id;
export const ZONES = [["top", "Intera"], ["main", "Larga"], ["side", "Stretta"]];
export const HEIGHTS = [["auto", "Automatica"], ["compatta", "Compatta"], ["alta", "Alta"]];

export const loadLayout = () => get("/api/prefs/home");
export async function saveLayout(layout) {
  try { return await put("/api/prefs/home", layout); } catch (err) { showError(err); return null; }
}
export async function resetLayout() {
  try { const l = await del("/api/prefs/home"); toast("Pagina Oggi riportata a quella predefinita", "ok"); return l; } catch (err) { showError(err); return null; }
}

/** Scheda «Pagina Oggi» in Impostazioni: scegli, ordina, allarga e alza i pannelli. */
export function homeSettingsCard() {
  const body = h("div", { class: "card-body stack" }, h("div", { class: "muted small" }, "Carico…"));
  let layout = null;
  const save = async (msg = "Pagina Oggi salvata") => { const l = await saveLayout(layout); if (l) { layout = l; toast(msg, "ok"); draw(); } };
  const draw = () => {
    const shown = new Map(layout.panels.map((p, i) => [p.id, i]));
    const move = (i, d) => { const j = i + d; if (j < 0 || j >= layout.panels.length) return; [layout.panels[i], layout.panels[j]] = [layout.panels[j], layout.panels[i]]; save("Ordine salvato"); };
    const sel = (opts, value, onchange, label) => h("select", { "aria-label": label, onchange: (e) => onchange(e.target.value) },
      opts.map(([v, l]) => h("option", { value: v, selected: v === value }, l)));
    clear(body,
      h("p", { class: "hint" }, "Scegli i pannelli da vedere nella pagina Oggi, dove metterli e quanto devono essere alti. ",
        "Puoi anche trascinarli direttamente nella pagina con «Personalizza»."),
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: layout.weatherChip, onchange: (e) => { layout.weatherChip = e.target.checked; save(); } }),
        "Meteo compatto (icona e temperatura) accanto a «Pianifica la giornata»"),
      h("ul", { class: "list home-pick" },
        // prima quelli visibili, nell'ordine della pagina; poi gli altri
        [...layout.panels.map((p) => PANELS.find(([k]) => k === p.id)), ...PANELS.filter(([k]) => !shown.has(k))].filter(Boolean).map(([id, title, desc]) => {
          const i = shown.get(id);
          const p = i !== undefined ? layout.panels[i] : null;
          return h("li", { class: `item${p ? "" : " off"}` },
            h("input", { type: "checkbox", checked: !!p, "aria-label": `Mostra ${title}`, onchange: (e) => {
              if (e.target.checked) layout.panels.push({ id, zone: ["kpis"].includes(id) ? "top" : ["plan", "late", "week", "progress", "news"].includes(id) ? "main" : "side", height: "auto" });
              else layout.panels = layout.panels.filter((x) => x.id !== id);
              save(e.target.checked ? `Aggiunto: ${title}` : `Tolto: ${title}`);
            } }),
            h("div", { class: "main-col" }, h("div", { class: "t-title" }, title), h("div", { class: "meta" }, desc)),
            p ? h("div", { class: "home-pick-ctl" },
              sel(ZONES, p.zone, (v) => { p.zone = v; save(); }, `Larghezza di ${title}`),
              sel(HEIGHTS, p.height, (v) => { p.height = v; save(); }, `Altezza di ${title}`),
              h("button", { class: "icon-btn", type: "button", "aria-label": `Sposta su ${title}`, title: "Sposta su", onclick: () => move(i, -1) }, "↑"),
              h("button", { class: "icon-btn", type: "button", "aria-label": `Sposta giù ${title}`, title: "Sposta giù", onclick: () => move(i, 1) }, "↓")) : null);
        })),
      h("div", { class: "row" },
        h("a", { class: "btn btn-sm", href: "#/oggi?personalizza=1" }, icon("edit"), "Personalizza nella pagina Oggi"),
        h("button", { class: "btn btn-sm btn-ghost", type: "button", onclick: async () => { const l = await resetLayout(); if (l) { layout = l; draw(); } } }, "Ripristina la predefinita")));
  };
  loadLayout().then((l) => { layout = l; draw(); }).catch(showError);
  return card("Pagina Oggi", body);
}
