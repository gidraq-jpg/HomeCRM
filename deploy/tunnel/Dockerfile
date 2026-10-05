# Обратный SSH-туннель с этого компьютера до VPS (ADR-0018).
FROM alpine:3
RUN apk add --no-cache openssh-client tini \
  && adduser -D -H -s /sbin/nologin tunnel
COPY entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh
USER tunnel
ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
