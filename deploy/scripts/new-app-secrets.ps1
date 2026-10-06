#Requires -Version 7
<#
.SYNOPSIS
  Создаёт секреты рабочего окружения (или предпросмотра) в E:\HomeCRM-data\secrets (R0.11).

.DESCRIPTION
  Генерирует случайные пароли ролей базы, BETTER_AUTH_SECRET и пароль хранилищ restic.
  Записывает:
    secrets\app\db.env       пароль суперпользователя базы и четырёх ролей HomeCRM
    secrets\app\server.env   три подключения к базе, BETTER_AUTH_SECRET, BASE_URL, HOME_TIME_ZONE, TRUST_PROXY
    secrets\restic-password  пароль хранилищ резервных копий (общий для рабочего окружения и предпросмотра)
    secrets\backup.env       несекретные настройки копий (время; адрес Яндекс Диска добавит connect-yandex-disk.ps1)
  Для предпросмотра вместо secrets\app используется secrets\preview.
  Существующие файлы НЕ перезаписываются. Значения на экран не выводятся: только пути.

  ВАЖНО: пароль restic и BETTER_AUTH_SECRET нужно сохранить вне компьютера (docs/runbook.md, раздел 8).
  Без пароля restic копии бесполезны, без BETTER_AUTH_SECRET у всех пропадает второй фактор.

.EXAMPLE
  pwsh deploy/scripts/new-app-secrets.ps1
  pwsh deploy/scripts/new-app-secrets.ps1 -Environment preview
#>
param(
  [string]$DataDir = 'E:\HomeCRM-data',
  [ValidateSet('production', 'preview')][string]$Environment = 'production',
  # Адрес приложения, как его видит браузер: вход через VPS (ADR-0018).
  [string]$BaseUrl,
  [string]$TimeZone = 'Asia/Yekaterinburg'
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\ops-common.ps1"

if (-not $BaseUrl) {
  $BaseUrl = if ($Environment -eq 'preview') { 'http://127.0.0.1:8301' } else { 'https://home.gidraq.link:8443' }
}
$folder = if ($Environment -eq 'preview') { 'preview' } else { 'app' }
$dir = Join-Path $DataDir "secrets\$folder"

# Случайная строка из букв и цифр: безопасна в строке подключения и в файле окружения.
function New-Secret {
  param([int]$Bytes = 24)
  return [System.Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes($Bytes)).ToLowerInvariant()
}

function Save-NewFile {
  param([string]$Path, [string]$Text)
  if (Test-Path $Path) {
    Write-Host "Уже есть, оставляю как есть: $Path"
    return $false
  }
  Write-TextFile $Path $Text
  Write-Host "Создан: $Path"
  return $true
}

$post = New-Secret
$owner = New-Secret
$app = New-Secret
$auth = New-Secret
$worker = New-Secret
$authSecret = New-Secret -Bytes 48

$dbEnv = @"
# Секреты базы (создано new-app-secrets.ps1). Не публиковать, не коммитить.
POSTGRES_PASSWORD=$post
HOMECRM_OWNER_PASSWORD=$owner
HOMECRM_APP_PASSWORD=$app
HOMECRM_AUTH_PASSWORD=$auth
HOMECRM_WORKER_PASSWORD=$worker

"@
$trustProxy = if ($Environment -eq 'preview') { 'false' } else { 'true' }
$serverEnv = @"
# Окружение сервера (создано new-app-secrets.ps1). Не публиковать, не коммитить.
DATABASE_URL_APP=postgres://homecrm_app:$app@db:5432/homecrm
DATABASE_URL_AUTH=postgres://homecrm_auth:$auth@db:5432/homecrm
DATABASE_URL_WORKER=postgres://homecrm_worker:$worker@db:5432/homecrm
BETTER_AUTH_SECRET=$authSecret
BASE_URL=$BaseUrl
HOME_TIME_ZONE=$TimeZone
TRUST_PROXY=$trustProxy

"@
$backupEnv = @"
# Настройки резервных копий (не секреты). Адрес второго хранилища появится после connect-yandex-disk.ps1.
BACKUP_TIME=03:30
HOME_TIME_ZONE=$TimeZone

"@

# db.env и server.env создаются только вместе: пароли в них должны совпадать.
$dbFile = Join-Path $dir 'db.env'
$serverFile = Join-Path $dir 'server.env'
if ((Test-Path $dbFile) -ne (Test-Path $serverFile)) {
  throw "В $dir есть только один из файлов db.env и server.env. Удалите оставшийся и запустите скрипт снова: пароли в них должны совпадать."
}
[void](Save-NewFile $dbFile $dbEnv)
[void](Save-NewFile $serverFile $serverEnv)

if ($Environment -eq 'production') {
  [void](Save-NewFile (Join-Path $DataDir 'secrets\restic-password') (New-Secret -Bytes 32))
  [void](Save-NewFile (Join-Path $DataDir 'secrets\backup.env') $backupEnv)
}
New-Item -ItemType Directory -Force (Join-Path $DataDir 'secrets\rclone'), (Join-Path $DataDir 'backups\restic'), (Join-Path $DataDir 'backups\status') | Out-Null

Write-Host ''
Write-Host 'Готово. Сохраните вне компьютера пароль restic и BETTER_AUTH_SECRET (docs/runbook.md, раздел 8).'
