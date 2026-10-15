# D7. Одно независимое ревью завершения native push

Роль: свежий ревьюер, наследуемая сильная модель. Только статическое ревью, без правок, тестов, build, push и merge.

Кандидат: `7ff1d1c34c8ed366985cf51934de57759d976592`, база `7ac9c8a7c1f4ba6c21779ec8ade23414e1a1b4df`. Worktree `C:\Users\user\.codex\worktrees\d7-studio-push-lifecycle-ci\HomeCRM`, branch `fix/studio-push-lifecycle-ci`. Проверить точный HEAD и полный diff трёх файлов. Runtime приложения/SW не менялся; canonical image source770 остаётся актуальным.

Прочитать AGENTS.md, D7-studio-push-lifecycle-ci.md, docs/screenshots/UI-3/d7-push-lifecycle-ci.md, helper и соответствующий app push handler. Предыдущее общее ревью Studio/D5/D6 не повторять. Область — только новая D7 delta и её доказательства.

Проверить:

- CDP deliverPushMessage сохраняет настоящий trusted PushEvent; observer совпадает по точным data и собирает реальные app waitUntil promises, требует хотя бы один, передаёт вызов native waitUntil и реальные rejection.
- Observer сам не продлевает lifetime и не заменяет native showNotification/handler; прежние notification title/body/tag/data/icon, click, fallback, privacy и console assertions сохранены.
- Listener/prototype/JSHandle cleanup корректен на dispatch, CDP error и остальных путях; ожидание completion не маскирует неверное событие/ошибку/неверную worker registration. Нет sleep/retry/skip/роста timeout или payload persistence/logging.
- Inline normal test действительно переведён на этот helper; initial strict icon assertions сохранены.
- Evidence отделяет controlled failure от неизвестной исторической причины CI. Baseline normal4121/1 и controlled original poll5000 failure, gate release/native completion, fixed same-gate proof и финальные Linux14/14 уже выполнены. Не запускать их снова.

Отчёт до 15 строк: точный SHA, блокеры с file:line и обоснованием либо «блокеров нет»; неблокирующие замечания отдельно. Исправляются только блокеры, повторного общего ревью нет. Внешние публикации/изменения production/data не разрешены.
