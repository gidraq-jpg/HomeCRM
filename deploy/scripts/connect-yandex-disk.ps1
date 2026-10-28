#Requires -Version 7
<#
.SYNOPSIS
  Подключает Яндекс Диск как второе хранилище резервных копий (R0.11, DATA-3, ADR-0021, ADR-0047).

.DESCRIPTION
  Два способа подключения:

  -WebDav (основной с 28 октября 2026, ADR-0047). rclone ходит на Диск по WebDAV (https://webdav.yandex.ru)
  с вашим логином Яндекса и ПАРОЛЕМ ПРИЛОЖЕНИЯ Яндекс ID (тип «Файлы / WebDAV»; обычный пароль не подойдёт).
  Скрипт спрашивает логин и пароль приложения в этой консоли (пароль не отображается), шифрует пароль
  обычным для rclone способом (rclone obscure) и пишет подключение в E:\HomeCRM-data\secrets\rclone\rclone.conf.
  Пароль не печатается и не попадает в командную строку. Папка копий та же (HomeCRM-backups), поэтому
  прежние снимки снова видны. Прежнее подключение (yadisk, REST API) удаляется только после того, как
  новое прочитало папку и restic открыл хранилище.

  Без -WebDav — прежний путь через REST API Яндекса (вход в браузере, бэкенд rclone `yandex`). С 11 октября
  2026 Яндекс отвечает на него 410 Gone (rclone #10067); путь оставлен, чтобы вернуться, если API починят.
  Внимание: у Яндекса нет доступа «только к одной папке» — оба способа дают rclone доступ ко ВСЕМУ Диску.
  Копии зашифрованы restic (пароль лежит только у вас дома), но пароль приложения и токен надо беречь.
  Контейнеры получают rclone.conf только для чтения. Агент пароли не создаёт и Яндекс не трогает:
  скрипт запускаете вы сами.

  Затем скрипт создаёт папку копий на Диске, записывает адрес в secrets\backup.env и проверяет путь
  restic -> rclone -> Яндекс Диск (создаёт зашифрованное хранилище, если его нет, и читает его).

  Нужна программа rclone на этом компьютере: winget install Rclone.Rclone (один раз) и образ приложения
  (docker compose -f deploy/compose.yaml --profile app build).

.EXAMPLE
  pwsh deploy/scripts/connect-yandex-disk.ps1 -WebDav     # основной способ
  pwsh deploy/scripts/connect-yandex-disk.ps1             # REST API (вход в браузере)
  pwsh deploy/scripts/connect-yandex-disk.ps1 -Reconnect  # REST API: войти заново, если доступ пропал
#>
param(
  [string]$DataDir = 'E:\HomeCRM-data',
  # Имя подключения в rclone: yadisk для REST API, yadisk-webdav для WebDAV.
  [string]$Remote,
  [string]$Folder = 'HomeCRM-backups',
  # REST API: войти заново, если доступ пропал (отозван, истёк): подключение и папка остаются прежними.
  [switch]$Reconnect,
  # WebDAV с паролем приложения вместо REST API.
  [switch]$WebDav,
  # Прежнее подключение (REST API): удаляется после удачной проверки WebDAV.
  [string]$OldRemote = 'yadisk',
  [string]$WebDavUrl = 'https://webdav.yandex.ru',
  # Для тестов: логин и пароль без вопросов в консоли. Владельцу не нужен — скрипт спросит сам.
  [pscredential]$Credential,
  [string]$Project = 'homecrm',
  [string[]]$ExtraComposeFiles = @()
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\ops-common.ps1"

if (-not $Remote) { $Remote = if ($WebDav) { 'yadisk-webdav' } else { 'yadisk' } }
if ($Remote -notmatch '^[A-Za-z0-9_-]+$') { throw 'Имя подключения: только латинские буквы, цифры, - и _.' }
if ($OldRemote -notmatch '^[A-Za-z0-9_-]+$') { throw 'Имя прежнего подключения: только латинские буквы, цифры, - и _.' }
if ($Folder -notmatch '^[A-Za-z0-9_-]+$') { throw 'Имя папки: только латинские буквы, цифры, - и _.' }
if ($WebDav -and $Reconnect) { throw '-Reconnect относится к REST API; для WebDAV просто запустите скрипт с -WebDav ещё раз.' }
if ($WebDavUrl -notmatch '^https?://[A-Za-z0-9.-]+(:\d+)?/?$') { throw 'Адрес WebDAV задан неверно.' }
if (-not (Get-Command rclone -ErrorAction SilentlyContinue)) {
  throw 'Не найдена программа rclone. Установите её командой "winget install Rclone.Rclone", откройте консоль заново и повторите.'
}
if (-not (Test-Path (Join-Path $DataDir 'secrets\app\server.env'))) {
  throw 'Сначала создайте секреты: pwsh deploy/scripts/new-app-secrets.ps1'
}

$rcloneDir = Join-Path $DataDir 'secrets\rclone'
$config = Join-Path $rcloneDir 'rclone.conf'
New-Item -ItemType Directory -Force $rcloneDir | Out-Null

function Get-Remotes {
  if (-not (Test-Path $config)) { return @() }
  return @(& rclone listremotes --config $config)
}

# Запуск rclone с выводом, очищенным от секретов: строки возвращаются, код — в $LASTEXITCODE.
function Invoke-RcloneCaptured {
  $lines = @(& rclone @args 2>&1 | ForEach-Object { Hide-RcloneSecrets "$_" })
  return $lines
}

# Понятная причина сбоя WebDAV по выводу rclone (те же признаки, что в restic.ts, cloudFailureReason).
function Get-WebDavFailure([string[]]$Lines) {
  $text = $Lines -join "`n"
  if ($text -match '\b401 Unauthorized\b|\[401 -') { return 'Яндекс не принял логин или пароль приложения. Проверьте логин; пароль приложения должен быть типа «Файлы / WebDAV» — создайте новый и запустите скрипт ещё раз.' }
  if ($text -match '\b403 Forbidden\b|\[403 -') { return 'Яндекс запретил доступ. Проверьте тип пароля приложения («Файлы / WebDAV») и запустите скрипт ещё раз.' }
  if ($text -match 'no such host|connection refused|i/o timeout|network is unreachable|TLS handshake timeout') { return 'Яндекс Диск недоступен по сети. Проверьте интернет и запустите скрипт ещё раз.' }
  return 'rclone не смог открыть папку на Яндекс Диске; причина — в строках выше.'
}

$before = if (Test-Path $config) { Get-Content $config -Raw } else { $null }
$remotes = Get-Remotes
$existing = $remotes -contains "${Remote}:"

if ($WebDav) {
  if (-not $Credential) {
    Write-Host 'Нужен ПАРОЛЬ ПРИЛОЖЕНИЯ Яндекс ID для WebDAV: обычный пароль Яндекса не подойдёт.'
    Write-Host 'Где создать: https://id.yandex.ru/security/app-passwords -> «Создать пароль приложения» -> тип «Файлы / WebDAV».'
    Write-Host 'Войдите в тот аккаунт Яндекса, на Диске которого лежит папка копий. Пароль покажут один раз — сразу вставьте его сюда.'
    $login = Read-Host 'Логин Яндекса (например, ivanov или ivanov@yandex.ru)'
    $secure = Read-Host 'Пароль приложения (ввод не отображается)' -AsSecureString
    $Credential = [pscredential]::new(([string]$login).Trim(), $secure)
  }
  $user = $Credential.UserName
  if ($user -notmatch '^[^\s=\[\]#;]+$') { throw 'Логин пустой или содержит пробелы и служебные символы.' }
  if ($Credential.Password.Length -eq 0) { throw 'Пароль приложения не введён.' }

  # Пароль идёт в rclone obscure через стандартный ввод: не в аргументах и не на экране.
  $obscured = $Credential.GetNetworkCredential().Password | rclone obscure -
  if ($LASTEXITCODE -ne 0 -or -not "$obscured".Trim()) { throw 'rclone не смог зашифровать пароль приложения.' }
  $obscured = "$obscured".Trim()

  # Подключение пишется прямо в файл: так логин и пароль не попадают в командную строку процессов.
  if ($existing) {
    & rclone config delete $Remote --config $config 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Не удалось заменить подключение $Remote." }
  }
  $current = if (Test-Path $config) { (Get-Content $config -Raw).TrimEnd() } else { '' }
  $section = "[$Remote]`ntype = webdav`nurl = $WebDavUrl`nvendor = other`nuser = $user`npass = $obscured`n"
  Write-TextFile $config ($(if ($current) { "$current`n`n" } else { '' }) + $section)
  $obscured = $null

  # Проверка: папка создаётся, если её нет, и читается. До успеха прежнее подключение не трогаем.
  $output = Invoke-RcloneCaptured mkdir "${Remote}:$Folder" --config $config
  $listing = if ($LASTEXITCODE -eq 0) { Invoke-RcloneCaptured lsf "${Remote}:$Folder" --config $config } else { $null }
  if ($LASTEXITCODE -ne 0) {
    @($output) + @($listing) | Where-Object { $_ } | ForEach-Object { Write-Host $_ }
    if ($null -eq $before) { Remove-Item $config -Force } else { Write-TextFile $config $before }
    throw (Get-WebDavFailure (@($output) + @($listing)))
  }
  if ($listing -contains 'config') { Write-Host "Папка $Folder открыта по WebDAV: в ней уже есть хранилище копий, прежние снимки будут видны." }
  else { Write-Host "Папка $Folder открыта по WebDAV: хранилища копий в ней ещё нет, оно создастся сейчас." }
}
elseif ($existing -and $Reconnect) {
  Write-Host 'Сейчас откроется браузер: войдите в тот же аккаунт Яндекса и нажмите "Разрешить".'
  Invoke-RcloneFiltered config reconnect "${Remote}:" --config $config --auto-confirm
  if ($LASTEXITCODE -ne 0) { throw 'Вход в Яндекс не завершился. Запустите скрипт с -Reconnect ещё раз; причина — в строках rclone выше.' }
}
elseif ($existing) {
  Write-Host "Подключение $Remote уже есть в $config — вход в Яндекс пропускаю (чтобы войти заново: -Reconnect)."
}
else {
  $restore = if ($null -ne $before) { $before.TrimEnd() + "`n`n" } else { '' }
  Write-Host 'Сейчас откроется браузер. Войдите в тот аккаунт Яндекса, на Диске которого будут лежать копии,'
  Write-Host 'и нажмите "Разрешить". Приложение rclone получит доступ ко всему вашему Яндекс Диску (у Яндекса нет доступа к одной папке).'
  Write-Host 'Если браузер не открылся сам, rclone напечатает ссылку — откройте её вручную.'
  # --auto-confirm берёт ответы по умолчанию: вход через браузер этого компьютера.
  # --no-output и фильтр: токен не должен попасть на экран и в запись консоли.
  try {
    New-RcloneRemote -Name $Remote -Type yandex -Config $config -AutoConfirm
  }
  catch {
    Write-TextFile $config $restore
    throw 'Вход в Яндекс не завершился. Запустите скрипт ещё раз; причина — в строках rclone выше.'
  }
}

if (-not $WebDav) {
  # Проверка доступа и создание папки в корне Диска.
  Invoke-RcloneFiltered mkdir "${Remote}:$Folder" --config $config
  if ($LASTEXITCODE -ne 0) { throw 'Не удалось создать папку копий на Яндекс Диске. Если в строках выше 410 — REST API Яндекса не работает, подключите WebDAV: -WebDav.' }
}
Write-Host "Папка на Яндекс Диске: $Folder"

$settings = Join-Path $DataDir 'secrets\backup.env'
$settingsBefore = if (Test-Path $settings) { Get-Content $settings -Raw } else { '' }
$line = "BACKUP_CLOUD_REPOSITORY=rclone:${Remote}:$Folder"
$text = ($settingsBefore -split "`n" | Where-Object { $_ -notmatch '^\s*#?\s*BACKUP_CLOUD_REPOSITORY=' }) -join "`n"
Write-TextFile $settings ($text.TrimEnd() + "`n" + $line + "`n")
Write-Host "Адрес хранилища записан в $settings"

# Проверка всего пути: restic -> rclone -> Яндекс Диск. Хранилище создаётся при первом запуске.
$env:HOMECRM_DATA = $DataDir -replace '\\', '/'
$compose = Get-ComposeArgs -Project $Project -ExtraFiles $ExtraComposeFiles
& docker @compose --profile app --profile ops run --rm -T --no-deps ops node apps/server/src/ops/cli.ts cloud-check
if ($LASTEXITCODE -ne 0) {
  # Адрес возвращается прежний: ночная копия пойдёт туда же, куда шла до запуска скрипта.
  Write-TextFile $settings $settingsBefore
  throw 'restic не открыл хранилище на Яндекс Диске; адрес хранилища возвращён прежний. Причина — в строке "command failed" выше (runbook, раздел 9).'
}

# Расписание копий читает адрес хранилища при создании контейнера: если оно запущено, пересоздаём его
# на том же образе, иначе ночная копия пойдёт по прежнему адресу.
$scheduler = @(& docker @compose --profile app --profile backup ps -q backup 2>$null) | Where-Object { $_ } | Select-Object -First 1
if ($scheduler) {
  $image = "$(& docker inspect -f '{{.Config.Image}}' $scheduler)".Trim()
  if ($image -match '^homecrm-app:([A-Za-z0-9._-]+)$') {
    $env:HOMECRM_VERSION = $Matches[1]
    Invoke-Docker @compose --profile app --profile backup up -d --no-deps --force-recreate backup
    Write-Host 'Расписание копий перезапущено с новым адресом хранилища.'
  }
  else {
    Write-Host 'ВНИМАНИЕ: перезапустите расписание копий: pwsh deploy/scripts/release.ps1 -Version <текущая метка> -NoBuild'
  }
}

if ($WebDav -and $OldRemote -ne $Remote -and ((Get-Remotes) -contains "${OldRemote}:")) {
  # Прежний токен REST API открывает весь Диск; после удачной проверки WebDAV он не нужен.
  & rclone config delete $OldRemote --config $config 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Write-Host "Прежнее подключение $OldRemote (REST API) удалено из rclone.conf." }
  else { Write-Host "Прежнее подключение $OldRemote удалить не удалось; копиям оно не мешает." }
}

Write-Host ''
Write-Host 'Яндекс Диск подключён. Первая копия уйдёт ночью в 3:30 или сразу: pwsh deploy/scripts/backup-now.ps1'
Write-Host 'Проверить снимки на Диске: pwsh deploy/scripts/backup-status.ps1 -Snapshots'
