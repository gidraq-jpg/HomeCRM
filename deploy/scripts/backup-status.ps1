#Requires -Version 7
<#
.SYNOPSIS
  Показывает состояние резервных копий и проверок восстановления (R0.11, DATA-3).

.DESCRIPTION
  Читает отметки из E:\HomeCRM-data\backups\status и печатает по-русски: когда была последняя копия
  в каждом месте, когда проверялось восстановление. Код выхода 1, если копия старше 26 часов, второе
  хранилище не настроено или не отвечало, либо проверка восстановления старше 35 дней.
  Что реально лежит в хранилище, показывает ключ -Snapshots.

.EXAMPLE
  pwsh deploy/scripts/backup-status.ps1
  pwsh deploy/scripts/backup-status.ps1 -Snapshots
#>
param(
  [string]$DataDir = 'E:\HomeCRM-data',
  [switch]$Snapshots
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\ops-common.ps1"

$env:HOMECRM_DATA = $DataDir -replace '\\', '/'
$statusDir = Join-Path $DataDir 'backups\status'
$problems = 0
$names = @{ local = 'на этом компьютере'; cloud = 'на Google Диске' }

function Format-Age($at) {
  $span = Get-AgeSpan $at
  if ($span.TotalHours -lt 48) { return '{0:N0} ч назад' -f $span.TotalHours }
  return '{0:N0} дн. назад' -f $span.TotalDays
}

$backupFile = Join-Path $statusDir 'backup.json'
if (-not (Test-Path $backupFile)) {
  Write-Host 'Копий ещё не было (нет отметки backup.json). Сделать сейчас: pwsh deploy/scripts/backup-now.ps1'
  $problems++
}
else {
  $backup = Get-Content $backupFile -Raw | ConvertFrom-Json
  if ($backup.lastSuccessAt) {
    $last = ConvertTo-UtcDate $backup.lastSuccessAt
    Write-Host "Последняя удачная копия: $($last.ToLocalTime().ToString('d MMM HH:mm')) ($(Format-Age $last))"
    if ((Get-AgeSpan $last).TotalHours -gt 26) { Write-Host '  ВНИМАНИЕ: копия старше 26 часов.'; $problems++ }
  }
  else { Write-Host 'Удачной копии ещё не было.'; $problems++ }
  foreach ($repo in 'local', 'cloud') {
    $result = $backup.repos.$repo
    if ($null -eq $result) {
      if ($repo -eq 'cloud') { Write-Host "  $($names[$repo]): не настроено (pwsh deploy/scripts/connect-google-drive.ps1)"; $problems++ }
      continue
    }
    $mark = if ($result.ok) { 'ок' } else { "ОШИБКА: $($result.error)" }
    Write-Host "  $($names[$repo]): $mark, снимок $($result.snapshot)"
    if (-not $result.ok) { $problems++ }
  }
  if ($backup.lastCheckAt) {
    $okText = if ($backup.lastCheckOk) { 'ок' } else { 'ЕСТЬ ОШИБКИ'; $problems++ }
    Write-Host "Проверка целостности хранилищ: $okText, $(Format-Age $backup.lastCheckAt)"
  }
}

foreach ($repo in 'local', 'cloud') {
  $file = Join-Path $statusDir "restore-check-$repo.json"
  if (-not (Test-Path $file)) {
    if ($repo -eq 'local' -or (Test-Path (Join-Path $statusDir 'backup.json'))) { Write-Host "Проверка восстановления ($($names[$repo])): ещё не проводилась." }
    continue
  }
  $check = Get-Content $file -Raw | ConvertFrom-Json
  $at = ConvertTo-UtcDate $check.at
  $state = if ($check.ok) { "ок: $($check.tables) таблиц, $($check.rows) строк, файлов $($check.files)" } else { "НЕ СОШЛОСЬ: $($check.error) $($check.mismatches -join '; ')" }
  Write-Host "Проверка восстановления ($($names[$repo])): $state, $(Format-Age $at)"
  if (-not $check.ok -or (Get-AgeSpan $at).TotalDays -gt 35) { $problems++ }
}

if ($Snapshots) {
  $compose = Get-ComposeArgs
  $repos = if (Get-EnvSetting (Join-Path $DataDir 'secrets\backup.env') 'BACKUP_CLOUD_REPOSITORY') { 'local', 'cloud' } else { 'local' }
  foreach ($repo in $repos) {
    Write-Host ''
    Write-Host "Снимки $($names[$repo]):"
    & docker @compose --profile app --profile ops run --rm -T --no-deps ops node apps/server/src/ops/cli.ts snapshots --from $repo
  }
}

if ($problems -gt 0) { exit 1 }
Write-Host 'Всё в порядке.'
