# D6: одно статическое ревью общей доставки CI

Свежий ревьюер gpt-6-luna. Только чтение, без тестов/изменений/коммитов/push.
Base `7544510181204a63681d696ca9571c1d36f8ee0b`, candidate **c58237bdf617e83c6f0071dc1bca6b3966d8aee0**.
Worktree `C:\Users\user\.codex\worktrees\d6a-studio-worker-ci\HomeCRM`, branch `fix/studio-worker-push-ci`.

Прочитать AGENTS и diff, D6a/D6b briefs и tracked reports `docs/screenshots/UI-3/d6a-worker-ci.md`, `d6b-offline-ci.md`.
Единственный code diff: shopping-offline.e2e.ts +6/-1 после настоящего offline reload нажимает реальную queue·3 ссылку вместо раннего hash goto; прежний H1 сохранён, добавлены online=false/outbox3/blobs2. LostACK, unknown→confirmed, stableid/frozenbody/exactreceiptparent/Blob cleanup/assertions неизменны. Controlled native-listener gate воспроизводил прежний H1/URL mismatch и с поправкой прошёл весь сценарий, historical CI без trace unknown.

D6b Linux360/4122/2/types/Biome/encoding/diff PASS, не повторять. D6a **evidence-only**, worker/source не менялись: Windowsbaseline отдельно; Linuxbaseline1/1 и реальный single-lifecycle push/privacy PASS; paired contexts own scopes1/foreign0, immediate count после ack не delivery proof. Исторический отказ worker НЕ объявлен исправленным. Новый полный CI обоснован Bfix, не является blind retry старого head.

Проверить scope и сохранность исходного offline/данных/проверок. Никаких timeouts/sleeps/retries/skip/источник runtime не менялся. До15строк: только реальные блокеры и отдельно NB. После отчёта завершиться; повторного общего ревью нет, исправляются только блокеры. Доставку в existing PR59 делает D6a после root acceptance.

## Итог ревью

Ведущий принял агрегированный кандидат `c58237bdf617e83c6f0071dc1bca6b3966d8aee0`: блокеров нет. Неблокирующее замечание только одно: причина исторического D6a push CI отказа неизвестна; отчёт фиксирует диагностику и не заявляет исправление push. Код меняется только в принятом D6b тесте.
