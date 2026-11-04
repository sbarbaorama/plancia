# Plancia

Il cruscotto del lavoro quotidiano su più clienti: pianificazione della giornata, task, calendario, verbali, consulenze, modifiche al monitoraggio, scadenze, attese, ore lavorate e una pagina per ogni cliente.

È la nuova versione di Activity Desk, riscritta da zero. I dati della vecchia app si importano con un clic e la vecchia app resta intatta.

- I dati stanno **su questo PC**, in un database SQLite (`data/plancia.db`), con backup automatico ogni giorno.
- Un piccolo server Python risponde solo a questo computer (`127.0.0.1:8770`). Solo libreria standard: non serve installare altro.
- L'interfaccia si installa come app (PWA) da Chrome o Edge.
- Facoltativa: la **modalità team**, per lavorare con i colleghi su un server condiviso (vedi [docs/TEAM.md](docs/TEAM.md)).

## Installazione (Windows)

Requisiti: Windows 10/11, [Python 3.11 o successivo](https://www.python.org/downloads/) (durante l'installazione spunta *Add python.exe to PATH*), Chrome o Edge.

1. Apri PowerShell nella cartella di Plancia ed esegui:

   ```powershell
   powershell -ExecutionPolicy Bypass -File install.ps1
   ```

   Lo script controlla Python, crea la cartella `data`, aggiunge Plancia all'avvio automatico di Windows, avvia il server e apre il browser.
2. In Chrome o Edge clicca **Installa** nella barra degli indirizzi: Plancia compare nel menu Start.
3. **Impostazioni → Importa da Activity Desk**: il percorso del vecchio database è già proposto (`..\activity_desk\data\activity_desk.db`). Un clic e tutti i dati passano in Plancia.

Activity Desk e Plancia usano porte diverse (8765 e 8770): possono convivere finché non sei sicuro del passaggio. Poi togli la vecchia app dall'avvio automatico con `install.ps1 -Uninstall` nella sua cartella.

## Le sezioni

| Area | Sezione | A cosa serve |
|---|---|---|
| Pianifica | **Oggi** | Numeri della giornata (in ritardo, piano, solleciti, scadenze, ore), piano di oggi, agenda, attese da sollecitare, scadenze e modifiche in arrivo |
| | **Pianifica** | Tre colonne: *da pianificare* (in ritardo, entro 7 giorni, in corso, senza data, Inbox) → *il piano* del giorno (trascina, ordina, stima) → *la giornata* a blocchi orari con riunioni, consulenze e modifiche. La barra di capacità confronta le stime con le ore libere. **Chiudi la giornata** sposta al giorno dopo ciò che resta e prepara il riepilogo da copiare |
| | **Calendario** | Mese o settimana: appuntamenti, task in scadenza, consulenze, modifiche, scadenze |
| | **Timeline** | I task su un calendario orizzontale, per progetto o per cliente |
| Lavoro | **Task** | Lista per scadenza o **Kanban** per stato (trascina tra le colonne). Ogni task ha cliente (anche senza progetto), progetto, priorità, inizio, scadenza, stima, sotto-task con esito, **ricorrenza** (chiudendolo si crea il successivo), allegati e storico delle modifiche |
| | **Progetti** | Avanzamento, task, verbali, appuntamenti e documenti |
| | **Riunioni** | Verbali da modello. Le **azioni diventano task**. Le riunioni con la stessa **serie** (es. "SAL CVM") mostrano le azioni ancora aperte delle precedenti. Stampa / PDF, Ctrl+S |
| | **Consulenze** | Giornate con i consulenti: attività con esito, rapportino con le firme, riepilogo per la mail, duplica per la settimana dopo |
| | **Note** | Post-it colorati con il campo **Comando** da copiare al volo (filtro "Solo comandi") |
| | **Inbox** | Note veloci (casella in alto) da smistare con un clic in task, modifica, attesa, post-it o appuntamento |
| Operazioni | **Modifiche** | Registro con piano di rollback ed esito (anche *rollback*), **calendario delle modifiche** e **periodi di blocco** (avviso se pianifichi una modifica dentro un blocco) |
| | **Scadenze** | Certificati, licenze, contratti con preavviso; "Fatta" crea subito la successiva se ricorrente |
| | **In attesa di** | Ticket e risposte attese; "Sollecita" registra il sollecito, apre la mail al contatto e sposta il prossimo di 3 giorni lavorativi |
| | **Checklist** | Procedure ripetibili (es. "Upgrade NetEye"), avviabili anche da una modifica |
| Clienti | **Clienti** | Il **cockpit** del cliente: numeri di sintesi, calendario modifiche di due settimane, attività recente, scadenze, attese, ore del mese rispetto alle ore a contratto, e schede con task, modifiche, riunioni, consulenze, progetti, contatti e note |
| | **Contatti** | Rubrica con nome e cognome separati, ordinata per cognome (clic sull'intestazione per ordinare per un'altra colonna). L'*Azienda* si sceglie da un menu che ricorda le aziende già inserite; *Consulente* e *Service manager* (con i clienti seguiti) |
| Resoconti | **Ore** | Timer (▶ su ogni task, il timer resta visibile in alto) o inserimento a mano; totali per cliente, progetto, task e giorno; export CSV per Excel |
| | **Riepilogo** | Settimana per settimana, anche per cliente: testo pronto per la mail o stampa |
| | **Archivio** | Task chiusi per mese |

### Comodità in tutte le sezioni

- **Lista o schede**: in Contatti, Clienti, Progetti, Consulenze, Note, Modifiche, Scadenze, Attese e Riunioni il pulsante in alto a destra cambia la vista; la scelta resta su questo PC.
- **Cliente e Azienda** si scelgono da un elenco filtrabile: se scrivi un nome che non c'è, «+ Aggiungi» lo crea al volo.
- **Incolla immagini** (Ctrl+V) nelle note, nelle consulenze, nei verbali e nel riquadro allegati: l'immagine diventa un allegato con anteprima e nel testo resta il segnaposto `[immagine: …]`.
- Le note e gli esiti delle attività **si allungano** man mano che scrivi (Maiusc+Invio va a capo nel titolo di un'attività).
- **Temi**: oltre a chiaro e scuro, tre tenui (Salvia, Lavanda, Sabbia) e tre decisi (Cobalto, Corallo, Smeraldo scuro) in *Impostazioni → Tema*.

### Comandi rapidi

- **Ctrl K** (o `/`) apre la palette: cerca in tutto, vai a una sezione, crea qualunque cosa.
  Scrivendo `task @CVM verificare backup ven` si crea subito un task per il cliente CVM con scadenza venerdì (accetta `oggi`, `domani`, i giorni della settimana e `gg/mm`; `!` = priorità alta). `nota …` salva nell'Inbox.
- **N** nuovo task · **Ctrl Invio** salva il modulo aperto · **Esc** chiude il pannello.
- **Importa** (o trascina un `.eml` / `.ics` nella finestra): mail e inviti di Outlook diventano appuntamenti, task, attese o note.
- Le **notifiche del browser** (Impostazioni) avvisano di solleciti, scadenze in preavviso, task in ritardo e appuntamenti tra 15 minuti.

## Backup e spostamento dei dati

Ogni giorno, alla prima accensione, Plancia salva nella cartella dei backup `plancia_AAAA-MM-GG.db` (copia completa) e `plancia_AAAA-MM-GG.json` (export leggibile), più la copia della cartella `allegati`. I backup più vecchi di 30 giorni vengono tolti (configurabile).
**Consiglio:** in *Impostazioni → Backup* indica una cartella dentro OneDrive (es. `C:\Users\<nome>\OneDrive\Plancia-backup`).

Per spostare i dati: *Esporta JSON* sul vecchio PC → *Importa JSON* sul nuovo, e copia la cartella `data/allegati`. In alternativa, a server fermo, copia `data/plancia.db` e `data/allegati`.

## Fermare, riavviare, disinstallare

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 -Stop        # ferma il server
powershell -ExecutionPolicy Bypass -File install.ps1              # riavvia (e reinstalla l'avvio automatico)
powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall   # ferma e toglie l'avvio automatico
```

Il log del server è in `data/server.log`. I dati e i backup non vengono mai cancellati dagli script.

## Sicurezza

In modalità personale il server risponde solo a `127.0.0.1`. Ogni modifica deve arrivare dall'app stessa: sono rifiutate le richieste di altri siti (controllo di `Host` e `Origin`, intestazione `X-Plancia` obbligatoria, solo JSON), le pagine hanno una Content-Security-Policy restrittiva e gli allegati scaricati non possono eseguire script. In modalità team si aggiungono login con password (PBKDF2), sessioni con cookie `HttpOnly`/`SameSite=Strict`, blocco temporaneo dopo tentativi errati e HTTPS.

## Sviluppo

```powershell
python -m server.app --port 8770                 # avvio in primo piano
python -m server.app --team --port 8770          # prova della modalità team sul tuo PC
python -m unittest discover -s tests -v          # test
```

Struttura:

- `server/schema.py` – **una scheda per ogni sezione** (campi, query, ordinamento, ricerca, cliente, visibilità, layout del modulo). Aggiungere una sezione = aggiungere una scheda.
- `server/crud.py` – lettura/scrittura generica, validazione, storico; `server/ops.py` – pianificazione, ore, ricorrenze, verbali, consulenze, cockpit, riepiloghi; `server/auth.py` – utenti e sessioni; `server/legacy.py` – import da Activity Desk; `server/app.py` – HTTP e rotte.
- `web/` – interfaccia senza framework: `js/form.js` costruisce i moduli dalla descrizione delle sezioni, `js/views/` una vista per sezione, `css/app.css` lo stile (font Figtree e IBM Plex Mono, inclusi).
- `server/migrations/` – lo schema del database, aggiornato da solo all'avvio.
"# plancia" 
