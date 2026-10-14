# D3d: поправка базы Edit и позднего autosave для Studio

15 октября 2026. Основа — exact объединённый кандидат `fb219eab495ff4771b9cdd04fdcf0ce98103a6de`.
Worktree: `C:/Users/user/.codex/worktrees/fix-task-version-coherence/HomeCRM`, ветка
`fix/task-5-studio-version-coherence`. Принятый docs-only D3c commit `85fb6f7` перенесён
обычным cherry-pick как `0ca2921`; [доказательства исходных гонок](task-ci-diagnosis.md) сохранены.
Лид проверил final source `770480f7` и принял узкую поправку двух доказанных клиентских
блокеров в пределах утверждённого перехода на Studio с сохранением данных и действий.
Разрешена штатная доставка в PR58: normal push с pre-push, затем CI точного head.
Результат hook и статус CI фиксируются в описании PR58; новых app/test изменений при доставке нет.

## Изменение

- TaskScreen отменяет незавершённый query только этой карточки и получает целый `fetchTask`
  перед открытием Edit. Текст и exact версия принадлежат одному snapshot; квитанция отдельно
  в DTO не подставляется. Сохраняется штатное офлайн-чтение и восстановление старого черновика
  с его исходной базой либо явным решением о legacy draft.
- После await проверяются abort, актуальный аккаунт и `canWrite` по актуальному Me и свежей
  карточке. На смене аккаунта/карточки компонент меняется; unmount отменяет запрос.
  Ошибка загрузки оставляет доступным повтор через «Править дело», форму по старой базе не открывает.
- Cleanup autosave отменяет таймер и делает начатый writer устаревшим. Guard стоит после
  requestTicket и после всех чтений identity/draft/quota непосредственно перед put.
  clearDraft отменяет writers этой вкладки и аккаунта после успешного requestTicket, до DELETE:
  локальный Map owner+formKey содержит отмены текущих effect, cleanup удаляет регистрацию.
  Owner регистрации — me.id уже принятого UI, включая случай ошибки первого restore;
  это метка, а не авторизация: ticket.owner сверяется с captured me.id и assertIdentity сохранён.
  Запись, уже начавшая put до cleanup, остаётся в сериализации IDB: последующий clearDraft
  удаляет её. Ошибки активной формы остаются видимыми, identity fence сохранён.
- В исходном series e2e общая удержанная RW-транзакция заменена задержкой native drafts.get
  onsuccess: старый gate блокировал новый coherent GET до появления формы. Assertions
  disabled/restore/following, серверных статусов, undo и snapshot cleanup сохранены; release — в finally.

## Проверки

Только вымышленная семья, Linux Playwright 1.63.0 / Node 24, одноразовый PostgreSQL 18 на tmpfs,
собственный compose `homecrm-test-d3d-task-version`, без постоянных портов. Контур удалён после проверки.

24 уникальные проверки на 360/412 по последнему релевантному результату, повторы не суммируются:

| Группа | Результат |
|---|---|
| Новый controlled precision: удержан background GET, Save до autosave; exact V2 → сетевой 409 после внешнего V3, оба checklist сохранены | 2/2 |
| Новый controlled autosave: настоящий requestTicket задержан; release после unmount и между committed DELETE/cleanup не воскрешает draft; following отправляет текущую базу и получает 200 | 4/4 |
| Новые границы Edit: офлайн-снимок/missing/retry, HTTP 403/404 без подмены кэшем, поздний результат после перехода | 4/4 |
| Новая активная форма: искусственный QuotaExceededError виден, ввод сохранён; следующий autosave успешен | 2/2 |
| Два исходных сценария tasks: checklist conflict и series/following/undo | 4/4 |
| Существующие узкие offline сценарии: повторный ввод/reload, V1 после GET V2, явное решение legacy base, account A→B | 8/8 |

Прогон final TaskScreen source: **16/16**, 50.6 с, exit0. `apps/web/test-results/d3d/final-boundaries.log`
и `final-artifacts/` — локальные ignored доказательства. Команда:

```text
pnpm --filter @homecrm/web exec playwright test e2e/app/task-edit-coherence.e2e.ts e2e/app/tasks.e2e.ts e2e/app/shopping-offline.e2e.ts --grep "Edit читает офлайн|Edit не заменяет HTTP|ошибка autosave|серия: область правки|повторный ввод черновиков|B1: восстановленный ввод|B1: старый черновик|B5: window sender" --project=w360 --project=w412 --trace=on --output=test-results/d3d/final-artifacts
```

