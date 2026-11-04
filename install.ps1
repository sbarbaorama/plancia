# Plancia - installazione su Windows (non servono diritti di amministratore)
#
#   powershell -ExecutionPolicy Bypass -File install.ps1             installa e avvia (modalita' personale)
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Stop       ferma il server
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall  ferma il server e toglie l'avvio automatico
#
# Modalita' team (PC o VM condivisa, vedi docs\TEAM.md):
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Team -AllowedHost plancia.azienda.local -Cert C:\certs\plancia.pem -Key C:\certs\plancia.key
#
# I dati (cartella data) e i backup non vengono mai cancellati da questo script.
param(
    [switch]$Uninstall,
    [switch]$Stop,
    [int]$Port = 8770,
    [switch]$Team,
    [string[]]$AllowedHost = @(),
    [string]$Cert = '',
    [string]$Key = ''
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$StartupLink = Join-Path ([Environment]::GetFolderPath('Startup')) 'Plancia.lnk'
$LocalLink = Join-Path $Root 'Avvia Plancia.lnk'
$Scheme = if ($Cert) { 'https' } else { 'http' }
$Url = "${Scheme}://127.0.0.1:$Port"

function Stop-Plancia {
    $procs = Get-CimInstance Win32_Process -Filter "Name='pythonw.exe' OR Name='python.exe'" |
        Where-Object { $_.CommandLine -like '*server.app*' -and $_.CommandLine -like "*--port $Port*" }
    foreach ($p in $procs) {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "Server fermato (PID $($p.ProcessId))."
    }
    if (-not $procs) { Write-Host 'Nessun server Plancia in esecuzione su questa porta.' }
}

if ($Stop) { Stop-Plancia; exit 0 }

if ($Uninstall) {
    Stop-Plancia
    foreach ($link in @($StartupLink, $LocalLink)) {
        if (Test-Path $link) { Remove-Item $link -Force; Write-Host "Rimosso: $link" }
    }
    Write-Host 'Avvio automatico rimosso. I dati in data\ e i backup sono rimasti dove erano.'
    exit 0
}

# --- 1. Python 3.11 o successivo
$probe = "import sys, pathlib; print(sys.version_info >= (3, 11)); print(pathlib.Path(sys.executable).with_name('pythonw.exe'))"
$info = $null
foreach ($cmd in @(@('py', '-3'), @('python'))) {
    if (-not (Get-Command $cmd[0] -ErrorAction SilentlyContinue)) { continue }
    $exe = $cmd[0]
    $cmdArgs = @($cmd | Select-Object -Skip 1) + @('-c', $probe)
    try { $out = @(& $exe @cmdArgs 2>$null) } catch { $out = @() }
    if ($LASTEXITCODE -eq 0 -and $out.Count -ge 2) { $info = $out; break }
}
if (-not $info) {
    Write-Host 'Python non trovato. Installa Python 3.11 o successivo da https://www.python.org/downloads/' -ForegroundColor Red
    Write-Host "(durante l'installazione spunta 'Add python.exe to PATH'), poi rilancia questo script."
    exit 1
}
if ($info[0] -ne 'True') {
    Write-Host 'Serve Python 3.11 o successivo. Aggiornalo da https://www.python.org/downloads/' -ForegroundColor Red
    exit 1
}
$pythonw = $info[1]
if (-not (Test-Path $pythonw)) {
    Write-Host "pythonw.exe non trovato accanto a python.exe ($pythonw)." -ForegroundColor Red
    exit 1
}

# --- 2. Argomenti del server
$serverArgs = @('-m', 'server.app', '--port', "$Port")
if ($Team) {
    $serverArgs += @('--team', '--host', '0.0.0.0')
    foreach ($h in $AllowedHost) { $serverArgs += @('--allowed-host', $h) }
    if ($Cert) { $serverArgs += @('--cert', $Cert, '--key', $Key) }
}
$argLine = ($serverArgs | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '

# --- 3. Cartella dati e collegamenti (avvio automatico + avvio manuale)
New-Item -ItemType Directory -Force -Path (Join-Path $Root 'data') | Out-Null
$shell = New-Object -ComObject WScript.Shell
foreach ($link in @($StartupLink, $LocalLink)) {
    $lnk = $shell.CreateShortcut($link)
    $lnk.TargetPath = $pythonw
    $lnk.Arguments = $argLine
    $lnk.WorkingDirectory = $Root
    $lnk.IconLocation = "$pythonw,0"
    $lnk.Description = 'Plancia - server'
    $lnk.Save()
}
Write-Host "Avvio automatico configurato: $StartupLink"

# --- 4. Avvio (se e' gia' in esecuzione, il secondo avvio esce da solo)
Start-Process -FilePath $pythonw -ArgumentList $serverArgs -WorkingDirectory $Root -WindowStyle Hidden
$ok = $false
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        if ($Cert) { [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true } }
        Invoke-WebRequest -Uri "$Url/api/session" -UseBasicParsing -TimeoutSec 2 | Out-Null
        $ok = $true
        break
    } catch { }
}
if (-not $ok) {
    Write-Host "Il server non risponde. Controlla il log: $(Join-Path $Root 'data\server.log')" -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host "Plancia e' attiva su $Url" -ForegroundColor Green
if ($Team) {
    Write-Host 'Modalita'' team: apri il link QUI, su questo PC, per creare l''account amministratore.'
    Write-Host 'Ricorda di aprire la porta nel firewall di Windows (vedi docs\TEAM.md).'
}
Write-Host 'Per installarla come app: apri il link in Chrome o Edge e clicca l''icona "Installa" nella barra degli indirizzi.'
Start-Process $Url
