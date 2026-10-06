#Requires -Version 7
<#
.SYNOPSIS
  Подключает Google Диск как второе хранилище резервных копий (R0.11, DATA-3, ADR-0021).

.DESCRIPTION
  Запускает `rclone config create` в вашей консоли: откроется браузер, вы входите в свой аккаунт Google
  и разрешаете доступ. Область доступа — drive.file: приложение видит ТОЛЬКО созданные им файлы, а не
  весь ваш Диск. Токен сохраняется в E:\HomeCRM-data\secrets\rclone\rclone.conf; контейнеры получают
  этот файл только для чтения. Агент токен не создаёт и Google не трогает: скрипт запускаете вы сами.

  Затем скрипт создаёт папку копий на Диске, записывает адрес в secrets\backup.env и проверяет путь
  restic -> rclone -> Google Диск (создаёт зашифрованное хранилище и читает его).

  Нужна программа rclone на этом компьютере: winget install Rclone.Rclone (один раз) и образ приложения
  (docker compose -f deploy/compose.yaml --profile app build).

.EXAMPLE
  pwsh deploy/scripts/connect-google-drive.ps1
#>
param(
  [string]$DataDir = 'E:\HomeCRM-data',
  # Имя подключения в rclone и папка копий в корне Диска.
  [string]$Remote = 'gdrive',
  [string]$Folder = 'HomeCRM-backups'
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\ops-common.ps1"

if ($Remote -notmatch '^[A-Za-z0-9_-]+$') { throw 'Имя подключения: только латинские буквы, цифры, - и _.' }
if ($Folder -notmatch '^[A-Za-z0-9_-]+$') { throw 'Имя папки: только латинские буквы, цифры, - и _.' }
if (-not (Get-Command rclone -ErrorAction SilentlyContinue)) {
  throw 'Не найдена программа rclone. Установите её командой "winget install Rclone.Rclone", откройте консоль заново и повторите.'
}
if (-not (Test-Path (Join-Path $DataDir 'secrets\app\server.env'))) {
  throw 'Сначала создайте секреты: pwsh deploy/scripts/new-app-secrets.ps1'
}

$rcloneDir = Join-Path $DataDir 'secrets\rclone'
$config = Join-Path $rcloneDir 'rclone.conf'
New-Item -ItemType Directory -Force $rcloneDir | Out-Null

$existing = if (Test-Path $config) { (& rclone listremotes --config $config) -contains "${Remote}:" } else { $false }
if ($existing) {
  Write-Host "Подключение $Remote уже есть в $config — вход в Google пропускаю."
  Write-Host 'Чтобы подключить заново, удалите этот файл. Важно: копии, созданные прежним входом, новый вход может не увидеть.'
}
else {
  # Общий ключ rclone для Google Диска в 2026 году перестаёт работать: нужен свой OAuth-клиент владельца
  # (тип «Приложение для компьютера», runbook, раздел 9). Ключ не передаётся в командной строке — её
  # видно в списке процессов: он сразу пишется в конфиг, а вход делает `config reconnect`.
  Write-Host 'Нужен ваш ключ Google (OAuth-клиент «Приложение для компьютера»): как его создать — docs/runbook.md, раздел 9.'
  $clientId = (Read-Host 'Вставьте Client ID и нажмите Enter').Trim()
  if ($clientId -notmatch '^[0-9A-Za-z_-]+\.apps\.googleusercontent\.com$') {
    throw 'Это не похоже на Client ID: он заканчивается на .apps.googleusercontent.com.'
  }
  $secure = Read-Host -AsSecureString 'Вставьте Client secret (символы не отображаются) и нажмите Enter'
  $clientSecret = [System.Net.NetworkCredential]::new('', $secure).Password.Trim()
  if ($clientSecret.Length -lt 10) { throw 'Client secret слишком короткий — похоже, он не вставился.' }
  $before = if (Test-Path $config) { (Get-Content $config -Raw).TrimEnd() + "`n`n" } else { '' }
  Write-TextFile $config ($before + "[$Remote]`ntype = drive`nscope = drive.file`nclient_id = $clientId`nclient_secret = $clientSecret`n")
  $clientSecret = $null

  Write-Host 'Сейчас откроется браузер. Войдите в тот аккаунт Google, на Диске которого будут лежать копии,'
  Write-Host 'и нажмите "Разрешить". Если Google пишет "приложение не проверено", выберите "Дополнительно" -> "Перейти".'
  # --auto-confirm берёт ответы по умолчанию: вход через браузер этого компьютера, не общий диск.
  # Вывод rclone фильтруется: токен не должен попасть на экран и в запись консоли.
  Invoke-RcloneFiltered config reconnect "${Remote}:" --config $config --auto-confirm
  if ($LASTEXITCODE -ne 0) {
    Write-TextFile $config $before
    throw 'Вход в Google не завершился. Проверьте Client ID и secret и запустите скрипт ещё раз.'
  }
}

# Проверка доступа и создание папки. С областью drive.file видна только папка, созданная этим приложением.
Invoke-RcloneFiltered mkdir "${Remote}:$Folder" --config $config
if ($LASTEXITCODE -ne 0) { throw 'Не удалось создать папку копий на Google Диске.' }
Write-Host "Папка на Google Диске: $Folder"

$settings = Join-Path $DataDir 'secrets\backup.env'
$line = "BACKUP_CLOUD_REPOSITORY=rclone:${Remote}:$Folder"
$text = if (Test-Path $settings) { Get-Content $settings -Raw } else { '' }
$text = ($text -split "`n" | Where-Object { $_ -notmatch '^\s*#?\s*BACKUP_CLOUD_REPOSITORY=' }) -join "`n"
Write-TextFile $settings ($text.TrimEnd() + "`n" + $line + "`n")
Write-Host "Адрес хранилища записан в $settings"

# Проверка всего пути: restic -> rclone -> Google Диск. Хранилище создаётся при первом запуске.
$compose = Get-ComposeArgs
Invoke-Docker @compose --profile app --profile ops run --rm -T --no-deps ops node apps/server/src/ops/cli.ts cloud-check
Write-Host ''
Write-Host 'Google Диск подключён. Первая копия уйдёт ночью в 3:30 или сразу: pwsh deploy/scripts/backup-now.ps1'
