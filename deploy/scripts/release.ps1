#Requires -Version 7
<#
.SYNOPSIS
  Выпуск и откат рабочего окружения одной командой (план, раздел 3.3; R0.11). Запускается ТОЛЬКО по команде владельца.

.DESCRIPTION
  1. Собирает образ homecrm-app:<Version> (с -NoBuild — берёт уже собранный: так делается откат).
  2. Поднимает окружение: сначала контейнер migrate делает копию перед миграцией (если она есть)
     и применяет миграции, затем перезапускается приложение. Без удачной копии миграция не идёт (DATA-4).
  3. Смоук-проверка: /health отвечает ok и база доступна.
  Откат: запустить с предыдущей меткой и -NoBuild. Если новая миграция несовместима со старым образом,
  восстановите копию, сделанную перед ней (runbook, раздел 10).

.EXAMPLE
  pwsh deploy/scripts/release.ps1 -Version v0.1.0
  pwsh deploy/scripts/release.ps1 -Version v0.0.9 -NoBuild
#>
param(
  [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]*$')][string]$Version,
  [string]$DataDir = 'E:\HomeCRM-data',
  [string]$Project = 'homecrm',
  [string]$EnvFile,
  [switch]$NoBuild,
  # Порт приложения на этом компьютере для проверки: 8300 в рабочем окружении, 8301 в предпросмотре.
  [int]$Port = 8300,
  [string[]]$ExtraComposeFiles = @()
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\ops-common.ps1"
$env:HOMECRM_DATA = $DataDir -replace '\\', '/'
$env:HOMECRM_VERSION = $Version

$compose = Get-ComposeArgs -Project $Project -EnvFile $EnvFile -ExtraFiles $ExtraComposeFiles
$profiles = @('--profile', 'app')
if ($Project -eq 'homecrm') { $profiles += @('--profile', 'backup') }

if (-not $NoBuild) {
  Write-Host "Сборка образа homecrm-app:$Version"
  Invoke-Docker @compose @profiles build
}
Write-Host 'Запуск: копия перед миграцией, миграции, приложение'
Invoke-Docker @compose @profiles up -d --remove-orphans --wait --wait-timeout 300

$health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 15 -SkipHttpErrorCheck
if ($health.status -ne 'ok' -or $health.database -ne 'ok') { throw "Смоук-проверка не пройдена: /health ответил status=$($health.status), database=$($health.database)" }
Write-Host "Готово: версия $($health.version), база отвечает."
Write-Host 'Дальше — проверка входа на телефоне и запись в CHANGELOG.md.'
