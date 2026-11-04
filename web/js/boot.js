// Applica subito tema e densità salvati (prima del primo disegno), senza script inline (CSP).
try {
  var t = localStorage.getItem("plancia-theme"), d = localStorage.getItem("plancia-density");
  var named = { chiaro: "light", scuro: "dark", salvia: 1, lavanda: 1, sabbia: 1, cobalto: 1, corallo: 1, smeraldo: 1 };
  if (named[t]) document.documentElement.dataset.theme = named[t] === 1 ? t : named[t];
  if (d) document.documentElement.dataset.density = d;
  if (localStorage.getItem("plancia-rail") === "1") document.documentElement.dataset.rail = "1";
} catch (e) { /* storage non disponibile */ }
