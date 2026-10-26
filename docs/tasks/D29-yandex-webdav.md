# Бриф D29. Копии на Яндекс Диск через WebDAV

- **Задача:** вернуть облачную копию DATA-3. С 11 октября 2026 REST API Яндекс Диска отвечает `410 Gone` («Ресурс больше недоступен») на любой путь для rclone-бэкенда `yandex`; `about` работает, вход действителен. Облачная копия не делается с 13 октября; v0.5.8-pilot.1 выпущен с пропуском облака по команде владельца. Подробности — [rclone #10067](https://github.com/rclone/rclone/issues/10067). Исполнитель — Codex, один PR.
- **Требования:** DATA-3 (две копии), [ADR-0014](../adr/0014-backups-restic.md), [ADR-0021](../adr/0021-operations-backups.md); AGENTS «Безопасность и данные».
- **Ветка:** `fix/data-3-yandex-webdav`, worktree `../HomeCRM-d29`.
- **Область:** `deploy/scripts/connect-yandex-disk.ps1`, `apps/server/src/ops/**` (только то, что касается rclone/restic облака), `deploy/compose.yaml` при необходимости, тесты `deploy/test`, `docs/runbook.md` (раздел 9), новый ADR. **Не трогать:** `E:\HomeCRM-data` (только через скрипт владельцем), рабочее окружение `homecrm`, локальное хранилище копий.

## Что сделать

1. **WebDAV вместо REST API.** rclone-бэкенд `webdav` (`url = https://webdav.yandex.ru`, `vendor = other`), логин Яндекса и **пароль приложения** Яндекс ID (тип «Файлы / WebDAV»). Хранилище restic — та же папка `HomeCRM-backups`, так что старые снимки снова доступны; ключ `--yandex-hard-delete` для WebDAV не передаётся.
2. **`connect-yandex-disk.ps1 -WebDav`:** спрашивает логин и пароль приложения скрытым вводом (`Read-Host -AsSecureString` в консоли владельца), пишет секцию в `secrets/rclone/rclone.conf` через `rclone config create … --obscure` без печати значений, затем `BACKUP_CLOUD_REPOSITORY=rclone:<remote>:HomeCRM-backups`. Старая секция `yadisk` остаётся, пока новая не прошла проверку `rclone lsf` по папке. Подсказка, где создать пароль приложения, — в выводе скрипта и runbook.
3. **Диагностика без секретов:** при сбое облака в журнал — короткая причина по коду HTTP rclone (`401` — пароль, `410` — API Яндекса, тайм-аут), а не только `restic failed at cat`. `backup-status.ps1` показывает эту причину. restic по умолчанию повторяет до 15 минут — служебные команды (`cat`, `snapshots`) ограничить своим тайм-аутом, как уже сделано для облака, и проверить, что он срабатывает.
4. **Тест цикла** (`deploy/test`): WebDAV-хранилище на локальном WebDAV-сервере в контейнере (например, `rclone serve webdav`), копия → снимки → восстановление; без настоящего Яндекса.
5. **Runbook и ADR:** почему WebDAV, как подключить, как вернуться к REST, если Яндекс починит API.

**Готово, когда:** тест цикла с WebDAV зелёный; `pnpm check` и CI зелёные; runbook описывает шаги владельца. **После слияния, по команде владельца:** владелец создаёт пароль приложения и запускает `connect-yandex-disk.ps1 -WebDav`; ведущий — `backup-now.ps1`, `backup-status.ps1 -Snapshots` (старые снимки видны) и `restore-check.ps1`.

**Общие правила:** секреты не выводить и не коммитить; новых зависимостей не нужно (rclone уже в образе); коммиты `DATA-3: …`; PR открыть, не сливать; отчёт до 15 строк по шаблону `AGENTS.md`.
