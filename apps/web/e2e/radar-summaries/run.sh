#!/bin/sh
set -eu
tar -C /source --exclude=node_modules --exclude=.git --exclude=.worktrees --exclude=dist --exclude=test-results --exclude=docs/screenshots/R1c.5-6 -cf - . | tar -C /workspace -xf -
pnpm install --frozen-lockfile
pnpm --filter @homecrm/web test:e2e:auth e2e/app/radar-summaries.e2e.ts e2e/app/notifications-worker.e2e.ts e2e/app/utility-radar.e2e.ts e2e/app/documents.e2e.ts e2e/app/tasks.e2e.ts --project=w360 --project=w412
