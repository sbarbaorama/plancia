// Meteo e notizie nella pagina Oggi (i dati arrivano dal server di Plancia, che li prende da internet).
import { get, put } from "./api.js";
import { card, clear, h, icon, showError, store, tabs, toast } from "./ui.js";

const fmtT = (v) => (v === null || v === undefined ? "—" : `${Math.round(v)}°`);

function ago(iso) {
  if (!iso) return "";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(min)) return "";
  if (min < 60) return `${Math.max(1, min)} min fa`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h fa`;
  const d = Math.round(min / 1440);
  return d === 1 ? "ieri" : `${d} giorni fa`;
}

/** Riquadro del meteo: si riempie appena arrivano i dati (la pagina non aspetta internet). */
export function weatherCard() {
  const body = h("div", { class: "card-body weather" }, h("div", { class: "muted small" }, "Carico il meteo…"));
  const refresh = h("button", { class: "icon-btn", type: "button", title: "Aggiorna il meteo", "aria-label": "Aggiorna il meteo", onclick: () => load(true) }, icon("refresh"));
  const box = card("Meteo", body, { actions: refresh, cls: "weather-card" });
  async function load(force = false) {
    try {
      const w = await get(`/api/weather${force ? "?refresh=1" : ""}`);
      if (w.error) { clear(body, h("div", { class: "muted small" }, w.error)); return; }
      if (!w.place) {
        clear(body, h("div", { class: "small" }, "Scegli la tua città per vedere temperatura e previsione. ", h("a", { href: "#/impostazioni" }, "Impostazioni → Meteo e notizie")));
        return;
      }
      const c = w.current, t = w.today, tm = w.tomorrow;
      clear(body,
        h("div", { class: "w-now" },
          h("span", { class: "w-icon", title: c.text }, icon(c.icon)),
          h("div", {}, h("div", { class: "w-temp" }, fmtT(c.temp)), h("div", { class: "small muted" }, c.text, c.feels !== null ? ` · percepita ${fmtT(c.feels)}` : "")),
          h("div", { class: "w-place small" }, h("b", {}, w.place.name), h("div", { class: "muted" }, `agg. ${w.updated}`))),
        h("div", { class: "w-today" },
          h("b", {}, "Oggi: "), t.text ? `${t.text.toLowerCase()}, ` : "", `min ${fmtT(t.min)} · max ${fmtT(t.max)}`,
          t.rain !== null && t.rain !== undefined ? ` · pioggia ${t.rain}%` : "",
          c.wind !== null && c.wind !== undefined ? ` · vento ${Math.round(c.wind)} km/h` : ""),
        w.hours?.length ? h("div", { class: "w-hours" }, w.hours.map((x) => h("div", { class: "w-hour", title: x.text },
          h("span", { class: "small muted" }, x.time), icon(x.icon), h("b", {}, fmtT(x.temp)),
          x.rain ? h("span", { class: "small w-rain" }, `${x.rain}%`) : h("span", { class: "small muted" }, "")))) : null,
        tm?.date ? h("div", { class: "small muted" }, h("b", {}, "Domani: "), `${(tm.text || "").toLowerCase()} · min ${fmtT(tm.min)} · max ${fmtT(tm.max)}${tm.rain ? ` · pioggia ${tm.rain}%` : ""}`) : null);
    } catch (err) { clear(body, h("div", { class: "muted small" }, "Meteo non disponibile.")); showError(err); }
  }
  load();
  return box;
}

/** Riquadro delle notizie: una scheda per interesse o feed; il clic apre la notizia nel browser. */
export function newsCard() {
  const body = h("div", { class: "card-body news" }, h("div", { class: "muted small" }, "Carico le notizie…"));
  let active = null;
  const refresh = h("button", { class: "icon-btn", type: "button", title: "Aggiorna le notizie", "aria-label": "Aggiorna le notizie", onclick: () => load(true) }, icon("refresh"));
  const box = card("Notizie", body, { actions: [h("a", { class: "btn btn-sm btn-ghost", href: "#/impostazioni" }, "Interessi"), refresh] });
  function draw(n) {
    const secs = n.sections.filter((s) => s.items.length);
    if (!secs.length) {
      clear(body, h("div", { class: "small" },
        (store.settings?.news_topics || []).length || (store.settings?.news_feeds || []).length
          ? "Nessuna notizia trovata in questo momento."
          : ["Aggiungi i tuoi interessi (es. «cybersecurity», «NetEye», «Trentino») o dei feed RSS. ", h("a", { href: "#/impostazioni" }, "Impostazioni → Meteo e notizie")]),
      n.errors.length ? h("div", { class: "small muted" }, `Non raggiungibili: ${n.errors.map((e) => e.title).join(", ")}`) : null);
      return;
    }
    if (!secs.some((s) => s.key === active)) active = secs[0].key;
    const cur = secs.find((s) => s.key === active);
    clear(body,
      secs.length > 1 ? tabs(secs.map((s) => [s.key, s.title]), active, (k) => { active = k; draw(n); }) : null,
      h("ul", { class: "list news-list" }, cur.items.map((x) => h("li", { class: "item" },
        h("a", { class: "main-col news-link", href: x.link, target: "_blank", rel: "noopener noreferrer", title: "Apri la notizia nel browser" },
          h("div", { class: "t-title" }, x.title),
          h("div", { class: "meta" }, x.source ? h("span", {}, x.source) : null, x.published ? h("span", {}, ago(x.published)) : null)),
        icon("external")))),
      h("div", { class: "small muted", style: { marginTop: "6px" } }, `Aggiornate alle ${n.updated}`,
        n.errors.length ? ` · non raggiungibili: ${n.errors.map((e) => e.title).join(", ")}` : ""));
  }
  async function load(force = false) {
    try { draw(await get(`/api/news${force ? "?refresh=1" : ""}`)); } catch (err) { clear(body, h("div", { class: "muted small" }, "Notizie non disponibili.")); showError(err); }
  }
  load();
  return box;
}

// ------------------------------------------------------------------ impostazioni
export function extrasSettings(s, onSaved) {
  const save = async (data, msg) => {
    try { store.settings = await put("/api/settings", data); toast(msg, "ok"); onSaved(); } catch (err) { showError(err); }
  };
  // città
  const q = h("input", { type: "search", placeholder: "Cerca la città (es. Trento)", "aria-label": "Città del meteo" });
  const results = h("ul", { class: "list card", hidden: true });
  const search = async () => {
    if (q.value.trim().length < 2) return;
    try {
      const places = await get(`/api/weather/places?q=${encodeURIComponent(q.value.trim())}`);
      results.hidden = false;
      clear(results, places.length ? places.map((p) => h("li", { class: "item", onclick: () => save({ weather_place: p }, `Meteo: ${p.name}`) },
        h("div", { class: "main-col" }, h("div", { class: "t-title" }, p.name), h("div", { class: "meta" }, [p.region, p.country].filter(Boolean).join(", ")))))
        : h("li", { class: "empty" }, "Nessuna località trovata"));
    } catch (err) { showError(err); }
  };
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } });
  // interessi
  const topics = s.news_topics || [];
  const topicIn = h("input", { type: "text", placeholder: "es. cybersecurity, NetEye, Trentino…", maxlength: 80, "aria-label": "Nuovo interesse" });
  const addTopic = () => {
    const t = topicIn.value.trim();
    if (t && !topics.includes(t)) save({ news_topics: [...topics, t] }, `Interesse aggiunto: ${t}`);
  };
  topicIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addTopic(); } });
  // feed
  const feeds = s.news_feeds || [];
  const feedName = h("input", { type: "text", placeholder: "Nome (es. ANSA Tecnologia)", maxlength: 80, "aria-label": "Nome del feed" });
  const feedUrl = h("input", { type: "url", placeholder: "https://…/rss.xml", "aria-label": "Indirizzo del feed" });
  const addFeed = () => {
    const url = feedUrl.value.trim();
    if (url) save({ news_feeds: [...feeds, { name: feedName.value.trim(), url }] }, "Feed aggiunto");
  };
  return card("Meteo e notizie", h("div", { class: "card-body stack" },
    h("p", { class: "hint" }, "Dove mostrarli (icona del meteo, riquadro delle notizie) si sceglie in «Pagina Oggi»."),
    h("div", { class: "stack", style: { gap: "6px" } },
      h("b", { class: "small" }, "Città del meteo"),
      s.weather_place ? h("div", { class: "row small" }, icon("sole-nuvola"), h("span", { style: { flex: 1 } }, [s.weather_place.name, s.weather_place.region, s.weather_place.country].filter(Boolean).join(", ")),
        h("button", { class: "btn btn-sm btn-ghost", type: "button", onclick: () => save({ weather_place: null }, "Meteo tolto") }, "Togli")) : h("div", { class: "small muted" }, "Nessuna città scelta."),
      h("div", { class: "row" }, q, h("button", { class: "btn", type: "button", onclick: search }, icon("search"), "Cerca")), results),
    h("div", { class: "stack", style: { gap: "6px" } },
      h("b", { class: "small" }, "Interessi"),
      h("p", { class: "hint" }, "Ogni interesse è una ricerca su Google News: in Oggi trovi le ultime notizie per ciascuno."),
      topics.length ? h("div", { class: "chips-filter", style: { margin: 0 } }, topics.map((t) => h("span", { class: "chip-btn on" }, t,
        h("button", { class: "chip-x", type: "button", "aria-label": `Togli ${t}`, onclick: () => save({ news_topics: topics.filter((x) => x !== t) }, `Interesse tolto: ${t}`) }, "×")))) : null,
      h("div", { class: "row" }, topicIn, h("button", { class: "btn", type: "button", onclick: addTopic }, icon("plus"), "Aggiungi"))),
    h("div", { class: "stack", style: { gap: "6px" } },
      h("b", { class: "small" }, "Feed RSS (facoltativi)"),
      h("p", { class: "hint" }, "Per seguire un sito preciso: incolla l'indirizzo del suo feed RSS o Atom."),
      feeds.length ? h("ul", { class: "list compact-list" }, feeds.map((f) => h("li", { class: "item" },
        h("span", { class: "main-col" }, h("b", {}, f.name || f.url), f.name ? h("div", { class: "small muted" }, f.url) : null),
        h("button", { class: "icon-btn", type: "button", "aria-label": `Togli ${f.name || f.url}`, onclick: () => save({ news_feeds: feeds.filter((x) => x !== f) }, "Feed tolto") }, icon("trash"))))) : null,
      h("div", { class: "form-row" }, feedName, feedUrl),
      h("div", {}, h("button", { class: "btn", type: "button", onclick: addFeed }, icon("plus"), "Aggiungi feed")))));
}

/** Meteo compatto: icona e temperatura (accanto a «Pianifica la giornata»); il clic apre il dettaglio. */
export function weatherChip() {
  const btn = h("button", { class: "btn weather-chip", type: "button", title: "Meteo", "aria-expanded": "false" }, icon("nuvola"), h("span", { class: "muted" }, "…"));
  const pop = h("div", { class: "weather-pop", hidden: true });
  const wrap = h("span", { class: "weather-chip-wrap", hidden: true }, btn, pop);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (pop.hidden) { clear(pop, weatherCard()); }
    pop.hidden = !pop.hidden;
    btn.setAttribute("aria-expanded", String(!pop.hidden));
  });
  const off = (e) => {
    if (!wrap.isConnected) { document.removeEventListener("mousedown", off); return; }
    if (!wrap.contains(e.target)) { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); }
  };
  document.addEventListener("mousedown", off);
  get("/api/weather").then((w) => {
    if (w.error) return;
    if (!w.place) {
      clear(btn, icon("sole-nuvola"), h("span", { class: "small" }, "Imposta il meteo"));
      btn.onclick = (e) => { e.stopImmediatePropagation(); location.hash = "#/impostazioni"; };
      wrap.hidden = false;
      return;
    }
    const c = w.current;
    clear(btn, h("span", { class: "w-chip-icon" }, icon(c.icon)), h("b", {}, fmtT(c.temp)), h("span", { class: "w-chip-place" }, w.place.name));
    btn.title = `${w.place.name}: ${c.text}, ${fmtT(c.temp)} · oggi min ${fmtT(w.today.min)} max ${fmtT(w.today.max)}${w.today.rain ? `, pioggia ${w.today.rain}%` : ""}`;
    btn.setAttribute("aria-label", `Meteo ${btn.title}`);
    wrap.hidden = false;
  }).catch(() => {});
  return wrap;
}
