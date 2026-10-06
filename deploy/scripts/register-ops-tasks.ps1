#Requires -Version 7
<#
.SYNOPSIS
  Создаёт задачу планировщика Windows: проверка восстановления раз в месяц (R0.11, DATA-3).

.DESCRIPTION
  Задача «HomeCRM: проверка восстановления» запускается каждый день в 5:30 и сама выходит, если
  последняя удачная проверка моложе 30 дней (restore-check.ps1 -OnlyIfDue). Если компьютер в это время
  был выключен, задача выполнится при ближайшей возможности. Работает от вашей учётной записи, когда
  вы вошли в систему (Docker Desktop тоже запускается при входе).
  Это системная настройка: скрипт запускаете вы сами. Ключ -WhatIf только показывает, что будет создано.
  Удалить: Unregister-ScheduledTask -TaskName 'HomeCRM: проверка восстановления'

.EXAMPLE
  pwsh deploy/scripts/register-ops-tasks.ps1 -WhatIf
  pwsh deploy/scripts/register-ops-tasks.ps1
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$Time = '05:30'
)
$ErrorActionPreference = 'Stop'
$taskName = 'HomeCRM: проверка восстановления'
$script = (Resolve-Path (Join-Path $PSScriptRoot 'restore-check.ps1')).Path
$pwsh = (Get-Command pwsh).Source

$action = New-ScheduledTaskAction -Execute $pwsh -Argument "-NoProfile -File `"$script`" -OnlyIfDue"
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew

if ($PSCmdlet.ShouldProcess($taskName, "Создать задачу: ежедневно в $Time, $script -OnlyIfDue")) {
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Description 'HomeCRM: ежемесячная проверка восстановления из резервной копии' -Force | Out-Null
  Write-Host "Задача создана: $taskName"
}
