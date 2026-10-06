#Requires -Version 7
# Создаёт ключ SSH, которым агент настраивает VPS (ADR-0018, runbook). Ключ лежит вне репозитория,
# в E:\HomeCRM-data\secrets\vps. Скрипт не перезаписывает готовый ключ и печатает только открытую часть.
# После настройки VPS открытую часть можно убрать из /root/.ssh/authorized_keys — доступ агента закроется.
param(
  [string]$DataDir = 'E:\HomeCRM-data'
)
$ErrorActionPreference = 'Stop'

$dir = Join-Path $DataDir 'secrets\vps'
$key = Join-Path $dir 'id_ed25519'
New-Item -ItemType Directory -Force $dir | Out-Null

if (Test-Path $key) {
  Write-Host 'Ключ уже есть, новый не создаю.'
} else {
  # Пустая строка, а не '""': PowerShell 7 передаёт '""' как два символа кавычек — они стали бы паролем ключа.
  ssh-keygen -q -t ed25519 -N '' -C 'homecrm-agent-admin' -f $key
  if ($LASTEXITCODE -ne 0) { throw 'ssh-keygen завершился с ошибкой' }
  Write-Host 'Ключ создан.'
}

Write-Host 'Открытая часть ключа (её можно показывать):'
Get-Content "$key.pub"
