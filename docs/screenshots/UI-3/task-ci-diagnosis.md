# D3c: сохранённый этап диагностики CI дел

Дата: 14 октября 2026. Работа остановлена по команде владельца до сброса лимита 15 октября в 00:41 Екатеринбург. Задача не завершена.

Worktree: C:/Users/user/.codex/worktrees/diagnose-studio-task-ci/HomeCRM
Ветка: fix/ui-3-task-ci-diagnosis
HEAD: 2d50162ae6e469d71f0f7ba08fd372a07195002f (PR58 плюс проверенная Studio font-weight 500).

Исходный бриф сохранён в docs/tasks/D3-studio-task-ci-diagnosis.md. CI38593350826 (исходный PR58 HEAD780fe168): 491 passed / 1 skipped / 2 failed. Checklist w360 не показывает сообщение STALE_VERSION на tasks.e2e.ts:177. Following w360 получает настоящий 409 / STALE_VERSION на строке459; формы1, alert1, Done0, held/delivered snapshots0. Старый main88a7632 также имел эти отказы. При сравнении main88a7632..PR58 для web/tasks, web/offline, server/tasks и tasks.e2e.ts diff пустой.

## Один выполненный узкий прогон

В собственном Linux-контейнере выполнены только два исходных сценария на w360/w412, workers2, retries0, trace=on:
pnpm --filter @homecrm/web exec playwright test e2e/app/tasks.e2e.ts --grep 'создание, чек-лист|серия: область правки' --project=w360 --project=w412 --trace=on

Отчёт Playwright: 4 passed (25.6s). Checklist7.1/7.5s, series6.7/7.3s. Установление причины этим НЕ подтверждено; красный CI не исправлен. Assertions и тесты не менялись. Клиент собран перед прогоном из exact worktree source. Linux image homecrm-test-ui-1-studio:e2e-linux (Playwright1.63.0, Node24), временный PostgreSQL18, own compose homecrm-test-studio-task-ci без постоянных портов.

Техническая неточность оболочки: PowerShell раскрыл Bash $-переменные в double quote; после завершившихся четырёх PASS команда exit получила недопустимое значение и оболочка завершилась1. Исходный тестовый отчёт сохранён; не объявлять этот exit зелёным. При продолжении передавать Bash script через корректную PowerShell single quote; не повторять этот прогон лишь для исправления оболочки.

## Артефакты

Под этим worktree:
- apps/web/test-results/d3c-build.log
- apps/web/test-results/d3c-original.log
- apps/web/test-results/artifacts/app-tasks.e2e.ts-создание--6005f-не-затирает-другой-чек-лист-w360/trace.zip
- apps/web/test-results/artifacts/app-tasks.e2e.ts-создание--6005f-не-затирает-другой-чек-лист-w412/trace.zip
- apps/web/test-results/artifacts/app-tasks.e2e.ts-серия-обл-b1e72-й-преемник-блокирует-отмену-w360/trace.zip
- apps/web/test-results/artifacts/app-tasks.e2e.ts-серия-обл-b1e72-й-преемник-блокирует-отмену-w412/trace.zip

Trace только вымышленной семьи. Не печатать cookies/пароли/ключи; при анализе выводить только версии, HTTP status/code, operation и состояние формы/очереди. Производственное окружение не трогалось. Временный own compose удалён, trace остаются на host. Исходный source не менялся; коммитов/push/fullcheck нет.

## Гипотезы и следующий ограниченный шаг

1. mutateTask в web/tasks/api.ts снимает receipt и оставляет миллисекундный DTO updatedAt; GET snapshot заменяет его точной PostgreSQL версией. Форма, открытая немедленно после PATCH до void refresh, может захватить DTO миллисекундной точности. exactVersion не найдёт совпадающий snapshot, пока 300ms autosave ещё не сохранил DraftEnvelope. Предсказание для checklist: сетевого PATCH нет, локальный EXACT_VERSION_REQUIRED; внешняя чужая правка и локальный ввод сохранены.
2. useDurableDraft autosave не отменяет начавшуюся async запись при clearDraft/unmount. Поздний write может вновь записать старую draft.base. Предсказание для following: request expectedUpdatedAt=V1, actual DB/card V2, восстановленный draft baseV1 и настоящий409.
3. Поздний GET подменяет Query cache после мутации. Предсказание: stale snapshot/card при отсутствии старого draft.

