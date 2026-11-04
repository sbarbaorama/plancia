// Applica subito tema e densità salvati (prima del primo disegno), senza script inline (CSP).
try {
  var t = localStorage.getItem("plancia-theme"), d = localStorage.getItem("plancia-density");
  if (t === "chiaro") document.documentElement.dataset.theme = "light";
  if (t === "scuro") document.documentElement.dataset.theme = "dark";
  if (d) document.documentElement.dataset.density = d;
  if (localStorage.getItem("plancia-rail") === "1") document.documentElement.dataset.rail = "1";
} catch (e) { /* storage non disponibile */ }
