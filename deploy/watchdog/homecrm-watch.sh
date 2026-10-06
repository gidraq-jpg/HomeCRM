#!/bin/sh
# Внешний сторож HomeCRM (R0.11, план 7.3). Запускается на VPS раз в минуту (systemd-таймер
# homecrm-watch.timer или cron) и проверяет адрес /health приложения.
#
# Приложение считается недоступным, если за 10 секунд нет ответа 200 со "status":"ok" и базой "ok".
# После FAIL_THRESHOLD неудач подряд (по умолчанию 5 минут) сторож пишет в журнал и шлёт оповещение
# владельцу; когда приложение снова отвечает, сообщает об этом и о длительности простоя.
#
# Настройки — переменные окружения или файл ENV_FILE (по умолчанию /etc/homecrm-watch.env):
#   WATCH_URL        обязательно: https://home.gidraq.link:8443/health
#   FAIL_THRESHOLD   неудач подряд до оповещения (по умолчанию 5)
#   STATE_DIR        где хранить состояние (по умолчанию /var/lib/homecrm-watch)
#   LOG_FILE         журнал (по умолчанию /var/log/homecrm-watch.log)
#   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID  заготовка под Telegram (R2); без них — только журнал.
#                    Токен читается только из файла окружения и нигде не печатается.
#
# Работает на любой оболочке POSIX (sh, dash, busybox) с curl. На сервере с приложением не нужен.
set -u

ENV_FILE="${ENV_FILE:-/etc/homecrm-watch.env}"
if [ -r "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi

: "${WATCH_URL:?WATCH_URL is required}"
FAIL_THRESHOLD="${FAIL_THRESHOLD:-5}"
STATE_DIR="${STATE_DIR:-/var/lib/homecrm-watch}"
LOG_FILE="${LOG_FILE:-/var/log/homecrm-watch.log}"
TIMEOUT="${TIMEOUT:-10}"

mkdir -p "$STATE_DIR" 2>/dev/null || { echo "cannot create $STATE_DIR" >&2; exit 2; }
# Не запускаться поверх предыдущего прогона.
LOCK="$STATE_DIR/lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  # Замок старше 5 минут считаем брошенным.
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +5 2>/dev/null)" ]; then rmdir "$LOCK" 2>/dev/null; mkdir "$LOCK" 2>/dev/null || exit 0; else exit 0; fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

log() {
  line="$(now) $1"
  echo "$line" >>"$LOG_FILE" 2>/dev/null
  if command -v logger >/dev/null 2>&1; then logger -t homecrm-watch -- "$1"; fi
}

# Оповещение владельцу: журнал всегда, Telegram — если настроен. Ошибка отправки не роняет сторожа.
notify() {
  log "notify: $1"
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    # Адрес с токеном передаётся через стандартный ввод, а не в аргументах: так он не виден в списке процессов.
    printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TELEGRAM_BOT_TOKEN" |
      curl -sS --max-time 15 -o /dev/null -K - \
        --data-urlencode "chat_id=$TELEGRAM_CHAT_ID" \
        --data-urlencode "text=$2" 2>>"$LOG_FILE" ||
      log "telegram delivery failed"
  fi
}

BODY="$STATE_DIR/last-body"
code=$(curl -sS --max-time "$TIMEOUT" -o "$BODY" -w '%{http_code}' "$WATCH_URL" 2>/dev/null)
healthy=0
if [ "$code" = "200" ] && grep -q '"status":"ok"' "$BODY" 2>/dev/null; then
  # Если в ответе есть поле database, оно тоже должно быть ok.
  if ! grep -q '"database"' "$BODY" 2>/dev/null || grep -q '"database":"ok"' "$BODY" 2>/dev/null; then healthy=1; fi
fi

fails=0
alerted=0
since=""
[ -r "$STATE_DIR/fails" ] && fails=$(cat "$STATE_DIR/fails")
[ -r "$STATE_DIR/alerted" ] && alerted=$(cat "$STATE_DIR/alerted")
[ -r "$STATE_DIR/since" ] && since=$(cat "$STATE_DIR/since")

if [ "$healthy" = "1" ]; then
  if [ "$alerted" = "1" ]; then
    notify "recovered after downtime since $since" "HomeCRM снова доступен (был недоступен с $since UTC)."
  elif [ "$fails" -gt 0 ]; then
    log "short outage ended, failures=$fails"
  fi
  rm -f "$STATE_DIR/fails" "$STATE_DIR/alerted" "$STATE_DIR/since"
  exit 0
fi

fails=$((fails + 1))
[ -z "$since" ] && since=$(now)
echo "$fails" >"$STATE_DIR/fails"
echo "$since" >"$STATE_DIR/since"
log "check failed (http=${code:-none}), consecutive=$fails"
if [ "$fails" -ge "$FAIL_THRESHOLD" ] && [ "$alerted" != "1" ]; then
  echo 1 >"$STATE_DIR/alerted"
  notify "unavailable since $since" "HomeCRM недоступен с $since UTC: $FAIL_THRESHOLD проверок подряд без ответа."
fi
exit 0
