# D7. Независимое статическое ревью

Кандидат: `7ff1d1c34c8ed366985cf51934de57759d976592`; база: `7ac9c8a7c1f4ba6c21779ec8ade23414e1a1b4df`.
Бриф: [D7-studio-push-review.md](../../tasks/D7-studio-push-review.md).
Одно свежее ревью `/root/d7_studio_push_review` проверило полный diff всех3 файлов; результат передан ведущим.
**Блокеров нет.** Root принял exact7ff1d1c и разрешил обычную доставку в existing PR59.
CDP transport, matching trusted/data, pass-through app waitUntil/rejections и native showNotification сохранены.
Сохранены прежние icon, click, fallback, privacy, login и console assertions; runtime/SW не менялись.
Controlled proof отделён от исторической причины CI: последняя остаётся UNKNOWN.
Неблокирующее: `notifications-worker.e2e.ts:134` — при закрытом worker cleanup.evaluate в finally может скрыть исходную ошибку и пропустить dispose.
По решению root это передано в бэклог; код после ревью не расширялся.
Fullvisual, target14 и build повторно не запускаются. Один штатный pre-push/fullcheck — следующий шаг доставки.
Фактические SHA, результат hook, удалённое совпадение и новый CI фиксируются в PR59 и отчёте ведущему после push.