Controlled 4/4 и исходный checklist 2/2 проверены на первой source-сборке. Затем добавлены три
строки применения актуального Me после await; с разрешения лида собран final source и повторены
только затронутые границы/упавшие harness. Эти шесть проверок повторно не запускались.
Первая команда `coherence.log` завершилась exit1: 8 PASS, 4 FAIL из-за слишком широкого offline
alert locator и блокирующего RW restore gate. После их уточнения `harness.log` — 4/4, exit0;
затем те же проверки включены в final 16/16. Assertions не удалялись.

`pnpm test:changed` — **4 файла, 33/33**, exit0. Web/e2e TypeScript, Biome четырёх изменённых
TS/TSX и UTF-8 — прошли. Production сборки: initial source, разрешённый Me guard,
восстановление неизменённого a401c43 для отдельной пробы и разрешённый final drafts writer cancel.
На двух новых controlled экранах и исходных tasks сценариях axe, nooverflow и 44 px — прошли.
Скриншоты новых экрана конфликта и карточки following сняты только Linux, визуально проверены:
[360 conflict](d3d/w360/task-edit-exact-conflict.png), [412 conflict](d3d/w412/task-edit-exact-conflict.png),
[360 following](d3d/w360/task-edit-following-current.png), [412 following](d3d/w412/task-edit-following-current.png).

## Дополнительное окно clearDraft до React cleanup

При blocker review выявлен зазор: clearDraft уже удаляет строку, но onSuccess ещё не закрыл форму,
и одного cleanup guard недостаточно. На неизменённом локальном a401c43 один controlled Linux/w360
сценарий задержал доставку React Scheduler MessageChannel(null) после native drafts.delete success
и освободил ранее удержанный autosave ticket. Сериализованный IDB read подтвердил старый draft
после DELETE при ещё существующей форме: deletion=true, blockedMessages=1, forms=1.
Проба — **1/1**, 3.5 с, suite 10.0 с, exit0. Source приложения не инструментирован;
`apps/web/test-results/d3d/clear-window.log`, `clear-window-artifacts/` и ignored
`harness/d3d-clear-window-probe.e2e.ts` сохранены локально.

После разрешения лида добавлена описанная выше transient регистрация отмены в drafts.ts.
Permanent autosave regression проверяет оба момента release. Во втором варианте native oncomplete
только одной clearDraft-транзакции задержан уже после её реального COMMIT: форма ещё mounted,
IDB доступна, поздний writer освобождён, таблица drafts остаётся пустой. После release clearDraft
следующий Edit/following использует exact текущую базу и получает 200.

Final drafts source — **10/10 по последним релевантным результатам**: оба окна autosave 4/4,
quota/recovery активной формы 2/2, повторный ввод/reload 2/2 и account A→B 2/2.
`writer-boundaries.log` сначала дал exit1, 8 PASS / 2 FAIL: gate по ошибке удерживал также
второе clearDraft после following, хотя drafts0 и PATCH200 уже прошли. Gate сделан одноразовым;
повторены только две эти проверки: `clear-regression.log` — **2/2**, 11.5 с, exit0,
`clear-regression-artifacts/`. Остальные зелёные проверки не повторялись.

```text
pnpm --filter @homecrm/web exec playwright test e2e/app/task-edit-coherence.e2e.ts e2e/app/shopping-offline.e2e.ts --grep "TASK-5: autosave|ошибка autosave|повторный ввод черновиков|B5: window sender" --project=w360 --project=w412 --trace=on --output=test-results/d3d/writer-artifacts
pnpm --filter @homecrm/web exec playwright test e2e/app/task-edit-coherence.e2e.ts --grep "TASK-5: autosave after-clear-before-unmount" --project=w360 --project=w412 --trace=on --output=test-results/d3d/clear-regression-artifacts
```

## Границы

Лид разрешил одну штатную отправку PR58 с общим check в pre-push и независимым CI.
Merge/deploy/tag не входят в доставку. Телефоны/рабочее окружение не проверялись.
При закрытии до завершённого autosave остаётся только предыдущий durable черновик; flush при
navigation не добавлен. Сохранённый старый draft не ребазируется автоматически.
409 остаётся конфликтом; outbox/receipt/undo/replay контракт не изменён.
Историческая последовательность красного CI без failure trace не установлена: исправлены
две доказанные управляемые гонки прежнего пилота.