Причины пока НЕ доказаны. Следующий этап — прочитать сохранённые trace, затем при необходимости только управляемые пробы с одной изменённой переменной, безопасные метки PATCH expectedUpdatedAt/offline/receipt.version, DTO updatedAt, exact DB version, draft envelope base и snapshot/outbox state перед Save. Для (1) удержать post-mutation refetch и выполнить Save до autosave; для (2) управляемо задержать autosave на его границе и проверить восстановление старой базы. Предварительно согласовать точную область application-fix с ведущим: возможные tasks/api.ts или offline/drafts.ts, без серверных validation/retries/тайм-аутов/ослабления conflicts. Не делать полный набор; max2 исполнителя/1 fullcheck. Normal PR58push пока запрещён до итогового объединённого исправления.

## D3c: продолжение после лимита, 15 октября

Исходные 4/4 не повторялись. Сохранённый trace подтверждает: checkbox PATCH DTO ...51.550Z, exact receipt ...51.550498Z; GET snapshot содержит точную версию. Passing following отправлял DTO milliseconds ...49.028Z при DB/receipt ...49.028237Z.

Детерминированная precision-проба на exact2d50162: один checkbox PATCH200, post-mutation refetch удержан, browser clock закрывает только300ms debounce autosave. 0ms уведомление Query обработано clock.runFor10ms. SnapshotV1 2026-10-14T19:46:30.238528Z; receipt/DBV2 2026-10-14T19:46:31.158412Z; DTO V2 2026-10-14T19:46:31.158Z; drafts пусты/outbox confirmed. Внешний PATCH200 даёт DBV3 2026-10-14T19:46:31.448910Z. Save формы НЕ создаёт сетевого PATCH, alert LOCAL EXACT_VERSION_REQUIRED. Оба checklist сохранены. Проба 1/1 PASS, 3.4s, suite9.9s. Это воспроизводит отсутствие ожидаемого сетевого конфликта, но CI trace отказа отсутствует: причинную связь именно с историческим CI не объявлять окончательной.

Команда: pnpm --filter @homecrm/web exec playwright test e2e/app/d3c-precision-probe.e2e.ts --project=w360 --trace=on --output=test-results/d3c-precision-artifacts-v2
Артефакты: apps/web/test-results/d3c-precision-v2.log; apps/web/test-results/d3c-precision-artifacts-v2/app-d3c-precision-probe.e2-24f06-t-preserves-both-checklists-w360/trace.zip.
Первый вариант harness остановился до целевого Save: paused clock не доставил Query0ms notification, checkbox оставался unchecked; уточнён лишь harness runFor10ms, приложение не менялось. Этот след в d3c-precision.log и d3c-precision-artifacts — не считать воспроизведением CI.

Shell теперь передаётся через корректную PowerShell single quote, Bash result=$? / exit $result не раскрываются PowerShell; вторая проба exit0.
Runtime homecrm-test-studio-task-ci-probe-runtime сохраняется для следующей узкой autosave-пробы: /workspace production build exact2d50162 уже готов; новый build/install не требуется.

## Доказанная гонка autosave / following

На готовом runtime2d50162, без build/install/повтора исходных4/4: только native IDB identity.get success первого autosave задержан на его границе requestTicket. Гейт сработал ровно300ms; значение/версия draft вручную НЕ подменялись.

V1/исходная база: 2026-10-14T19:52:03.258907Z.
Первый обычный PATCH offline:true: expectedV1, HTTP200; DTO ...19:52:04.218Z, receipt и actual DBV2 2026-10-14T19:52:04.218278Z.
После clearDraft и закрытия формы таблица drafts пуста.
Освобождение ранее начавшегося autosave ПОСЛЕ unmount вновь создаёт draft.base=V1.
Следующий Edit восстанавливает эту старую base; following PATCH отправляет expectedV1, offline отсутствует, получает настоящий409 / STALE_VERSION при DBV2. Новый локальный ввод и серверная первая правка сохранены; actual DBV2 не меняется от отвергнутого PATCH.
Следовательно, clearDraft не отменяет уже начатую async-запись useDurableDraft. Сам STALE_VERSION не ложный для отправленной старой базы; ошибка — восстановление черновика, который Save уже подтвердил и очистил.

