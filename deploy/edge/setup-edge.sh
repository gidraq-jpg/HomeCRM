#!/usr/bin/env bash
# Настройка VPS как внешнего входа HomeCRM (ADR-0018): Caddy с HTTPS и пользователь для туннеля.
#
# Запуск на VPS от root:
#   bash setup-edge.sh <адрес> '<публичный ключ туннеля>'
# Пример:
#   bash setup-edge.sh home.example.ru 'ssh-ed25519 AAAA... homecrm-tunnel'
#
# Что делает:
#   1. Проверяет, что порты 80 и 443 свободны или заняты самим Caddy. Если там VPN или другой
#      веб-сервер — останавливается и ничего не меняет.
#   2. Ставит Caddy, если его нет, и добавляет сайт HomeCRM в /etc/caddy/sites/homecrm.caddy.
#   3. Создаёт пользователя homecrm-tunnel без оболочки. Его ключ может только открыть
#      один порт на 127.0.0.1 этого VPS — ни команд, ни других пробросов.
#   4. Печатает публичный ключ этого сервера для проверки подлинности при подключении туннеля.
# Скрипт можно запускать повторно. Чужие сайты Caddy и общие настройки SSH он не меняет.
set -euo pipefail

DOMAIN="${1:-}"
TUNNEL_KEY="${2:-}"
TUNNEL_USER="homecrm-tunnel"
TUNNEL_PORT="${TUNNEL_PORT:-18300}"
CADDYFILE=/etc/caddy/Caddyfile
SITE_FILE=/etc/caddy/sites/homecrm.caddy
SSHD_DROPIN=/etc/ssh/sshd_config.d/60-homecrm-tunnel.conf

die() {
  echo "ОШИБКА: $*" >&2
  exit 1
}
say() { echo "==> $*"; }

[[ $EUID -eq 0 ]] || die "запустите от root: sudo bash setup-edge.sh …"
[[ -n "$DOMAIN" && -n "$TUNNEL_KEY" ]] ||
  die "использование: bash setup-edge.sh <адрес> '<публичный ключ туннеля>'"
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] ||
  die "непохоже на адрес: $DOMAIN"
[[ "$TUNNEL_KEY" =~ ^ssh-ed25519\ [A-Za-z0-9+/]+=*(\ [A-Za-z0-9._@-]+)?$ ]] ||
  die "ожидается одна строка публичного ключа ssh-ed25519"

# shellcheck disable=SC1091
. /etc/os-release
[[ "${ID:-}" == "debian" || "${ID:-}" == "ubuntu" || "${ID_LIKE:-}" == *debian* ]] ||
  die "скрипт рассчитан на Debian или Ubuntu, а здесь ${PRETTY_NAME:-неизвестная система}"

# --- 1. Порты 80 и 443 ---------------------------------------------------------
busy=$(ss -Htlnp '( sport = :80 or sport = :443 )' | grep -v '"caddy"' || true)
if [[ -n "$busy" ]]; then
  echo "$busy" >&2
  die "порты 80 или 443 заняты другой программой (часто это VPN или веб-сервер). Ничего не менял. Напишите агенту — подберём схему."
fi

# --- 2. Caddy ------------------------------------------------------------------
if ! command -v caddy >/dev/null 2>&1; then
  say "Ставлю Caddy"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  if apt-cache policy caddy | grep -q 'Candidate: [0-9]'; then
    apt-get install -y -qq caddy
  else
    # В репозитории системы Caddy нет — берём официальный репозиторий Caddy.
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' |
      gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      -o /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy
  fi
fi

mkdir -p /etc/caddy/sites
cat >"$SITE_FILE" <<EOF
# HomeCRM (ADR-0018). Файл создаёт deploy/edge/setup-edge.sh; правки вручную перезапишутся.
${DOMAIN} {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		-Server
	}
	# Служебные адреса снаружи закрыты.
	@internal path /admin* /results*
	respond @internal 404
	reverse_proxy 127.0.0.1:${TUNNEL_PORT}
}
EOF

