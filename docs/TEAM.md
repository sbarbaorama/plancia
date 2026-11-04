# Plancia in team: condividere le attività con i colleghi

## Si può fare? Sì, così

Plancia è un unico programma con due modalità:

| | Personale (predefinita) | Team |
|---|---|---|
| Dove gira | sul tuo PC | su un PC o una VM **sempre accesa**, raggiungibile dai colleghi |
| Chi la usa | solo tu, senza login | ognuno con il suo account |
| Dati | `data/plancia.db` sul tuo PC | un unico database sul server |

In modalità team:

- ogni task si **assegna** a un collega; ognuno vede il **suo piano** del giorno, i suoi task ("Assegnati a me") e le sue ore;
- ogni elemento è **Team** (lo vedono tutti) oppure **Privato** (solo chi l'ha creato e, per i task, chi li ha ricevuti). I post-it nascono privati, il resto nasce condiviso;
- clienti, contatti, checklist e periodi di blocco sono comuni a tutti;
- la pagina del cliente mostra chi ha fatto cosa (attività recente con il nome);
- l'**amministratore** aggiunge i colleghi, gestisce backup, import ed export e vede le ore di tutto il team.

Perché un server e non un file condiviso su OneDrive o su una cartella di rete: SQLite su una cartella sincronizzata da più persone si corrompe. Il server invece accetta le modifiche di tutti in modo ordinato.

## Opzione consigliata: una VM Linux o il server Red Hat

Serve solo Python 3.11+ (nessuna libreria esterna). Esempio con un utente di servizio e systemd:

```bash
sudo useradd --system --home /opt/plancia plancia
sudo cp -r Plancia /opt/plancia/app && sudo chown -R plancia: /opt/plancia
```

`/etc/systemd/system/plancia.service`:

```ini
[Unit]
Description=Plancia (modalità team)
After=network.target

[Service]
User=plancia
WorkingDirectory=/opt/plancia/app
ExecStart=/usr/bin/python3.11 -m server.app --team --host 0.0.0.0 --port 8770 \
  --allowed-host plancia.azienda.local \
  --cert /etc/plancia/plancia.crt --key /etc/plancia/plancia.key
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now plancia
sudo firewall-cmd --add-port=8770/tcp --permanent && sudo firewall-cmd --reload
```

In alternativa a `--cert/--key`, metti davanti un reverse proxy HTTPS (nginx, Apache, IIS) che inoltra a `127.0.0.1:8770` e lascia Plancia in ascolto solo in locale (`--host 127.0.0.1 --allowed-host plancia.azienda.local`).

## Opzione Windows: un PC sempre acceso

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 -Team -AllowedHost plancia-pc.azienda.local -Cert C:\certs\plancia.pem -Key C:\certs\plancia.key
New-NetFirewallRule -DisplayName "Plancia" -Direction Inbound -Protocol TCP -LocalPort 8770 -Action Allow -Profile Domain
```

## Primo avvio

1. **Sul server stesso** apri `https://127.0.0.1:8770`: Plancia chiede di creare l'**amministratore**. Per sicurezza si può fare solo da lì. Se il database contiene già i tuoi dati (ad esempio copiati dal tuo PC), diventano dell'amministratore.
2. In *Impostazioni → Team → Aggiungi collega* crea gli account con una password iniziale (almeno 10 caratteri). Ognuno la cambia da *Impostazioni → Il mio account*.
3. I colleghi aprono `https://plancia.azienda.local:8770` e installano l'app da Chrome/Edge come faresti tu.

## Portare i tuoi dati sul server

Sul tuo PC: *Impostazioni → Esporta JSON*. Sul server, da amministratore: *Impostazioni → Importa JSON*. Copia anche la cartella `data/allegati`.

## Sicurezza: cosa è già fatto e cosa serve a te

Già fatto: password salvate con PBKDF2-SHA256, sessioni in cookie `HttpOnly` + `SameSite=Strict` (+ `Secure` con HTTPS), blocco temporaneo dopo 5 tentativi errati, controllo di `Host` e `Origin`, intestazione anti-CSRF obbligatoria, Content-Security-Policy, nessuna richiesta di altri siti accettata.

Serve a te:

- **HTTPS sempre** fuori dal tuo PC: un certificato della CA interna (o del reverse proxy). Senza HTTPS il server avvisa nel log, perché le password viaggerebbero in chiaro.
- **Raggiungibile solo dalla rete aziendale o dalla VPN**: non esporlo su Internet.
- **Backup** su un'altra macchina o un'altra cartella (*Impostazioni → Backup*).

## Limiti da sapere

- Non c'è un aggiornamento in tempo reale: le modifiche dei colleghi compaiono quando cambi pagina o salvi (i contatori si aggiornano ogni 2 minuti).
- I permessi sono semplici: chi vede un elemento del team lo può modificare. Gli elementi privati restano a chi li ha creati e a chi li ha ricevuti.
- La modalità personale e quella team usano database diversi: per passare dall'una all'altra si usano export e import JSON.
