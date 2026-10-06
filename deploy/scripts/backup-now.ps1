#Requires -Version 7
<#
.SYNOPSIS
  Делает резервную копию прямо сейчас во все настроенные хранилища (R0.11, DATA-3).

.EXAMPLE
  pwsh deploy/scripts/backup-now.ps1
#>
param(
  [string]$DataDir = 'E:\HomeCRM-data',
  [string]$Project = 'homecrm',
  [string[]]$ExtraComposeFiles = @()
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\ops-common.ps1"
$env:HOMECRM_DATA = $DataDir -replace '\\', '/'

$compose = Get-ComposeArgs -Project $Project -ExtraFiles $ExtraComposeFiles
Wait-FirstDatabase -DataDir $DataDir -Compose $compose
# Отдельный разовый контейнер: расписание в контейнере backup от этого не страдает.
Invoke-Docker @compose --profile app --profile ops run --rm -T ops node apps/server/src/ops/cli.ts backup
Write-Host 'Готово. Проверить: pwsh deploy/scripts/backup-status.ps1 -Snapshots'
