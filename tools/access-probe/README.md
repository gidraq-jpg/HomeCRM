# Заглушка для замеров этапа 0

Временная программа для задачи 0.2 [плана](../../docs/03-dev-plan.md): страница, с которой телефоны семьи проверяют скорость доступа и доставку push. Решение по её итогам — [ADR-0018](../../docs/adr/0018-external-entry.md). После R0 удаляется.

- `src/server.ts` — сервер на `node:http`. Порт 8300 — страница и API, его пробрасывают туннели. Порт 8309 — результаты, только для этого компьютера.
- `src/probe.ts` — разбор входных данных; тесты — `src/probe.test.ts`.
- `public/` — страница без сборки: `app.js` — замеры, `sw.js` — приём push.
- `scripts/make-icons.ts` — рисует значки; `scripts/generate-vapid.ts` — создаёт ключи push, его вызывает `deploy/scripts/init-data-dir.ps1`.

Запуск и туннели — в [runbook](../../docs/runbook.md), разделы 3 и 4. Порядок замеров и таблица результатов — в [docs/stage0/access-measurements.md](../../docs/stage0/access-measurements.md).
