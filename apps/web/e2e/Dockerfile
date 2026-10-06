# Та же версия Chromium, что у @playwright/test; скриншоты только в Linux (AGENTS.md).
FROM node:24-bookworm-slim AS node
FROM mcr.microsoft.com/playwright:v1.63.0-noble
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN npm install --global pnpm@12.9.1
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile
CMD ["pnpm", "--filter", "@homecrm/web", "test:e2e:auth"]
