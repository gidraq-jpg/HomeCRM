#requires -Version 7.0
[CmdletBinding(DefaultParameterSetName='Status')]
param(
 [Parameter(Mandatory,ParameterSetName='Install')][switch]$Install,
 [Parameter(Mandatory,ParameterSetName='Login')][switch]$Login,
 [Parameter(ParameterSetName='Status')][switch]$Status,
 [Parameter(Mandatory,ParameterSetName='Run')][switch]$Run,
 [string]$HermesHome = 'E:\HomeCRM-data\hermes',
 [string]$KeyFile = 'E:\HomeCRM-data\secrets\ai\api-server-key',
 [string]$HermesRuntime = 'E:\HomeCRM-data\hermes-runtime',
 [ValidatePattern('^[A-Za-z0-9._/-]+$')][string]$HermesModel = 'gpt-6-luna',
 [ValidateRange(1024,65535)][int]$Port = 8643,
 # Прокси к OpenAI; пусто — системный прокси Windows, если он включён.
 [ValidatePattern('^(https?://[A-Za-z0-9.\[\]:-]+/?)?$')][string]$HttpsProxy = '',
 [Parameter(ParameterSetName='Install')][switch]$NoTask
)
$ErrorActionPreference='Stop'
$HermesHome=[IO.Path]::GetFullPath($HermesHome)
$KeyFile=[IO.Path]::GetFullPath($KeyFile)
$HermesRuntime=[IO.Path]::GetFullPath($HermesRuntime)
$personal=[IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.hermes'))
if ($Port -eq 8642) { throw 'Personal Hermes port is forbidden' }
foreach ($instancePath in @($HermesHome,$KeyFile,$HermesRuntime)) {
 if ($instancePath.TrimEnd('\','/') -ieq $personal -or $instancePath.StartsWith($personal+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Personal Hermes is forbidden' }
}
$service=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../hermes-ai/server.py'))
$python=Join-Path $HermesRuntime '.venv/Scripts/python.exe'
if ($Install) {
 if (Test-Path -LiteralPath (Join-Path $HermesHome 'config.yaml')) { throw 'Instance already exists; refusing to overwrite configuration' }
 [IO.Directory]::CreateDirectory($HermesHome) | Out-Null
 [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($KeyFile)) | Out-Null
 # ACL до записи ключа: только текущая учётная запись и SYSTEM.
 if ($IsWindows) {
  $owner=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  & icacls.exe ([IO.Path]::GetDirectoryName($KeyFile)) /inheritance:r /grant:r "*${owner}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Cannot secure AI key directory' }
  & icacls.exe $HermesHome /inheritance:r /grant:r "*${owner}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Cannot secure Hermes directory' }
 }
 if (!(Test-Path -LiteralPath $KeyFile)) {
  $key=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
  try { [IO.File]::WriteAllText($KeyFile,$key,[Text.UTF8Encoding]::new($false)) } finally { $key=$null }
 }
 $config=@('model:', '  provider: openai-codex', 'platform_toolsets:', '  cli: []', '  api_server: []', 'memory:', '  memory_enabled: false', '  user_profile_enabled: false', 'skills:', '  auto_load: []', 'sessions:', '  write_json_snapshots: false', 'agent:', '  max_iterations: 1') -join "`n"
 [IO.File]::WriteAllText((Join-Path $HermesHome 'config.yaml'),$config+"`n",[Text.UTF8Encoding]::new($false))
 if (!$NoTask) {
  $pwsh=(Get-Process -Id $PID).Path
  # Планировщик получает пути, а не ключ или OAuth-токен.
  $arguments="-NoProfile -File `"$PSCommandPath`" -Run -HermesHome `"$HermesHome`" -KeyFile `"$KeyFile`" -HermesRuntime `"$HermesRuntime`" -Port $Port -HermesModel $HermesModel"
  if ($HttpsProxy) { $arguments+=" -HttpsProxy $HttpsProxy" }
  $action=New-ScheduledTaskAction -Execute $pwsh -Argument $arguments
  $trigger=New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
  $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName 'HomeCRM Hermes' -Action $action -Trigger $trigger -Settings $settings -Description 'Изолированный разбор черновиков HomeCRM' | Out-Null
 }
 Write-Output 'HomeCRM Hermes instance prepared. Prepare pinned runtime, then run -Login and -Run.'
 exit
}
if ($Login) {
 Write-Output ('$env:HERMES_HOME = ''' + $HermesHome + '''')
 Write-Output '# OpenAI отвечает 403 на адреса из России: перед входом задайте $env:HTTPS_PROXY и $env:HTTP_PROXY.'
 Write-Output ('& '''+(Join-Path $HermesRuntime '.venv/Scripts/hermes.exe')+''' auth add openai-codex --type oauth')
 Write-Output 'Вход выполняет владелец. Наличие auth.json ещё не подтверждает действительность входа.'
 exit
}
if ($Run) {
 if (!(Test-Path -LiteralPath $python)) { throw 'Prepare official Hermes v2026.6.5 runtime first; see runbook' }
 $revision=& git -C $HermesRuntime rev-parse HEAD
 if ($LASTEXITCODE -ne 0 -or $revision -ne '3c231eb3979ab9c57d5cd6d02f1d577a3b718b43') { throw 'Unsupported Hermes revision' }
 $env:HERMES_HOME=$HermesHome
 $env:HOMECRM_HERMES_RUNTIME=$HermesRuntime
 $env:HOMECRM_AI_PORT=[string]$Port
 $env:HOMECRM_HERMES_MODEL=$HermesModel
 $env:API_SERVER_KEY=[IO.File]::ReadAllText($KeyFile).Trim()
 $env:PYTHONDONTWRITEBYTECODE='1'
 if (!$HttpsProxy -and $IsWindows) {
  # Задача планировщика не наследует прокси VPN-клиента: берём системный прокси Windows.
  $inet=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
  if ($inet.ProxyEnable -eq 1 -and $inet.ProxyServer -match '^(https?://)?[A-Za-z0-9.\[\]:-]+$') {
   $HttpsProxy=if ($inet.ProxyServer -match '^https?://') { $inet.ProxyServer } else { 'http://'+$inet.ProxyServer }
  }
 }
 if ($HttpsProxy) {
  $env:HTTPS_PROXY=$HttpsProxy; $env:HTTP_PROXY=$HttpsProxy; $env:NO_PROXY='127.0.0.1,localhost'
 }
 try { & $python $service; if ($LASTEXITCODE -ne 0) { throw 'HomeCRM Hermes stopped' } }
 finally { Remove-Item Env:API_SERVER_KEY -ErrorAction SilentlyContinue }
 exit
}
try {
 $health=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3 -NoProxy
 [pscustomobject]@{ available=($health.ok -eq $true); authFilePresent=($health.authPresent -eq $true) }
} catch { [pscustomobject]@{ available=$false; authFilePresent=$false } }
