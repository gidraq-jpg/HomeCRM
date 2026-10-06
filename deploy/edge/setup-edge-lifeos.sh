#!/usr/bin/env bash
# HomeCRM: вход на российском VPS рядом с LifeOS (ADR-0018). Идемпотентно.
set -euo pipefail
TUNNEL_KEY="$1"
TUNNEL_USER=homecrm-tunnel
TUNNEL_PORT=18300
DOMAIN=home.gidraq.link
CADDYFILE=/home/codex/lifeos-proxy/Caddyfile
SSHD_DROPIN=/etc/ssh/sshd_config.d/60-homecrm-tunnel.conf
say() { echo "== $*"; }

# 1. Подкачка 512 МБ
if [[ -z "$(swapon --show --noheadings)" ]]; then
  fallocate -l 512M /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  echo 'vm.swappiness=10' >/etc/sysctl.d/60-homecrm-swap.conf
  sysctl -q -p /etc/sysctl.d/60-homecrm-swap.conf
  say "подкачка включена"
else
  say "подкачка уже есть"
fi
swapon --show

# 2. Пользователь туннеля
if ! id "$TUNNEL_USER" >/dev/null 2>&1; then
  useradd --system --user-group --create-home --home-dir "/home/$TUNNEL_USER" --shell /usr/sbin/nologin "$TUNNEL_USER"
fi
install -d -m 700 -o "$TUNNEL_USER" -g "$TUNNEL_USER" "/home/$TUNNEL_USER/.ssh"
printf 'restrict,port-forwarding,permitlisten="127.0.0.1:%s" %s\n' "$TUNNEL_PORT" "$TUNNEL_KEY" >"/home/$TUNNEL_USER/.ssh/authorized_keys"
chown "$TUNNEL_USER:$TUNNEL_USER" "/home/$TUNNEL_USER/.ssh/authorized_keys"
chmod 600 "/home/$TUNNEL_USER/.ssh/authorized_keys"
grep -qE '^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config\.d/\*\.conf' /etc/ssh/sshd_config || { echo "no Include in sshd_config"; exit 1; }
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
if ! sshd -t; then rm -f "$SSHD_DROPIN"; echo "sshd -t failed, dropin removed"; exit 1; fi
systemctl reload ssh 2>/dev/null || systemctl reload sshd
say "пользователь туннеля готов"
sshd -T 2>/dev/null | grep -qiE '^(allowusers|allowgroups) ' && say "ВНИМАНИЕ: задан AllowUsers/AllowGroups" || true

# 3. Сайт в Caddy LifeOS
if ! grep -q "^${DOMAIN}:8443" "$CADDYFILE"; then
  cp "$CADDYFILE" "$CADDYFILE.before-homecrm-$(date +%Y%m%d%H%M%S)"
  cat >>"$CADDYFILE" <<EOF

# HomeCRM (ADR-0018): вход для телефонов семьи; приложение — на домашнем компьютере, через туннель.
${DOMAIN}:8443 {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		-Server
	}
	@internal path /admin* /results*
	respond @internal 404
	reverse_proxy 127.0.0.1:${TUNNEL_PORT}
}
EOF
  if ! docker exec lifeos-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    last=$(ls -1t "$CADDYFILE".before-homecrm-* | head -1)
    cp "$last" "$CADDYFILE"
    echo "caddy validate failed, Caddyfile restored"; exit 1
  fi
  docker exec lifeos-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  say "сайт добавлен в Caddy"
else
  say "сайт уже есть в Caddy"
fi

# 4. Брандмауэр
say "ufw до"
ufw status | sed -n '4,40p'
for p in 80/tcp 8443/tcp; do
  ufw status | grep -qE "^${p}[[:space:]]+ALLOW" || { ufw allow "$p" >/dev/null; say "ufw: открыт $p"; }
done
free -m | sed -n '1,3p'
df -h / | tail -1
