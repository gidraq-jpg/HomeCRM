#Requires -Version 7
<#
.SYNOPSIS
  Проверка восстановления: поднимает базу из копии в отдельном compose-проекте и сверяет число строк (R0.11, DATA-3).

.DESCRIPTION
  Для каждого хранилища (на компьютере и на Google Диске) в отдельном compose-проекте
  `homecrm-restore-check` создаётся чистая база, в неё разворачивается последний снимок, число строк
  по таблицам сверяется с записанным в снимке, затем применяются миграции текущей версии (проверка
  выпуска на копии). Проект удаляется вместе с данными. Рабочее окружение не затрагивается.
  Результат — отметки restore-check-local.json и restore-check-cloud.json в backups\status; их читает
  backup-status.ps1. Раз в месяц запускается планировщиком Windows (register-ops-tasks.ps1).

.PARAMETER OnlyIfDue
  Выйти, если последняя удачная проверка моложе 30 дней (для ежедневного запуска планировщиком).

.EXAMPLE
  pwsh deploy/scripts/restore-check.ps1
#>
param(
  [string]$DataDir = 'E:\HomeCRM-data',
  [string]$Project = 'homecrm-restore-check',
  [ValidateSet('local', 'cloud')][string[]]$From,
  [string[]]$ExtraComposeFiles = @(),
  [switch]$OnlyIfDue
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\ops-common.ps1"
$env:HOMECRM_DATA = $DataDir -replace '\\', '/'

$statusDir = Join-Path $DataDir 'backups\status'
$cloudConfigured = [bool](Get-EnvSetting (Join-Path $DataDir 'secrets\backup.env') 'BACKUP_CLOUD_REPOSITORY')
if (-not $From) { $From = if ($cloudConfigured) { @('local', 'cloud') } else { @('local') } }

if ($OnlyIfDue) {
  $due = $false
  foreach ($repo in $From) {
    $file = Join-Path $statusDir "restore-check-$repo.json"
    if (-not (Test-Path $file)) { $due = $true; continue }
    $check = Get-Content $file -Raw | ConvertFrom-Json
    if (-not $check.ok -or ((Get-Date) - [datetime]$check.at).TotalDays -ge 30) { $due = $true }
  }
  if (-not $due) { Write-Host 'Проверка восстановления ещё не нужна (последняя моложе 30 дней).'; exit 0 }
}

$compose = Get-ComposeArgs -Project $Project -ExtraFiles $ExtraComposeFiles
$failed = $false
foreach ($repo in $From) {
  Write-Host "== Проверка восстановления: $repo =="
  try {
    # Чистая база на каждое хранилище: проект удаляется вместе с томами и до проверки, и после.
    & docker @compose --profile app --profile ops down --volumes --remove-orphans 2>&1 | Out-Null
    # В этом проекте копий не делается (BACKUP_ENABLED=0): восстановление ничего не пишет в хранилища.
    & docker @compose --profile app --profile ops run --rm -T -e BACKUP_ENABLED=0 ops `
      node apps/server/src/ops/cli.ts restore --check --migrate --from $repo
    if ($LASTEXITCODE -ne 0) { $failed = $true; Write-Host "Проверка $repo: НЕ ПРОШЛА (код $LASTEXITCODE)." }
    else { Write-Host "Проверка ${repo}: ок." }
  }
  finally {
    & docker @compose --profile app --profile ops down --volumes --remove-orphans 2>&1 | Out-Null
  }
}
if ($failed) { exit 1 }
