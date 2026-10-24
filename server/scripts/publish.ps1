<#
.SYNOPSIS
  Builds the transport server's image and pushes it to the registry: <registry>/qvarch/transport:<version> and :latest.
.DESCRIPTION
  The registry comes from -Registry, else from QA_REGISTRY in server/.env (not committed). Log in once before:
  docker login <registry>. The version is server/package.json's.
.EXAMPLE
  ./server/scripts/publish.ps1
  ./server/scripts/publish.ps1 -Registry registry.example.com -NoPush
#>
param(
  [string]$Registry,
  [switch]$NoPush
)
$ErrorActionPreference = 'Stop'
$server = Split-Path $PSScriptRoot -Parent
$root = Split-Path $server -Parent

if (-not $Registry) {
  $envFile = Join-Path $server '.env'
  if (Test-Path $envFile) {
    $line = Get-Content $envFile | Where-Object { $_ -match '^\s*QA_REGISTRY\s*=' } | Select-Object -First 1
    if ($line) { $Registry = ($line -split '=', 2)[1].Trim() }
  }
}
if (-not $Registry) { throw 'Не задан реестр: -Registry <адрес> или QA_REGISTRY=<адрес> в server/.env' }

$version = (Get-Content (Join-Path $server 'package.json') -Raw | ConvertFrom-Json).version
$image = "$($Registry.TrimEnd('/'))/qvarch/transport"

Write-Host "Сборка $image`:$version"
docker build -f (Join-Path $server 'Dockerfile') -t "$image`:$version" -t "$image`:latest" $root
if ($LASTEXITCODE) { throw 'Сборка образа не удалась' }

if ($NoPush) { Write-Host 'Собрано, без отправки (-NoPush)'; exit 0 }
foreach ($tag in @($version, 'latest')) {
  docker push "$image`:$tag"
  if ($LASTEXITCODE) { throw "Отправка $image`:$tag не удалась (docker login $Registry?)" }
}
Write-Host "Готово: $image`:$version и :latest. На сервере: docker compose pull && docker compose up -d"
