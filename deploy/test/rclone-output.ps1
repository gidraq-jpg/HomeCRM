#Requires -Version 7
<#
.SYNOPSIS
  Проверка: вывод rclone не содержит токена, но показывает причину ошибки (R0.11, ревью PR #9).

.DESCRIPTION
  Использует те же помощники New-RcloneRemote и Invoke-RcloneFiltered, что и connect-yandex-disk.ps1,
  но с подключением типа local и вымышленным токеном вместо Яндекса. rclone берётся из образа
  rclone/rclone (версия как в образе приложения), на компьютере его ставить не нужно. Проверяется:
  токен не печатается ни при успехе, ни при ошибке; текст ошибки печатается (строки не выбрасываются,
  значения после token/secret/password/key/client_id заменяются на ***); в конфигурации токен записан.

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
  if ($errorShown -notmatch 'no-such-type') { $failures.Add('текст ошибки rclone не показан: причина неизвестна') }

  # 3. Строки со словами token/client_id не выбрасываются, секретные значения в них заменяются на ***
  #    (в JSON и в виде «ключ = значение»). Вывод rclone подменяется выдуманными строками.
  $secret = 'S3CR3T-' + [guid]::NewGuid().ToString('n')
  function rclone {
    Write-Output 'NOTICE: Continue using the shared client_id anyway? y) Yes n) No (default)'
    Write-Output "token = {`"access_token`":`"$secret`",`"token_type`":`"OAuth`",`"refresh_token`":`"$secret-r`"}"
    Write-Output "ERROR : bad client_secret=$secret"
    Write-Output "Paste: {`"access_token`": `"$secret`", `"expiry`": `"2027-01-01`"}"
    $global:LASTEXITCODE = 1
  }
  $synthetic = & { Invoke-RcloneFiltered config create x yandex } *>&1 | Out-String
  if ($synthetic.Contains($secret)) { $failures.Add('секрет напечатан в строках с token/client_id') }
  if ($synthetic -notmatch 'Continue using the shared client_id anyway') { $failures.Add('строка с client_id выброшена: причина ошибки не видна') }
  if ($synthetic -notmatch 'access_token":\s*"\*\*\*"') { $failures.Add('значение в JSON не заменено на ***') }
  if ($synthetic -notmatch 'client_secret=\*\*\*') { $failures.Add('значение ключ=значение не заменено на ***') }
  if ($synthetic -notmatch '"expiry": "2027-01-01"') { $failures.Add('несекретные поля JSON искажены') }
  # Возвращаем подмену на docker-вариант для контроля ниже.
  function rclone {
    docker run --rm -v "${dir}:/cfg" rclone/rclone:1.70.3 @args
    $global:LASTEXITCODE = $LASTEXITCODE
  }

  # 4. Контроль: без фильтра и --no-output токен, как показало ревью, печатается. Тест это подтверждает,
  #    иначе проверка выше могла бы пройти впустую.
  $raw = docker run --rm -v "${dir}:/cfg" rclone/rclone:1.70.3 config create control local "token=$token" --config /cfg/rclone.conf 2>&1 | Out-String
  if (-not $raw.Contains($token)) { $failures.Add('контроль: сырой rclone не печатает токен — тест ничего не доказывает') }
}
finally {
  Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

if ($failures.Count -gt 0) { $failures | ForEach-Object { Write-Host "ОШИБКА: $_" -ForegroundColor Red }; exit 1 }
Write-Host 'Вывод rclone не содержит токена и показывает причину ошибки: успех, ошибка и строки с client_id проверены.'
