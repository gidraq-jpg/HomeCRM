# TASK-7. Завершение перехваченных запросов в B2

## Наблюдения

- CI 38636595469 на HEAD `8070b1d`: `pnpm check` прошёл; e2e завершился с 506 успешными сценариями, одним пропуском и одним отказом. Отказ — B2 card на 412 px: `route.fetch: Test ended while running route callback` в `tasks-review.e2e.ts:149`.
- Санитизированный фрагмент CI фиксирует незавершённый `route.fetch` при завершении теста. Он не показывает, сколько callbacks выполнялось и в каком порядке они начались.
- На том же HEAD локальный Linux Playwright прогон только B2 card/412 завершился успешно (1/1). Это не воспроизвело исторический CI отказ.
- Controlled B2 card/412 probe после успешной проверки `undoRequests === 1` и до release gate увидел 8 ещё отслеживаемых routing callbacks. Сценарий прошёл после release; это подтверждает наличие незавершённой работы у harness, но не доказывает, что все восемь callbacks выполняли `route.fetch` или что таков был порядок в CI.

## Изменение harness

Тест сохраняет promises собственных route callbacks, а в `finally` освобождает gate, снимает только установленный им handler и ждёт уже запущенные callbacks. Ошибки callbacks остаются отклонёнными и видны Playwright. Порог ожидания, retries и существующие undo/API/UI assertions не меняются.

## Граница доказательства

Конкретный триггер CI, включая предполагаемые несколько параллельных `route.fetch`, локально не установлен. Исправление закрывает lifetime перехватчика в harness при teardown и не меняет приложение или контракт TASK-7.

## Проверки финального изменения

- B2 all/card на 360 и 412 px в Linux Playwright: 4/4.
- `pnpm --filter @homecrm/web typecheck`, Biome для изменённого e2e-файла, `pnpm check:encoding` и `git diff --check`: успешно.
- Полный `pnpm check` и pre-push hook отложены до проверки delta ведущим.
