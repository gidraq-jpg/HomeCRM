#Requires -Version 7
<#
.SYNOPSIS
  Проверка: подключение rclone не печатает токен (R0.11, ревью PR #9).

.DESCRIPTION
  Использует тот же помощник New-RcloneRemote, что и connect-google-drive.ps1, но с подключением типа
  local и вымышленным токеном вместо Google. rclone берётся из образа rclone/rclone (версия как в
  образе приложения), на компьютере его ставить не нужно. Проверяются успешный случай и ошибка:
  в выводе нет токена ни в том, ни в другом, а в файле конфигурации токен записан.

.EXAMPLE
  pwsh deploy/test/rclone-output.ps1
#>
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\scripts\ops-common.ps1')

$token = 'FAKE-TOKEN-' + [guid]::NewGuid().ToString('n')
$dir = Join-Path $env:TEMP "homecrm-rclone-test-$([guid]::NewGuid().ToString('n').Substring(0, 8))"
New-Item -ItemType Directory -Force $dir | Out-Null
$failures = New-Object System.Collections.Generic.List[string]

# Подмена команды rclone: помощники вызывают `rclone`, функция с этим именем имеет приоритет над программой.
function rclone {
  docker run --rm -v "${dir}:/cfg" rclone/rclone:1.70.3 @args
  $global:LASTEXITCODE = $LASTEXITCODE
}

try {
  # 1. Успешное создание подключения.
  $shown = & { New-RcloneRemote -Name 'fake' -Type local -Config '/cfg/rclone.conf' -Options "token=$token" } *>&1 | Out-String
  if ($shown.Contains($token)) { $failures.Add('токен напечатан при создании подключения') }
  $saved = Get-Content (Join-Path $dir 'rclone.conf') -Raw
  if (-not $saved.Contains($token)) { $failures.Add('токен не записан в конфигурацию (подключение не создано)') }

  # 2. Ошибка: неизвестный тип подключения. Справка и текст ошибки не должны содержать токен.
  $errorShown = & {
    try { New-RcloneRemote -Name 'broken' -Type 'no-such-type' -Config '/cfg/rclone.conf' -Options "token=$token" } catch { "$($_.Exception.Message)" }
  } *>&1 | Out-String
  if ($errorShown.Contains($token)) { $failures.Add('токен напечатан при ошибке') }
  if ($errorShown -notmatch 'не смог') { $failures.Add('ошибка rclone не превратилась в понятное исключение') }

  # 3. Контроль: без фильтра и --no-output токен, как показало ревью, печатается. Тест это подтверждает,
  #    иначе проверка выше могла бы пройти впустую.
  $raw = docker run --rm -v "${dir}:/cfg" rclone/rclone:1.70.3 config create control local "token=$token" --config /cfg/rclone.conf 2>&1 | Out-String
  if (-not $raw.Contains($token)) { $failures.Add('контроль: сырой rclone не печатает токен — тест ничего не доказывает') }
}
finally {
  Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

if ($failures.Count -gt 0) { $failures | ForEach-Object { Write-Host "ОШИБКА: $_" -ForegroundColor Red }; exit 1 }
Write-Host 'Вывод подключения rclone не содержит токена: успех и ошибка проверены.'
