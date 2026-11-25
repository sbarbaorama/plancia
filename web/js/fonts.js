// Carattere dei documenti: tipo e dimensione del testo per Verbali, Consulenze e Procedure.
// La scelta resta su questo PC (ognuno può avere la sua) e vale anche per la stampa.
import { h } from "./ui.js";

export const FONT_AREAS = [["verbali", "Verbali"], ["consulenze", "Consulenze"], ["procedure", "Procedure"]];
export const FONTS = [
  ["figtree", "Figtree (predefinito)", "\"Figtree\", \"Segoe UI\", system-ui, sans-serif"],
  ["sistema", "Segoe UI (Windows)", "\"Segoe UI\", system-ui, sans-serif"],
  ["calibri", "Calibri", "Calibri, Carlito, \"Segoe UI\", sans-serif"],
  ["arial", "Arial", "Arial, Helvetica, sans-serif"],
  ["verdana", "Verdana (molto leggibile)", "Verdana, Geneva, sans-serif"],
  ["georgia", "Georgia (con grazie)", "Georgia, \"Times New Roman\", serif"],
  ["times", "Times New Roman", "\"Times New Roman\", Times, serif"],
  ["mono", "IBM Plex Mono (monospazio)", "\"IBM Plex Mono\", Consolas, monospace"],
];
const DEFAULT = { family: "figtree", size: 14 };
const MIN = 11, MAX = 24;
const key = (area) => `plancia-font-${area}`;

export function getFont(area) {
  try {
    const v = JSON.parse(localStorage.getItem(key(area)) || "null");
    if (v && FONTS.some(([k]) => k === v.family) && v.size >= MIN && v.size <= MAX) return v;
  } catch { /* */ }
  return { ...DEFAULT };
}
function setFont(area, v) {
  try { localStorage.setItem(key(area), JSON.stringify(v)); } catch { /* */ }
  window.dispatchEvent(new CustomEvent("plancia:font", { detail: { area } }));
}
export const fontStack = (family) => (FONTS.find(([k]) => k === family) || FONTS[0])[2];

/** Applica il carattere scelto a un contenitore (i campi di testo al suo interno lo ereditano). */
export function applyFont(el, area) {
  const put = () => {
    const f = getFont(area);
    el.classList.add("doc-font");
    el.style.setProperty("--doc-font", fontStack(f.family));
    el.style.setProperty("--doc-size", `${f.size}px`);
  };
  put();
  const on = (e) => { if (!el.isConnected) window.removeEventListener("plancia:font", on); else if (e.detail.area === area) put(); };
  window.addEventListener("plancia:font", on);
  return el;
}

/** Stile per la stampa (dimensione in punti). */
export function printFontStyle(area) {
  const f = getFont(area);
  return { fontFamily: fontStack(f.family), fontSize: `${Math.round(f.size * 0.75 * 10) / 10}pt` };
}

/** Controlli «tipo e dimensione» (usati nel pulsante Aa e in Impostazioni). */
export function fontControls(area) {
  const f = getFont(area);
  const sel = h("select", { "aria-label": "Tipo di carattere", onchange: () => { f.family = sel.value; setFont(area, f); } },
    FONTS.map(([k, l]) => h("option", { value: k, selected: k === f.family, style: { fontFamily: fontStack(k) } }, l)));
  const size = h("span", { class: "font-size mono" }, `${f.size}`);
  const step = (d) => { f.size = Math.max(MIN, Math.min(MAX, f.size + d)); size.textContent = `${f.size}`; setFont(area, f); };
  return h("div", { class: "font-controls" }, sel,
    h("div", { class: "font-step", role: "group", "aria-label": "Dimensione" },
      h("button", { class: "btn btn-sm", type: "button", "aria-label": "Più piccolo", onclick: () => step(-1) }, "A−"), size,
      h("button", { class: "btn btn-sm", type: "button", "aria-label": "Più grande", onclick: () => step(1) }, "A+")),
    h("button", { class: "btn btn-sm btn-ghost", type: "button", onclick: () => { Object.assign(f, DEFAULT); sel.value = f.family; size.textContent = `${f.size}`; setFont(area, f); } }, "Ripristina"));
}

/** Pulsante «Aa» con un piccolo pannello per cambiare il carattere di quell'area. */
export function fontButton(area) {
  const label = FONT_AREAS.find(([k]) => k === area)?.[1] || "";
  const pop = h("div", { class: "font-pop", hidden: true }, h("div", { class: "small muted" }, `Carattere dei testi: ${label}`), fontControls(area));
  const btn = h("button", { class: "btn", type: "button", title: "Tipo e dimensione del carattere", "aria-expanded": "false",
    onclick: (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; btn.setAttribute("aria-expanded", String(!pop.hidden)); } }, h("span", { style: { fontWeight: 700 } }, "Aa"));
  const wrap = h("span", { class: "font-btn" }, btn, pop);
  document.addEventListener("mousedown", (e) => { if (!wrap.contains(e.target)) { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); } });
  return wrap;
}