Команда: pnpm --filter @homecrm/web exec playwright test e2e/app/d3c-autosave-probe.e2e.ts --project=w360 --trace=on --output=test-results/d3c-autosave-artifacts-v2
Итог: 1/1 PASS,3.5s, suite9.1s, exit0.
Артефакты: apps/web/test-results/d3c-autosave-v2.log и apps/web/test-results/d3c-autosave-artifacts-v2/app-d3c-autosave-probe.e2e-0dceb--base-after-successful-edit-w360/trace.zip.
Первый вариант этого harness остановился до целевой проверки: paused clock не доставил Query0ms notification после async Save. Уточнён только порядок: дождаться form0, затем runFor10ms. Следы d3c-autosave.log и d3c-autosave-artifacts сохраняются как неуспешная настройка harness, не отдельный баг приложения.

## Предлагаемая минимальная функциональная правка (НЕ реализована)

Область: только apps/web/src/tasks/TaskScreen.tsx и apps/web/src/offline/drafts.ts, плюс два узких регрессионных теста на корректной границе. Это исправления прежнего пилота за пределами чистого оформления Studio; включение определяет владелец/лид отдельно.

1. TaskView: кнопку «Править дело» перевести с непосредственного setEditing(card) на beginEdit. beginEdit получает await fetchTask(card.id, signal) и открывает TaskForm именно с возвращённой coherent карточкой/snapshot. Не брать точную version из receipt отдельно от данных. До принятия результата проверить тот же аккаунт через ME_KEY, отсутствие abort и живой компонент; при смене аккаунта/unmount abort. Блокировка/ref против повторного открытия, disabled пока loading или operation.pending; ошибку показать через существующий operation.setError. Query card можно принять тем же complete snapshot. Изменять серверную version validation, operation replay, request bodies не нужно.
   Online: snapshotRequest получает карточку и exact versions в том же согласованном GET и сохраняет до возврата. Offline: существующий loadSnapshot возвращает сохранённые согласованные данные; новая запись/правка ещё без snapshot остаётся защищена существующей ошибкой. Idempotent replay: предыдущая receipt может бытьV1, актуальный DTO V2 — fresh/coherent GET на входе в Edit не смешивает их. Утилизация cached snapshot не должна заменяться притворной точной версией.
2. Второй effect useDurableDraft (debounced autosave): local active=true; cleanup ставит active=false вместе с clearTimeout. После await requestTicket и непосредственно перед offlineDB.drafts.put в transaction проверить active; устаревший callback заканчивается без записи. Guard перед put располагается ПОСЛЕ всех await exists/quota/count. UI setProblem делать только если active. Если запись уже начата до clearDraft, текущая сериализация transactions даёт delete после неё; если продолжение возобновляется после unmount, guard не даёт воскресить очищенный draft. Такой guard также отбрасывает устаревшую autosave старого value при очередной правке.
   Не изменять ошибку409 на успех, не удалять conflict outbox, не менять сохранённую base на свежую автоматически, не добавлять retry/тайм-ауты.

После отдельного разрешения на functional scope: свежий исполнитель превращает два controlled harness в целевые регрессии (пробы до fix должны воспроизводить failure), делает узкую правку и подтверждает сохранность чужого checklist/локального ввода. Проверки — только эти причины/две исходные ширины; обязательный normal hook+CI один финальный раз по плану лида, без push --no-verify.

## Финальное сохранение диагностики

Приложение/исходные tests не менялись; коммитов/push/fullcheck нет. Временные harness перемещены из e2e/app в ignored apps/web/test-results/d3c/harness для продолжения; перед запуском нужно копировать обратно в e2e/app из этого debug location. Собственный compose homecrm-test-studio-task-ci/runtime удалён; trace/logs сохраняются на host. Runtime пересобирать только после реальных frontend source изменений. Исторические CI-причины без failure trace не подтверждаются абсолютным отождествлением: воспроизведены две реальные причинные гонки того же неизменённого пилота и те же внешние симптомы, потери/подмены чужих данных не обнаружено.
