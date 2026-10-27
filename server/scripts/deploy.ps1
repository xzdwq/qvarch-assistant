<#
.SYNOPSIS
  Puts the transport server on its machine (first time and every update): the settings brought for the moment and
  taken away after — the .env never stays on the server.
.DESCRIPTION
  Sends server/deploy/compose.yml and the .env (kept here and in your vault) to the server's folder over SSH, then:
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
# (the server's code folder; not $server — PowerShell's names ignore case: it would be the -Server address)
$serverDir = Split-Path $PSScriptRoot -Parent

function Read-Setting([string]$name) {
  $f = Join-Path $serverDir '.env'
  if (-not (Test-Path $f)) { return $null }
  $line = Get-Content $f | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -First 1
  if ($line) { return ($line -split '=', 2)[1].Trim() }
}
if (-not $Server) { $Server = Read-Setting 'QA_DEPLOY_HOST' }
if (-not $User) { $User = Read-Setting 'QA_DEPLOY_USER' }
if (-not $Server -or -not $User) { throw 'Куда развёртывать: -Server <адрес> -User <пользователь> или QA_DEPLOY_HOST / QA_DEPLOY_USER в server/.env' }
if (-not $EnvFile) { $EnvFile = Join-Path $serverDir 'deploy/.env' }
if (-not (Test-Path $EnvFile)) { throw "Нет файла настроек $EnvFile (образец — server/deploy/.env.example)" }
if ($Dir -notmatch '^[\w.\-/]+$') { throw "Папка на сервере — буквы, цифры, . - / ($Dir)" }
$compose = Join-Path $serverDir 'deploy/compose.yml'
# (the user given apart: a domain one may hold «@» or «\» itself; one password try per connection — a typo never
# piles up into the server's ban for guessing)
$ssh = @('-o', "User=$User", '-o', 'NumberOfPasswordPrompts=1')

# sudo's password asked here, before the one connection (none — docker runs without sudo there)
$sudoPw = ''
if (-not $NoSudo) {
  $sudoPw = [Net.NetworkCredential]::new('', (Read-Host "Пароль sudo на $Server (для docker; обычно тот же, что для входа)" -AsSecureString)).Password
  if (-not $sudoPw -or $sudoPw -match '[\r\n]') { throw 'Пароль sudo пустой или с переводом строки' }
}

# everything in one SSH connection — one sign-in per deploy (the server bans an address for many sign-ins in a row).
# The files and sudo's password go on its input, through the encrypted channel: never on the server's command line,
# where anyone there could read them in the process list (and no scp: on Windows it turns «domain\user» into
# «domain/user»). On the server: the .env taken away on any exit; a copy of the database first (when it runs).
$b64 = { param($path) [Convert]::ToBase64String([IO.File]::ReadAllBytes($path)) }
$mark = "QA_$([guid]::NewGuid().ToString('N'))"
$remote = @'
set -u
umask 077
mkdir -p ~/__DIR__
cd ~/__DIR__ || exit 1
trap 'rm -f .env' EXIT
base64 -d > compose.yml <<'__MARK__'
__COMPOSE__
__MARK__
base64 -d > .env <<'__MARK__'
__ENV__
__MARK__
echo 'Файлы на сервере.'
__DC__
if [ -n "$(dc ps -q --status running db 2>/dev/null)" ]; then
  mkdir -p backups && chmod 700 backups
  f=backups/qa-$(date +%F-%H%M).sql
  dc exec -T db pg_dump -U qa qa > "$f" && echo "Копия базы: ~/__DIR__/$f"
fi
dc pull && dc up -d
rc=$?
dc ps
exit $rc
# (the last line — a comment: the line end PowerShell adds after it changes nothing)
'@
# docker as the server runs it: through sudo, its password read from this input (a builtin: never a process' argument)
$dcSudo = @'
IFS= read -r QA_PW <<'__MARK__'
__PW__
__MARK__
dc() { printf '%s\n' "$QA_PW" | sudo -S -p '' docker compose "$@"; }
if ! printf '%s\n' "$QA_PW" | sudo -S -p '' -v 2>/dev/null; then echo 'Пароль sudo не подошёл' >&2; exit 3; fi
'@
$dcPlain = 'dc() { docker compose "$@"; }'
# (the password put in last: nothing in it is taken for a placeholder)
$remote = $remote.Replace('__DC__', $(if ($NoSudo) { $dcPlain } else { $dcSudo })).Replace('__COMPOSE__', (& $b64 $compose)).Replace('__ENV__', (& $b64 $EnvFile)).Replace('__MARK__', $mark).Replace('__DIR__', $Dir).Replace("`r", '').Replace('__PW__', $sudoPw)

Write-Host "Обновляю $Server (~/$Dir): файлы, копия базы, новый образ, запуск — одно подключение SSH"
$remote | ssh @ssh $Server 'bash -s'
$rc = $LASTEXITCODE
$remote = $null
$sudoPw = $null
$docker = if ($NoSudo) { 'docker' } else { 'sudo docker' }
switch ($rc) {
  0 { Write-Host "Готово. Проверка: http://${Server}:3000/health (порт — QA_PUBLISH_PORT)" }
  3 { throw 'Пароль sudo не подошёл — ничего не изменено (настройки убраны с сервера)' }
  255 { throw "Нет связи по SSH (неверный пароль, блокировка за частые входы — подождите, или обрыв). Если обрыв был посреди работы, проверьте на сервере, что ~/$Dir/.env удалён" }
  default { throw "Развёртывание не удалось (код $rc) — журнал на сервере: $docker logs --tail 100 qvarch-transport-1" }
}
