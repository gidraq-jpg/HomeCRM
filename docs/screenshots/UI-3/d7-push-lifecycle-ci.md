# D7. Завершение настоящего push в тестовом helper

Требования: NOTIF-1, NOTIF-6, NOTIF-7. Бриф: [D7](../../tasks/D7-studio-push-lifecycle-ci.md).
База `7ac9c8a7c1f4ba6c21779ec8ade23414e1a1b4df`; ветка `fix/studio-push-lifecycle-ci`.
Изменён только `apps/web/e2e/app/notifications-worker.e2e.ts`; runtime/SW не менялись.

## Исходные факты и граница вывода

По уточнённому excerpt ведущего [CI38668920621](https://github.com/gidraq-jpg/HomeCRM/actions/runs/38668920621): `pnpm check` SUCCESS, Linux 506 passed / 1 skipped / 1 failed.
Отказ w412 в normal-сценарии начинается на строке115, но assertion падает на222: последний `gone` push не появился за штатные5000мс.
До него прошли обычный push, замена по тегу, пустые/неразборчивые данные, privacy-text, два notificationclick и переход на readings.
Предыдущий CI38664226523 упал на первом privacy-push w360. Trace с lifecycle ни для одного отказа нет.
**Историческая причина UNKNOWN.** Управляемая задержка ниже показывает допустимый порядок и пробел тестовой синхронизации; она не доказывает этот порядок в CI.

Первый selector `--grep "^сервис-воркер: push показывает" --list` дал0: grep сопоставляет полный идентификатор с файлом. Ошибка selector не замалчивается.
Затем единственный неизменённый Linux baseline normal/w412 с grep без `^` выбрал и выполнил1 тест: PASS, test4.3с / suite11.1с. Исправленный `--list` подтвердил1 после этого запуска; требуемый порядок list1→baseline был нарушен. Baseline не повторялся.

## Проверенная API-семантика

Context7: [CDP ServiceWorker](https://chromedevtools.github.io/devtools-protocol/tot/ServiceWorker/) описывает `deliverPushMessage` как доставку регистрации, без результата обработки.
В [официальном Chromium source](https://github.com/chromium/chromium/blob/main/content/browser/devtools/protocol/service_worker_handler.cc#L402) `ServiceWorkerHandler::DeliverPushMessage` вызывает `browser_context_->DeliverPushMessage(..., base::DoNothing())` и сразу возвращает `Response::Success()`.
Это подтверждение постановки доставки, а не dispatch, `ExtendableEvent.waitUntil` или завершение native `showNotification`.
Установленные Playwright1.63.0 CDP types: пустой `deliverPushMessageReturnValue`, отдельные registration/version lifecycle events; Worker.evaluate/evaluateHandle ожидают возвращаемый Promise.

## Controlled failure и проверка исправления

Временный probe сохранил настоящий Chromium, сервер/PG, все прежние push/click/переходы normal-сценария.
Перед последним gone-push только временная gate задержала вызов native `ServiceWorkerRegistration.prototype.showNotification`; после release вызывается исходный native метод с исходными аргументами.
После CDP ack исходный poll `shown.some(goneTag) === true` действительно отвергся с `Timeout 5000ms exceeded`.
Санитизированное состояние: `dispatched=1; trusted=true; waits=1; completed=false`.
Release → тот же native promise завершился (`completed=true`) → уведомление найдено и прежний gone-click/route прошли. Probe1/1 PASS: test8.3с / suite13.5с.

С тем же gate и порядком исправленный helper был armed и оставался pending до release; исходный standalone poll всё ещё отвергся за5000мс.
После release helper дождался настоящего `waitUntil`, native уведомление и исходные assertions прошли:1/1 PASS, test7.9с / suite13.2с.
На всех7 доставках fixed-probe:1 live-регистрация,1 версия `activated/running`, `registration.active.state=activated`. Замена/устаревание версии в этом порядке не наблюдались.
Обе gate-пробы и их fake instrumentation существуют только в ignored `test-results/d7/probe*.e2e.ts`; в постоянном тесте gate и замены showNotification нет.

## Принятая test-only delta

`push()` до CDP отправки вооружает observer следующего matching **trusted** PushEvent с точным data только в памяти.
Observer передаёт каждый вызов app `waitUntil` исходному native методу и собирает только переданные приложением Promise; собственного waitUntil/keepalive он не добавляет.
Нужно хотя бы1 app Promise. Нулевой count вызывает ошибку; rejected Promise пробрасывается; неправильное/недоставленное событие не завершает ожидание и падает по существующему test deadline.
После matching dispatch восстанавливается prototype и снимается listener. В `finally` cleanup повторяется, включая CDP error, затем JSHandle с временными data/closure освобождается.
Native showNotification и CDP transport сохранены. Дублированный normal-setup переведён на тот же helper; includeIcon сохраняет прежнее exact icon assertion.
Все прежние notification/dedupe/fallback/privacy/login/click/console assertions сохранены. Таймауты, retries и skip не менялись; новые sleep/catch-ignore не добавлены.

## Финальные проверки

Финальный `--list`:14 существующих тестов,7×w360 и7×w412. Единственный полный прогон этого файла: **14/14 PASS**, suite28.6с,2 workers, exit0.
Web/e2e TypeScript и Biome изменённого файла (Linux), `pnpm check:encoding` (свой managed worktree), `git diff --check`: PASS.
Первая попытка encoding в Linux archive завершилась инфраструктурной ошибкой `not a git repository`; фактическая проверка в собственном Git worktree прошла. Запуск pnpm там автоматически восстановил582 уже закреплённых зависимостей из локального store; lockfile/manifest не изменились.
Ignored stdout/list/exit: `test-results/d7/final.log`, `final-list.log`, `final-exit.txt`; probes рядом. Эти логи не содержат auth/cookies/env/payload; в диагностике только lifecycle/count/boolean.

Использованы собственные `homecrm-test-d7-*` контейнеры/сеть: PG18 tmpfs/random host port, `SHOW max_locks_per_transaction=512`; runner `homecrm-test-ui-1-studio:e2e-linux` (Node24.21.0, pnpm12.9.1, Playwright1.63.0).
Готовый image `sha256:6e614289891fa119b3066ccf423744fc7ed7bf38327be5d0832af83611172b84`, dist/index.html SHA256 `cfee229f4f2c85875fb9b59c775abaaafcd15a24f00c857e52311dced59ebf5d`, runtime source770 переиспользован без build.
Новых fullcheck/fullvisual/push/PR пока нет: HOLD до одного свежего ревью/приёмки. После принятия — доставка в existing PR59 одним штатным hook/push по команде ведущего.
Реальные Android/PWA/push и полный CI здесь не проверены; рабочее окружение, owner data, 8300/8301/8309 и чужие worktree не затронуты.
Собственные временные D7 runner/PG и сеть удалены после финальной проверки; выборки контейнеров/сетей homecrm-test-d7 пустые.
