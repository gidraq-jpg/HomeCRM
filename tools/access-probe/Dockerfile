# Образ заглушки этапа 0. Собирается из корня репозитория:
#   docker compose -f deploy/compose.yaml --profile probe build
FROM node:24-alpine

RUN npm install -g pnpm@12.9.1 --no-audit --no-fund --loglevel=error

WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/install-git-hooks.ts scripts/
COPY tools/access-probe/package.json tools/access-probe/
RUN pnpm install --frozen-lockfile --prod --filter @homecrm/access-probe

COPY tools/access-probe/src tools/access-probe/src
COPY tools/access-probe/public tools/access-probe/public
RUN mkdir -p /data && chown node:node /data

USER node
WORKDIR /repo/tools/access-probe
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8300 ADMIN_PORT=8309 DATA_DIR=/data
EXPOSE 8300 8309
CMD ["node", "src/server.ts"]
