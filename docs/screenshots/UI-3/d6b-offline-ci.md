# D6b. Очередь после настоящей offline-перезагрузки

Требования: PRD, раздел 13 «Без сети»; UTIL-7, [offline UI](../../shopping-offline-ui.md) и [ADR-0041](../../adr/0041-shopping-offline-receipts.md).
Бриф: [D6b-studio-offline-ci.md](../../tasks/D6b-studio-offline-ci.md).
База: `7544510181204a63681d696ca9571c1d36f8ee0b`; ветка `fix/studio-offline-shell-ci`.
Проверенный файл: `apps/web/e2e/app/shopping-offline.e2e.ts`, Git blob `7e6681d94da8c0db6561f1cd6954511e8c3739ce`.
SHA-256 файла: `3af82e88e75cd326357a514dcfe11c1b5421b94c65e8ce690d1a431db310b666`.

## Исходный отказ и baseline

[CI38664226523](https://github.com/gidraq-jpg/HomeCRM/actions/runs/38664226523): check SUCCESS, Linux 505 passed / 1 skipped / 2 failed.
В этой задаче рассматривается только w412 shopping-offline.e2e.ts:418: после offline Save двух настоящих PNG и reload первый queue:103 не находит H1 «Очередь изменений» за 5000 мс, до первого multipart lost ACK.
Другой отказ worker принадлежит D6a. Исторического trace нет: точная последовательность CI не восстановлена.

Исходный --list выбрал ровно 1 тест. Один неизменённый Linux/w412 baseline прошёл 1/1: test 5.6 с, suite 11.5 с.
Зелёный исходный сценарий сериями не повторялся.
Гипотезы по порядку: native hash-переход раньше подписки HashRouter; cached identity hydration; неполная SW shell.
Первая временная проба через Scheduler/History.state удержала экран «Открываем HomeCRM», а не нужное окно подписки; упала на собственном toBeEmpty и не считается воспроизведением CI.

## Управляемое доказательство

В отдельном временном тесте сохранены настоящий сервер, PostgreSQL, browser session, IndexedDB, offline/reload, два настоящих PNG и Save.
Тест откладывал только нативную регистрацию startup popstate через addInitScript; после реального reload прежний page.goto переводил hash в очередь, затем обработчик регистрировался.
Состояние непосредственно перед исходным H1 assertion:

```text
url=/homecrm/prototype/v1/#/more/offline
h1=Вымышленная квартира
online=false; controller=true
ownerMatchesAdult=true; cachedMePresent=true
generation=1; verified=false; locked=false
outbox=3; blobs=2; heldPopstateListeners=1; released=true
```

Исходный H1 assertion упал тем же timeout 5000 мс: test 8.8 с. Кэш, identity и намерения сохранены, Router продолжает показывать прежний экран.
Локальный HashRouter 8.4.0 фиксирует history.location в useState, а history.listen устанавливает в useLayoutEffect; native переход до подписки может потеряться.
Управляемая задержка иллюстрирует этот возможный порядок, а не доказывает, что он произошёл в историческом CI.

Под тем же gate тест вместо немедленного goto нажал реальную ссылку «Очередь изменений · 3».
До release он увидел правильные URL и H1, online=false, controller=true, adult owner, 3 намерения и 2 Blob.
После release полностью прошли multipart lost ACK, batch lost ACK, reload/replay и исходные receipt assertions: 1/1, test 4.5 с, suite 9.7 с.
Временные gate/диагностика в постоянный тест не добавлены.

## Принятая поправка

Ведущий принял только test-only delta после первого reload этого target:
ссылка очереди ждёт готовый интерфейс и 3 durable намерения, затем выполняет штатный Router-переход; прежний H1 assertion сохранён.
Добавлены явные post-reload online=false, outbox 3 и blobs 2.
Другие queue/sync вызовы сохранены. Реальные offline/reload/фото/lost ACK, unknown→confirmed, stable batch ID, frozenBody, exact receipt.parent, удаление Blob только после подтверждения и единственный серверный отсчёт с двумя фото остаются обязательными.
Sleep, retries, skip и увеличение timeout не добавлены; сеть включается в прежней точке после установки lost-ACK route.

## Проверки и воспроизводимость

Финальный --list: ровно 2 теста. Обычный Linux target w360/w412 — 2/2 PASS, 5.4 с / 5.4 с, suite 13.0 с.
Оба target выполняют прежние axe, 44 px/nooverflow проверки и Linux screenshot offline-reading.
Web/e2e TypeScript, Biome изменённого теста, pnpm check:encoding и git diff --check — PASS.
Логи и временные sanitized пробы: `apps/web/test-results/d6b/` в собственном worktree; baseline.log, probe.log, probe-route.log, probe-fixed.log, final.log.
Проверенные Linux PNG: `apps/web/test-results/d6b/screens/w360/offline-reading.png` и `screens/w412/offline-reading.png`; просмотрены локально.
Они игнорируются Git; trace, auth headers, cookies и дампы session/env не создавались.

```sh
pnpm --filter @homecrm/web exec playwright test e2e/app/shopping-offline.e2e.ts --grep "настоящие два фото" --project=w360 --project=w412 --output=test-results/d6b/final-artifacts
pnpm --filter @homecrm/web typecheck
pnpm exec biome check apps/web/e2e/app/shopping-offline.e2e.ts
pnpm check:encoding
git diff --check
```

Переиспользована оболочка runtime `770480f7e47217f19a9b6ec62b285418bbeb7390`, source diff 770→base для apps/web/src, apps/server/src и packages пустой.
Image: `sha256:6e614289891fa119b3066ccf423744fc7ed7bf38327be5d0832af83611172b84`.
SHA-256 dist/index.html: `cfee229f4f2c85875fb9b59c775abaaafcd15a24f00c857e52311dced59ebf5d`.
Runner image `homecrm-test-ui-1-studio:e2e-linux` с отдельными checkout/deps; PostgreSQL 18, tmpfs, random host port, собственная сеть/контейнеры `homecrm-test-d6b-offline-*`.
Новых build/fullcheck/fullvisual/push/PR не было. Доставку общего коммита выполняет D6a после приёмки.

## Границы и бэклог

Runtime source/SW/shared fixtures, сервер, схема/RLS/access, контракт409, зависимости, CI/deploy и рабочее окружение не менялись.
Управляемый corner раннего native hash/popstate до hydration передан ведущему для бэклога; runtime этого corner здесь не исправлен.
CI/реальные Android/PWA не проверялись этой задачей. Собственный тестовый контур удалён после сохранения evidence: три контейнера и сеть отсутствуют. Рабочие homecrm, данные, порты 8300/8301/8309 и чужие worktree не затронуты.
