#Requires -Version 7
<#
.SYNOPSIS
  Подключает Яндекс Диск как второе хранилище резервных копий (R0.11, DATA-3, ADR-0021).

.DESCRIPTION
  Запускает `rclone config create ... yandex` в вашей консоли: откроется браузер, вы входите в свой
  аккаунт Яндекса и разрешаете доступ. Внимание: у Яндекса нет доступа «только к одной папке» —
  rclone получает доступ ко ВСЕМУ вашему Яндекс Диску. Копии зашифрованы restic (пароль лежит только
  у вас дома), но токен надо беречь. Токен сохраняется в E:\HomeCRM-data\secrets\rclone\rclone.conf;
  контейнеры получают этот файл только для чтения. Агент токен не создаёт и Яндекс не трогает:
  скрипт запускаете вы сами.

  Затем скрипт создаёт папку копий на Диске, записывает адрес в secrets\backup.env и проверяет путь
  restic -> rclone -> Яндекс Диск (создаёт зашифрованное хранилище и читает его).

  Нужна программа rclone на этом компьютере: winget install Rclone.Rclone (один раз) и образ приложения
  (docker compose -f deploy/compose.yaml --profile app build).

.EXAMPLE
  pwsh deploy/scripts/connect-yandex-disk.ps1
  pwsh deploy/scripts/connect-yandex-disk.ps1 -Reconnect   # если доступ пропал
#>
param(
  [string]$DataDir = 'E:\HomeCRM-data',
  # Имя подключения в rclone и папка копий в корне Диска.
  [string]$Remote = 'yadisk',
  [string]$Folder = 'HomeCRM-backups',
  # Войти заново, если доступ пропал (отозван, истёк): подключение и папка остаются прежними.
  [switch]$Reconnect
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
if ($existing -and $Reconnect) {
  Write-Host 'Сейчас откроется браузер: войдите в тот же аккаунт Яндекса и нажмите "Разрешить".'
  Invoke-RcloneFiltered config reconnect "${Remote}:" --config $config --auto-confirm
  if ($LASTEXITCODE -ne 0) { throw 'Вход в Яндекс не завершился. Запустите скрипт с -Reconnect ещё раз; причина — в строках rclone выше.' }
}
elseif ($existing) {
  Write-Host "Подключение $Remote уже есть в $config — вход в Яндекс пропускаю (чтобы войти заново: -Reconnect)."
}
else {
  $before = if (Test-Path $config) { (Get-Content $config -Raw).TrimEnd() + "`n`n" } else { '' }
  Write-Host 'Сейчас откроется браузер. Войдите в тот аккаунт Яндекса, на Диске которого будут лежать копии,'
  Write-Host 'и нажмите "Разрешить". Приложение rclone получит доступ ко всему вашему Яндекс Диску (у Яндекса нет доступа к одной папке).'
  Write-Host 'Если браузер не открылся сам, rclone напечатает ссылку — откройте её вручную.'
  # --auto-confirm берёт ответы по умолчанию: вход через браузер этого компьютера.
  # --no-output и фильтр: токен не должен попасть на экран и в запись консоли.
  try {
    New-RcloneRemote -Name $Remote -Type yandex -Config $config -AutoConfirm
  }
  catch {
    Write-TextFile $config $before
    throw 'Вход в Яндекс не завершился. Запустите скрипт ещё раз; причина — в строках rclone выше.'
  }
}

# Проверка доступа и создание папки в корне Диска.
Invoke-RcloneFiltered mkdir "${Remote}:$Folder" --config $config
if ($LASTEXITCODE -ne 0) { throw 'Не удалось создать папку копий на Яндекс Диске.' }
Write-Host "Папка на Яндекс Диске: $Folder"

$settings = Join-Path $DataDir 'secrets\backup.env'
$line = "BACKUP_CLOUD_REPOSITORY=rclone:${Remote}:$Folder"
$text = if (Test-Path $settings) { Get-Content $settings -Raw } else { '' }
$text = ($text -split "`n" | Where-Object { $_ -notmatch '^\s*#?\s*BACKUP_CLOUD_REPOSITORY=' }) -join "`n"
Write-TextFile $settings ($text.TrimEnd() + "`n" + $line + "`n")
Write-Host "Адрес хранилища записан в $settings"

# Проверка всего пути: restic -> rclone -> Яндекс Диск. Хранилище создаётся при первом запуске.
$compose = Get-ComposeArgs
Invoke-Docker @compose --profile app --profile ops run --rm -T --no-deps ops node apps/server/src/ops/cli.ts cloud-check
Write-Host ''
Write-Host 'Яндекс Диск подключён. Первая копия уйдёт ночью в 3:30 или сразу: pwsh deploy/scripts/backup-now.ps1'
