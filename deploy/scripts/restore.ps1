#Requires -Version 7
<#
.SYNOPSIS
  Восстанавливает базу и файлы из резервной копии в ПУСТУЮ базу (R0.11, DATA-3).

.DESCRIPTION
  Поднимает только базу выбранного compose-проекта, разворачивает в неё снимок restic и сверяет число
  строк. Поверх живых данных не работает: если в базе есть таблицы, останавливается.
  Сценарии:
    - потеря компьютера или базы: новый пустой проект `homecrm`, копия из Google Диска (-From cloud);
    - проверка выпуска на реальных данных: проект `homecrm-preview` (-Project, -EnvFile deploy/preview.env).
  Дальше запустите окружение как обычно (runbook, раздел 7): миграции применятся сами.

.EXAMPLE
  pwsh deploy/scripts/restore.ps1 -From cloud
  pwsh deploy/scripts/restore.ps1 -Project homecrm-preview -EnvFile deploy/preview.env
#>
param(
  [string]$DataDir = 'E:\HomeCRM-data',
  [string]$Project = 'homecrm',
  [string]$EnvFile,
  [ValidateSet('local', 'cloud')][string]$From = 'local',
  # Номер снимка из списка (backup-status.ps1 -Snapshots); по умолчанию последний.
  [string]$Snapshot = 'latest',
  [string[]]$ExtraComposeFiles = @()
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\ops-common.ps1"
$env:HOMECRM_DATA = $DataDir -replace '\\', '/'

$compose = Get-ComposeArgs -Project $Project -EnvFile $EnvFile -ExtraFiles $ExtraComposeFiles
Write-Host "Проект ${Project}: поднимаю пустую базу."
# Приложение и копии на время восстановления остановлены: в базе не должно быть новых записей.
& docker @compose --profile app --profile backup stop app backup 2>&1 | Out-Null
Invoke-Docker @compose --profile app up -d --wait db
Invoke-Docker @compose --profile app --profile ops run --rm -T -e BACKUP_ENABLED=0 ops `
  node apps/server/src/ops/cli.ts restore --from $From --snapshot $Snapshot
Write-Host ''
Write-Host 'Восстановлено. Запустите окружение: docker compose ... up -d (runbook, раздел 7).'
