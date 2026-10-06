#Requires -Version 7
# Записывает настройки туннеля до VPS в E:\HomeCRM-data\secrets\tunnel\<name>.env и ключ сервера
# в known_hosts_<name>. Ключ сервера берётся из known_hosts, который уже проверен при первом входе агента.
param(
  [Parameter(Mandatory)][ValidateSet('ru', 'alt')][string]$Name,
  [Parameter(Mandatory)][string]$HostAddress,
  [int]$Port = 22,
  [string]$DataDir = 'E:\HomeCRM-data'
)
$ErrorActionPreference = 'Stop'

$tunnelDir = Join-Path $DataDir 'secrets\tunnel'
$source = Join-Path $DataDir 'secrets\vps\known_hosts'
$entry = ssh-keygen -F $HostAddress -f $source | Where-Object { $_ -notmatch '^#' } | Select-Object -First 1
if (-not $entry) { throw "Ключа сервера $HostAddress нет в $source — сначала подключитесь к нему один раз." }

Set-Content -Path (Join-Path $tunnelDir "known_hosts_$Name") -Value $entry
Set-Content -Path (Join-Path $tunnelDir "$Name.env") -Value @(
  "SSH_HOST=$HostAddress"
  "SSH_PORT=$Port"
  "KNOWN_HOSTS_FILE=/secrets/known_hosts_$Name"
)
Write-Host "Туннель $Name настроен на $HostAddress`:$Port."
