#Requires -Version 7
<#
.SYNOPSIS
  Готовит папку рабочих данных HomeCRM вне репозитория (план, раздел 2.3).

.DESCRIPTION
  Создаёт папку данных с подпапками secrets, secrets\tunnel, secrets\rclone, backups (restic, status) и import.
  Если их ещё нет, создаёт ключи VAPID для push и ключ SSH для туннеля.
  Существующие файлы не перезаписывает. Секреты на экран не выводит;
  печатает только публичный ключ туннеля — его можно показывать.

.EXAMPLE
  pwsh deploy/scripts/init-data-dir.ps1
#>
param(
  [string]$DataDir = 'E:\HomeCRM-data',
  # Адрес для служб push. Можно поменять позже в vapid.env: ключи и подписки от него не зависят.
  [string]$VapidSubject = 'https://homecrm.invalid'
)

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')

foreach ($dir in 'secrets', 'secrets\tunnel', 'secrets\rclone', 'backups', 'backups\restic', 'backups\status', 'import') {
  New-Item -ItemType Directory -Force -Path (Join-Path $DataDir $dir) | Out-Null
}
Write-Host "Папка данных: $DataDir"

$vapidFile = Join-Path $DataDir 'secrets\vapid.env'
Push-Location (Join-Path $repo 'tools\access-probe')
try {
  node scripts/generate-vapid.ts $vapidFile $VapidSubject
  if ($LASTEXITCODE -ne 0) { throw 'Не удалось создать ключи VAPID' }
}
finally {
  Pop-Location
}

$tunnelKey = Join-Path $DataDir 'secrets\tunnel\id_ed25519'
if (Test-Path $tunnelKey) {
  Write-Host 'Ключ туннеля уже есть — оставляю как есть.'
}
else {
  ssh-keygen -q -t ed25519 -N '' -C 'homecrm-tunnel' -f $tunnelKey
  if ($LASTEXITCODE -ne 0) { throw 'Не удалось создать ключ туннеля' }
  Write-Host 'Ключ туннеля создан.'
}

Write-Host ''
Write-Host 'Публичный ключ туннеля (не секретный, нужен для настройки VPS):'
Get-Content "$tunnelKey.pub"
