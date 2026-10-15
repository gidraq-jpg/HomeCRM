# D5: одно ревью test-only поправки radar identity

Роль: свежий ревьюер, gpt-6-luna. Только чтение; тесты/сборку/коммиты/push не запускать.
Цель: exact `bb608a97b46e61509ac6239ff44650bbe3a0cfc9` против main `08ba7bd6248d71d856eb229f039984a63e9aaec5`.
Checkout: `C:\Users\user\.codex\worktrees\fix-studio-radar-identity-ci\HomeCRM`.

Прочитать AGENTS, `D5-studio-main-ci-radar.md`, diff radar-summaries.e2e.ts и ignored `apps/web/test-results/d5/diagnostics.md`; при необходимости только релевантный identity/AuthRoot и API schema source.
Проверить, что реальный sign-in B, cookies, focus/refetch и поздний серверный action A сохраняются; личные данные A и фильтры после переключения по-прежнему проверяются; accountIdB/schema/пустой радар/активный фильтр содержательны. Нет retries/sleep/timeout/ослабления assertions/source/security изменений.

Управляемая задержка broadcast выявила отдельный failclosed availability corner ACCOUNT_CHANGED; исторический CI без trace не реконструирован. Этот corner root внёс в бэклог, как неисправленный. Тест изолирует вспомогательную вкладку от второго AuthRoot, не притворяется исправлением production identity.

Целевой existing сценарий360/412 2/2, типы/Biome/encoding/diff-check PASS. Не повторять. Назвать только реальные блокеры и отдельно неблокирующие замечания; до15строк. После отчёта завершиться. Root исправляет только блокеры, повторного общего ревью нет.
