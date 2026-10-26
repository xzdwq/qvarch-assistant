<#
.SYNOPSIS
  Puts the transport server on its machine (first time and every update): the settings brought for the moment and
  taken away after — the .env never stays on the server.
.DESCRIPTION
  Copies server/deploy/compose.yml and the .env (kept here and in your vault) to the server's folder, then over SSH:
  a copy of the database (when it runs), the image pulled, the containers started, their state shown — and the .env
  removed whatever happened (a failure, Ctrl+C). The containers keep their settings: a reboot of the server needs no
  .env. Where: -Server / -User, else QA_DEPLOY_HOST / QA_DEPLOY_USER in server/.env (not committed). SSH asks for the
  password (and sudo — for its own), unless a key is set up.
.EXAMPLE
  ./server/scripts/deploy.ps1
  ./server/scripts/deploy.ps1 -Server 10.0.0.5 -User deploy -EnvFile D:\secrets\qvarch.env
#>
param(
  [string]$Server,
  [string]$User,
  # the folder on the server (its home's)
  [string]$Dir = 'qvarch',
  [string]$EnvFile,
  # docker there runs without sudo
  [switch]$NoSudo
)
$ErrorActionPreference = 'Stop'
$server = Split-Path $PSScriptRoot -Parent

function Read-Setting([string]$name) {
  $f = Join-Path $server '.env'
  if (-not (Test-Path $f)) { return $null }
  $line = Get-Content $f | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -First 1
  if ($line) { return ($line -split '=', 2)[1].Trim() }
}
if (-not $Server) { $Server = Read-Setting 'QA_DEPLOY_HOST' }
if (-not $User) { $User = Read-Setting 'QA_DEPLOY_USER' }
if (-not $Server -or -not $User) { throw 'Куда развёртывать: -Server <адрес> -User <пользователь> или QA_DEPLOY_HOST / QA_DEPLOY_USER в server/.env' }
if (-not $EnvFile) { $EnvFile = Join-Path $server 'deploy/.env' }
if (-not (Test-Path $EnvFile)) { throw "Нет файла настроек $EnvFile (образец — server/deploy/.env.example)" }
if ($Dir -notmatch '^[\w.\-/]+$') { throw "Папка на сервере — буквы, цифры, . - / ($Dir)" }
$compose = Join-Path $server 'deploy/compose.yml'
# (the user given apart: a domain one may hold «@» itself)
$ssh = @('-o', "User=$User")
$dc = if ($NoSudo) { 'docker compose' } else { 'sudo docker compose' }

Write-Host "Папка $Dir на $Server"
ssh @ssh $Server "mkdir -p ~/$Dir && chmod 700 ~/$Dir"
if ($LASTEXITCODE) { throw 'Не удалось подключиться по SSH' }

Write-Host 'Копирую compose.yml и настройки'
scp @ssh $compose "${Server}:$Dir/compose.yml"
if ($LASTEXITCODE) { throw 'Не удалось скопировать compose.yml' }
scp @ssh $EnvFile "${Server}:$Dir/.env"
if ($LASTEXITCODE) { throw 'Не удалось скопировать настройки' }

# on the server: the .env taken away on any exit; a copy of the database before the update (when it runs)
$remote = @"
set -u
cd ~/$Dir || exit 1
trap 'rm -f .env' EXIT
chmod 600 .env
if [ -n "`$($dc ps -q --status running db 2>/dev/null)" ]; then
  mkdir -p backups && chmod 700 backups
  f=backups/qa-`$(date +%F-%H%M).sql
  $dc exec -T db pg_dump -U qa qa > "`$f" && echo "Копия базы: ~/$Dir/`$f"
fi
$dc pull && $dc up -d
rc=`$?
$dc ps
exit `$rc
"@ -replace "`r", ''
ssh -t @ssh $Server $remote
$rc = $LASTEXITCODE
# (the session cut off before its trap: the settings taken away anyway)
ssh @ssh $Server "rm -f ~/$Dir/.env" | Out-Null
if ($rc) { throw "Развёртывание не удалось (код $rc) — журнал на сервере: $($dc -replace ' compose', '') logs --tail 100 qvarch-transport-1" }
Write-Host "Готово. Проверка: http://${Server}:3000/health (порт — QA_PUBLISH_PORT)"
