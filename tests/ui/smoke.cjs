// Prove dell'interfaccia nel browser (Chromium via Playwright).
// Si avviano da `python -m unittest tests.test_ui`, che prepara un server con un database vuoto.
// Uso diretto: node tests/ui/smoke.cjs http://127.0.0.1:PORTA
const { chromium } = require("playwright");

const BASE = process.argv[2];
const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); } catch (err) { results.push({ name, ok: false, error: String(err && err.message || err).split("\n")[0] }); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const api = (method, url, body) => page.evaluate(async ([m, u, b]) => {
    const r = await fetch(u, { method: m, headers: { "X-Plancia": "1", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined });
    return r.status === 204 ? null : r.json();
  }, [method, url, body]);
  const go = async (hash) => { await page.goto(`${BASE}/${hash}`); await page.waitForSelector(".page-head", { timeout: 10000 }); await page.waitForTimeout(300); };
  const visibleCreate = ".combo-list:not([hidden]) .combo-opt.create";
  const click = async (sel) => { await page.click(sel); await page.waitForTimeout(400); };
  const toasts = () => page.$$eval(".toast", (t) => t.map((x) => x.textContent));

  await go("#/oggi");
  const acme = await api("POST", "/api/customers", { name: "Acme", code: "ACM" });
  for (const [f, l, co] of [["Paolo", "Rossi", "Acme Srl"], ["Laura", "Bianchi", "Würth"], ["Marco", "Conti", "Acme Srl"]]) {
    await api("POST", "/api/contacts", { first_name: f, last_name: l, company: co, customer_id: acme.id, is_consultant: l === "Bianchi" });
  }

  await check("contatti ordinati per cognome e per colonna", async () => {
    await go("#/contatti");
    if (await page.$(".view-toggle button.on >> text=Schede")) await click(".view-toggle >> text=Lista");
    const names = () => page.$$eval("tbody tr td:first-child", (t) => t.map((x) => x.textContent));
    assert(JSON.stringify(await names()) === JSON.stringify(["Bianchi", "Conti", "Rossi"]), `ordine: ${await names()}`);
    await click("th.sortable >> text=Cognome");
    assert((await names())[0] === "Rossi", "il secondo clic non inverte l'ordine");
    await click("th.sortable >> text=Nome");
    assert((await page.$$eval("tbody tr td:nth-child(2)", (t) => t.map((x) => x.textContent)))[0] === "Laura", "ordine per nome");
  });

  await check("vista a schede dei contatti", async () => {
    await click(".view-toggle >> text=Schede");
    assert((await page.$$(".contact-card")).length === 3, "schede mancanti");
    await click(".view-toggle >> text=Lista");
  });

  await check("nuovo contatto con azienda e cliente creati al volo", async () => {
    await page.click("text=Nuovo contatto"); await page.waitForSelector("#panel.open");
    await page.fill("#f-first_name", "Elena"); await page.fill("#f-last_name", "Galli");
    await page.click("#f-company"); await page.fill("#f-company", "Delta Spa"); await page.click(visibleCreate);
    await page.click("#f-customer_id"); await page.fill("#f-customer_id", "Beta"); await page.click(visibleCreate);
    await page.click("#panel button[type=submit]"); await page.waitForTimeout(600);
    const [c] = await api("GET", "/api/contacts?q=Galli");
    assert(c && c.company === "Delta Spa" && c.customer_name === "Beta", JSON.stringify(c));
    const companies = (await api("GET", "/api/companies")).map((x) => x.name);
    assert(companies.includes("Delta Spa"), "azienda non salvata");
  });

  await check("avviso contatto doppio", async () => {
    await go("#/contatti");
    await page.click("text=Nuovo contatto"); await page.waitForSelector("#panel.open");
    await page.fill("#f-first_name", "Paolo"); await page.fill("#f-last_name", "Rossi");
    await page.click("#panel button[type=submit]");
    await page.waitForSelector("dialog[open]", { timeout: 3000 });
    assert((await page.textContent("dialog[open]")).includes("Rossi Paolo"), "il messaggio non nomina il doppione");
    await page.click("dialog[open] >> text=Annulla");
    await page.click("#panel .btn >> text=Annulla");
    assert((await api("GET", "/api/contacts?q=Rossi")).length === 1, "il doppione è stato salvato");
  });

  await check("consulenza: consulente nuovo, campi che crescono, immagine incollata", async () => {
    await go("#/consulenze");
    await page.click("text=Nuova consulenza"); await page.waitForSelector("#panel.open");
    await page.click("#f-consultant_id"); await page.fill("#f-consultant_id", "Sara Neri"); await page.click(visibleCreate);
    await page.click(".subtasks .btn");
    const long = "Verifica dei servizi di monitoraggio e revisione delle soglie di allarme sugli host di produzione. ".repeat(3);
    await page.fill(".subtask textarea.outcome", long);
    await page.fill("#f-notes", `${long}\n${long}\nfine`);
    const [h1, h2] = await page.$$eval(".subtask textarea.outcome, #f-notes", (t) => t.map((x) => x.offsetHeight));
    assert(h1 > 50 && h2 > 120, `altezze ${h1}, ${h2}`);
    await page.evaluate(async () => {
      const c = document.createElement("canvas"); c.width = 40; c.height = 30; c.getContext("2d").fillRect(0, 0, 40, 30);
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      const dt = new DataTransfer(); dt.items.add(new File([blob], "image.png", { type: "image/png" }));
      const ta = document.getElementById("f-notes"); ta.focus(); ta.selectionStart = ta.value.length;
      ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForSelector(".paste-strip:not([hidden]) img");
    await page.click("#panel button[type=submit]"); await page.waitForTimeout(800);
    const [cons] = await api("GET", "/api/consultations");
    assert(cons && cons.consultant_name === "Sara Neri", "consulente non creato");
    const att = await api("GET", `/api/attachments?entity_type=consultations&entity_id=${cons.id}`);
    assert(att.length === 1 && cons.notes.includes(`[immagine: ${att[0].name}]`), "immagine non allegata");
    const sara = (await api("GET", "/api/contacts?q=Neri"))[0];
    assert(sara.is_consultant === 1 && sara.last_name === "Neri", "consulente senza spunta o cognome");
  });

  await check("task con progetto creato al volo collegato al cliente", async () => {
    await go("#/task");
    await page.keyboard.press("n");
    await page.waitForSelector("#panel.open #f-title");
    await page.fill("#f-title", "Verificare backup");
    await page.click("#f-customer_id"); await page.fill("#f-customer_id", "ACM");
    await page.keyboard.press("Enter");
    await page.click("#f-project_id"); await page.fill("#f-project_id", "Migrazione NetEye"); await page.click(visibleCreate);
    await page.click("#panel button[type=submit]"); await page.waitForTimeout(600);
    const [p] = await api("GET", "/api/projects?q=Migrazione");
    assert(p && p.customer_code === "ACM", JSON.stringify(p));
  });

  await check("cliente da completare", async () => {
    await go("#/clienti");
    assert((await page.textContent(".banner.warn")).includes("da completare"), "manca l'avviso");
  });

  await check("aziende: rinomina e unisci", async () => {
    await go("#/impostazioni");
    const all = await api("GET", "/api/companies");
    const delta = all.find((x) => x.name === "Delta Spa"), acme2 = all.find((x) => x.name === "Acme Srl");
    await api("POST", `/api/companies/${delta.id}/merge`, { into_id: acme2.id });
    assert((await api("GET", "/api/contacts?q=Galli"))[0].company === "Acme Srl", "unione non riuscita");
    await go("#/impostazioni");
    assert((await page.textContent(".card >> text=Aziende")) !== null, "manca la scheda Aziende");
  });

  await check("anteprima del tema al passaggio del mouse", async () => {
    await go("#/impostazioni");
    await page.hover(".theme-opt >> text=Cobalto");
    assert(await page.evaluate(() => document.documentElement.dataset.theme) === "cobalto", "anteprima non applicata");
    await page.mouse.move(5, 5);
    assert(await page.evaluate(() => document.documentElement.dataset.theme) !== "cobalto", "anteprima non tolta");
    await page.click(".theme-opt >> text=Corallo"); await page.waitForTimeout(400);
    assert((await api("GET", "/api/settings")).theme === "corallo", "tema non salvato");
    await api("PUT", "/api/settings", { theme: "auto" });
  });

  await check("viste a schede nelle sezioni", async () => {
    for (const s of ["clienti", "progetti", "consulenze", "note", "modifiche", "scadenze", "attese", "riunioni"]) {
      await go(`#/${s}`);
      assert(await page.$(".view-toggle"), `manca il pulsante in ${s}`);
      await page.click(".view-toggle button:not(.on)"); await page.waitForTimeout(200);
      await page.click(".view-toggle button:not(.on)"); await page.waitForTimeout(200);
    }
  });

  await check("archivio e ore in tabella ordinabile", async () => {
    const t = await api("POST", "/api/tasks", { title: "Zeta chiuso", status: "chiuso" });
    await api("POST", "/api/tasks", { title: "Alfa chiuso", status: "chiuso" });
    await go("#/archivio");
    await click(".segmented >> text=Tabella");
    await click("th.sortable >> text=Task");
    assert((await page.textContent("tbody tr td:nth-child(2)")) === "Alfa chiuso", "ordine per titolo");
    await api("POST", "/api/time_entries", { date: new Date().toISOString().slice(0, 10), minutes: 90, task_id: t.id });
    await api("POST", "/api/time_entries", { date: new Date().toISOString().slice(0, 10), minutes: 15 });
    await go("#/ore");
    await click("th.sortable >> text=Tempo");
    assert((await page.textContent("tbody tr td.num")).includes("15"), "ordine per tempo");
  });

  await check("rubrica: export vCard e import senza doppioni", async () => {
    const vcf = await page.evaluate(async () => (await fetch("/api/contacts/export.vcf")).text());
    assert(vcf.includes("N:Rossi;Paolo"), "export vCard");
    const r = await api("POST", "/api/contacts/import_vcf", { content: `${vcf}BEGIN:VCARD\r\nVERSION:3.0\r\nN:Nuovi;Ada\r\nEND:VCARD\r\n` });
    assert(r.created === 1 && r.skipped.length >= 4, JSON.stringify(r));
  });

  await check("nessun errore JavaScript", async () => { assert(!errors.length, errors.join(" | ")); });
  await browser.close();
  console.log(JSON.stringify(results));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((err) => { console.log(JSON.stringify([...results, { name: "avvio", ok: false, error: String(err) }])); process.exit(1); });
