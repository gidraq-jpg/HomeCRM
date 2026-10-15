# D6a: диагностика push в service worker

- Исходная точка: `7544510181204a63681d696ca9571c1d36f8ee0b`; ветка `fix/studio-worker-push-ci`.
- CI run `38664226523`, job `Вход · 360 и 412 px · axe`: в `notifications-worker.e2e.ts:245` ожидалось одно уведомление, `getNotifications()` вернул пустой список после штатного 5-секундного poll. Остальные шесть worker-сценариев w360 прошли, а этот же сценарий прошёл в w412.
- Артефакт `11940694018` содержит скриншоты; trace с состоянием worker отсутствует.
- В собственном Linux runner (Playwright image `2ca6bc5e…`, PostgreSQL 18 `max_locks_per_transaction=512`, приложение взято из готового image `6e614289…`, без rebuild) точный `--list` выбрал один тест.
- Отдельный Windows baseline w360 прошёл 1/1, но не считается Linux evidence. Единственный Linux baseline w360 прошёл 1/1 за 9,4 с; ни один не объясняет CI timeout или доказывает flaky.
- Контролируемый Linux lifecycle probe: `ready → CDP observer → enable → registration event → active worker → push → notification`. Worker `/sw.js`, оба состояния `activated`; после разрешившегося push в `getNotifications()` была одна запись. Общие title/body, tag/data совпали с приватным контрактом; ошибки консоли страницы и worker — 0.
- Дополнительное наблюдение: немедленное чтение списка регистраций сразу после `ServiceWorker.enable` ещё не видит асинхронный CDP event. Текущий `connectWorker` уже ожидает регистрацию и уведомление через poll, поэтому это наблюдение не устанавливает причину CI отказа.
- Проверка гипотезы cross-context scope: один Linux probe с двумя BrowserContext и двумя вымышленными origin показал для каждого page-CDP session ровно одну live-регистрацию своего origin, 0 чужих scope и activated version для своей регистрации; console errors — 0. Немедленный снимок `getNotifications()` после CDP ack был 0/0, поэтому этот probe не подтверждает завершённую paired delivery.
- Код и privacy/console assertions не менялись. Timeout, sleep, retries и skip не добавлялись; вывод cookies и содержимого записей отсутствует.
- Вывод: cross-context scope гипотеза не подтверждена; blocker причина остаётся неизвестной, имеющихся данных недостаточно для test-only правки. Для следующего точечного разбора нужен sanitizer-only lifecycle snapshot на CI: registration/version state, worker script path/state, факт ответа push и количество показанных уведомлений.
- Следующий шаг по брифу: дождаться решения root; push и full check остаются HOLD.
