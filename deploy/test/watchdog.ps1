#Requires -Version 7
<#
.SYNOPSIS
  Проверка внешнего сторожа (deploy/watchdog/homecrm-watch.sh) в одноразовом контейнере Alpine (R0.11).

.DESCRIPTION
  Внутри контейнера поднимается httpd из busybox-extras с файлом /health. Сторож проверяется по сценарию:
  ответ ok; три неудачи подряд — одно оповещение (не повторяется); ответ вернулся — сообщение о
  восстановлении. Контейнер удаляется. На VPS ничего не ставится, в сеть наружу сторож не ходит.

.EXAMPLE
  pwsh deploy/test/watchdog.ps1
#>
$ErrorActionPreference = 'Stop'
$watchdog = (Resolve-Path (Join-Path $PSScriptRoot '..\watchdog')).Path

$inner = @'
set -u
apk add --no-cache curl busybox-extras >/dev/null
mkdir -p /www && echo '{"status":"ok","database":"ok","version":"t"}' > /www/health
httpd -p 127.0.0.1:18080 -h /www
export WATCH_URL=http://127.0.0.1:18080/health FAIL_THRESHOLD=3 STATE_DIR=/tmp/state LOG_FILE=/tmp/watch.log ENV_FILE=/nonexistent
S=/watchdog/homecrm-watch.sh
sh $S; echo "ok-run exit=$?"
rm /www/health
sh $S; sh $S
echo "alerts after 2 failures: $(grep -c 'notify:' /tmp/watch.log)"
sh $S
echo "alerts after 3 failures: $(grep -c 'notify: unavailable' /tmp/watch.log)"
sh $S; sh $S
echo "alerts after 5 failures: $(grep -c 'notify: unavailable' /tmp/watch.log)"
echo '{"status":"degraded","database":"down"}' > /www/health
sh $S
echo "degraded still failing: $(grep -c 'check failed' /tmp/watch.log)"
echo '{"status":"ok","database":"ok"}' > /www/health
sh $S
echo "recovery notices: $(grep -c 'notify: recovered' /tmp/watch.log)"
sh $S
echo "after recovery state files: $(ls /tmp/state | grep -cE '^(fails|alerted|since)$')"
echo '--- log'
cat /tmp/watch.log
'@
$output = docker run --rm -v "${watchdog}:/watchdog:ro" alpine:3 sh -c $inner
$output | ForEach-Object { Write-Host $_ }
$text = $output -join "`n"
$failures = @()
if ($text -notmatch 'ok-run exit=0') { $failures += 'исправное приложение: код выхода не 0' }
if ($text -notmatch 'alerts after 2 failures: 0') { $failures += 'оповещение пришло раньше порога' }
if ($text -notmatch 'alerts after 3 failures: 1') { $failures += 'нет оповещения на пороге' }
if ($text -notmatch 'alerts after 5 failures: 1') { $failures += 'оповещение повторилось' }
if ($text -notmatch 'recovery notices: 1') { $failures += 'нет сообщения о восстановлении' }
if ($text -notmatch 'after recovery state files: 0') { $failures += 'состояние не сброшено после восстановления' }
if ($text -match 'TELEGRAM|bot[0-9]') { $failures += 'в журнале упомянут Telegram или токен' }
if ($failures.Count -gt 0) { $failures | ForEach-Object { Write-Host "ОШИБКА: $_" -ForegroundColor Red }; exit 1 }
Write-Host 'Сторож работает по сценарию.'