# Стандартный Caddyfile из пакета заменяем; свой — дополняем строкой import.
stripped=$(grep -vE '^[[:space:]]*(#|$)' "$CADDYFILE" 2>/dev/null | tr -s ' \t' ' ' | sed 's/^ //' || true)
stock=$':80 {\nroot * /usr/share/caddy\nfile_server\n}'
if [[ ! -f "$CADDYFILE" || -z "$stripped" || "$stripped" == "$stock" ]]; then
  printf '# Сайты подключаются из /etc/caddy/sites/.\nimport sites/*.caddy\n' >"$CADDYFILE"
elif ! grep -q '^import sites/\*\.caddy' "$CADDYFILE"; then
  cp "$CADDYFILE" "$CADDYFILE.before-homecrm"
  printf '\n# HomeCRM\nimport sites/*.caddy\n' >>"$CADDYFILE"
  say "В ваш Caddyfile добавлена строка import; копия — $CADDYFILE.before-homecrm"
fi

caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null ||
  die "Caddy не принял настройки — проверьте $CADDYFILE"
systemctl enable --now caddy >/dev/null
systemctl reload caddy

# --- 3. Пользователь туннеля ------------------------------------------------------
if ! id "$TUNNEL_USER" >/dev/null 2>&1; then
  useradd --system --user-group --create-home --home-dir "/home/$TUNNEL_USER" \
    --shell /usr/sbin/nologin "$TUNNEL_USER"
fi
install -d -m 700 -o "$TUNNEL_USER" -g "$TUNNEL_USER" "/home/$TUNNEL_USER/.ssh"
printf 'restrict,port-forwarding,permitlisten="127.0.0.1:%s" %s\n' "$TUNNEL_PORT" "$TUNNEL_KEY" \
  >"/home/$TUNNEL_USER/.ssh/authorized_keys"
chown "$TUNNEL_USER:$TUNNEL_USER" "/home/$TUNNEL_USER/.ssh/authorized_keys"
chmod 600 "/home/$TUNNEL_USER/.ssh/authorized_keys"

grep -qE '^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config\.d/\*\.conf' /etc/ssh/sshd_config ||
  die "в /etc/ssh/sshd_config нет строки 'Include /etc/ssh/sshd_config.d/*.conf'. Ограничения для туннеля не применились бы — остановился. Напишите агенту."

cat >"$SSHD_DROPIN" <<EOF
# HomeCRM (ADR-0018): пользователь туннеля может только открыть один порт на 127.0.0.1.
Match User ${TUNNEL_USER}
	AllowTcpForwarding remote
	PermitListen 127.0.0.1:${TUNNEL_PORT}
	GatewayPorts no
	X11Forwarding no
	AllowAgentForwarding no
	PermitTTY no
	ForceCommand /usr/sbin/nologin
	ClientAliveInterval 15
	ClientAliveCountMax 3
Match all
EOF
if ! sshd -t; then
  rm -f "$SSHD_DROPIN"
  die "проверка настроек SSH не прошла — файл $SSHD_DROPIN удалён, SSH работает как раньше"
fi
systemctl reload ssh 2>/dev/null || systemctl reload sshd

if sshd -T 2>/dev/null | grep -qiE '^(allowusers|allowgroups) '; then
  say "ВНИМАНИЕ: в SSH задан AllowUsers или AllowGroups — добавьте туда $TUNNEL_USER, иначе туннель не подключится."
fi

# --- 4. Брандмауэр ---------------------------------------------------------------
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  say "В ufw открыты порты 80 и 443"
fi

# --- Готово ------------------------------------------------------------------------
ssh_port=$(sshd -T 2>/dev/null | awk '$1 == "port" { print $2; exit }')
say "Готово. Пришлите агенту три строки ниже — они не секретные:"
echo "адрес: ${DOMAIN}"
echo "порт SSH: ${ssh_port:-22}"
echo "ключ сервера: $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"
say "Если у провайдера VPS есть свой брандмауэр в панели управления, откройте в нём порты 80 и 443."
