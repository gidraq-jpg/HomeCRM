# Один образ HomeCRM: сервер, собранный клиент и инструменты эксплуатации (ADR-0015, ADR-0021).
# Сборка из корня репозитория: docker compose -f deploy/compose.yaml --profile app build
#
# Секреты в образ не попадают: .env и secrets исключены в .dockerignore, а пароли и ключи
# приходят при запуске из файлов в E:\HomeCRM-data\secrets.

ARG NODE_IMAGE=node:24-bookworm-slim

# --- Клиент -------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS web-build
RUN npm install --global pnpm@12.9.1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY tools/access-probe/package.json tools/access-probe/
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.base.json ./
COPY apps/web apps/web
COPY packages/shared packages/shared
RUN pnpm --filter @homecrm/web build

# --- Рабочий образ ------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
# Клиент PostgreSQL 18 (pg_dump и pg_restore той же версии, что и сервер базы) из репозитория PGDG.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-18 \
  && apt-get purge -y --auto-remove gnupg \
  && rm -rf /var/lib/apt/lists/*
# restic и rclone — готовые статические программы из официальных образов (версии закреплены).
COPY --from=restic/restic:0.18.1 /usr/bin/restic /usr/local/bin/restic
COPY --from=rclone/rclone:1.70.3 /usr/local/bin/rclone /usr/local/bin/rclone
RUN npm install --global pnpm@12.9.1

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY tools/access-probe/package.json tools/access-probe/
# Только то, что нужно серверу. Сервер запускает .ts напрямую, поэтому рабочие пакеты остаются
# на своих местах, а не копируются в node_modules (там Node не разбирает TypeScript).
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@homecrm/server..."
COPY tsconfig.base.json ./
COPY apps/server apps/server
COPY packages/db packages/db
COPY packages/shared packages/shared
COPY deploy/scripts/first-setup.ts deploy/scripts/first-setup.ts
COPY --from=web-build /app/apps/web/dist apps/web/dist

ARG APP_VERSION=local
ENV NODE_ENV=production \
  APP_VERSION=${APP_VERSION} \
  STATIC_DIR=/app/apps/web/dist \
  HOST=0.0.0.0 \
  PORT=8300

# Папки для копий и файлов: пользователь node пишет только в них и во временную папку.
RUN mkdir -p /data/files /status /backups/restic /tmp/restic-cache \
  && chown -R node:node /data /status /backups /tmp/restic-cache
USER node
CMD ["node", "apps/server/src/main.ts"]
