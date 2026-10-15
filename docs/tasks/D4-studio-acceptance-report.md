# D4 — итоговая приёмка Studio
Статус: READY к отдельному выпускному шагу; фактический выпуск не выполнялся.
Final main/primary/remote: `9c1eedad8e8418790a0795567261d078418ff50e`; final CI [38675550366](https://github.com/gidraq-jpg/HomeCRM/actions/runs/38675550366) — SUCCESS.
CI: 191 test files, 1,639 passed (847.15 s); Linux E2E: 507 passed, 1 skipped из 508 (26.3 min).
CI screenshots artifact: `11947060650/auth-screens-360-412`, 115,293,422 bytes, не истёк на момент отчёта.
PR59 CI `38673461119` зелёный; tree PR59 = final main. Runtime source `770480f7e47217f19a9b6ec62b285418bbeb7390` и Docker build inputs совпадают с main.
Immutable image: `homecrm-app:v0.5.1-pilot.1`, `sha256:6e614289891fa119b3066ccf423744fc7ed7bf38327be5d0832af83611172b84`; canonical Docker build успешен.
Клиентские assets: 6 локальных Roboto WOFF2; PWA manifest/service worker, 19 precache entries. Build warnings: крупный JS chunk и deprecated `inlineDynamicImports`.
Визуальные proof: Linux UI-2 360/412 и desktop 1280 (`docs/screenshots/UI-2`); UI-3 представители 360/412 и analytics 1280 (`docs/screenshots/UI-3`); design QA (`docs/design/qa`).
Контракт подтверждён: приветствие/имя/дата/показатели, логотип и шапка, Studio palette, светлая Today-панель, 360/412 dock, desktop side-nav, основные формы/карточки.
Axe proof в целевых UI-1/2/3 отчётах: нет serious/critical; заявлены цели ≥44 px и no horizontal overflow на 360/412. Physical Android/PWA/push не проверялись.
Console fixture для импортирующих её сценариев ловит unhandled `pageerror`, unexpected `console.error` (кроме Failed to load resource), external requests и failed static assets; это не покрытие всех маршрутов/сообщений.
Backup: локальный restore-check PASS — 80 таблиц, 22,699 строк, 65 миграций, без pending. Облачную копию временно разрешено не требовать; настройки backup не менялись.
Production остаётся `v0.5.0-pilot.1`; deploy/release не выполнялись и требуют отдельного шага по прямой команде владельца.
