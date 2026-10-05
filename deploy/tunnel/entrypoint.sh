#!/bin/sh
# Обратный SSH-туннель (ADR-0018): порт приложения этого компьютера появляется
# на 127.0.0.1 VPS, откуда его забирает Caddy. После обрыва соединение
# восстанавливается само; пауза между попытками растёт от 5 до 60 секунд.
set -u

: "${SSH_HOST:?SSH_HOST is required}"
SSH_PORT="${SSH_PORT:-22}"
SSH_USER="${SSH_USER:-homecrm-tunnel}"
REMOTE_BIND="${REMOTE_BIND:-127.0.0.1:18300}"
TARGET="${TARGET:-probe:8300}"
KEY_SOURCE="${KEY_FILE:-/secrets/id_ed25519}"
KNOWN_HOSTS="${KNOWN_HOSTS_FILE:-/secrets/known_hosts}"

export HOME=/tmp
# Папка с ключом смонтирована с Windows с широкими правами, а ssh требует 600.
cp "$KEY_SOURCE" /tmp/tunnel_key
chmod 600 /tmp/tunnel_key

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

delay=5
while true; do
  started=$(date +%s)
  echo "$(now) connecting to ${SSH_USER}@${SSH_HOST}:${SSH_PORT}, forwarding ${REMOTE_BIND} -> ${TARGET}"
  ssh -N -T \
    -o BatchMode=yes \
    -o ConnectTimeout=15 \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=3 \
    -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile="$KNOWN_HOSTS" \
    -o IdentitiesOnly=yes \
    -i /tmp/tunnel_key \
    -p "$SSH_PORT" \
    -R "${REMOTE_BIND}:${TARGET}" \
    "${SSH_USER}@${SSH_HOST}"
  code=$?
  # Соединение продержалось дольше минуты — значит, сбой разовый: пробуем снова быстро.
  if [ $(($(date +%s) - started)) -gt 60 ]; then delay=5; fi
  echo "$(now) ssh exited with code ${code}, retry in ${delay}s"
  sleep "$delay"
  delay=$((delay * 2))
  if [ "$delay" -gt 60 ]; then delay=60; fi
done
