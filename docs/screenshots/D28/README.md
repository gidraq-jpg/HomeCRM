# D28 — движение Studio

Материалы сняты в Linux, Chromium из Playwright 1.63.0, на вымышленной семье. Ширины — 360 и 412 px; снимки — с `animations: 'disabled'`. Перед axe и геометрией ожидается `animation.finished` конечных анимаций; бесконечное мерцание загрузки не блокирует ожидание.

- `tasks-360.png`, `tasks-412.png` — короткий свайп открыл доступную кнопку «В корзину» шириной 104 px.
- `sheet-360.png`, `sheet-412.png` — нижний лист с ручкой.
- `navigation.webm` — переход в карточку, назад, лист и системная история.
- `swipe.webm` — свайп, клавиатурное действие, отмена и выполнение.

Повторить в отдельном compose-проекте, не затрагивая `homecrm`:

```powershell
$env:HOMECRM_E2E_IMAGE='homecrm-test-d28:e2e-linux'
docker compose -p homecrm-test-d28 -f apps/web/e2e/fullscreen-forms/compose.yaml build playwright
docker compose -p homecrm-test-d28 -f apps/web/e2e/fullscreen-forms/compose.yaml run --rm playwright pnpm --filter @homecrm/web test:e2e auth motion shell.e2e.ts fullscreen-forms.e2e.ts all-tasks-actions.e2e.ts --workers=2
docker compose -p homecrm-test-d28 -f apps/web/e2e/fullscreen-forms/compose.yaml run --rm playwright pnpm --filter @homecrm/web test:e2e auth shopping-offline.e2e.ts --grep='SHOP:' --workers=2
docker compose -p homecrm-test-d28 -f apps/web/e2e/fullscreen-forms/compose.yaml down --volumes
```

Сценарии D28 повторяются с обычным и уменьшенным движением: навигация и отсутствие View Transitions API, лист, галочка, обе стороны свайпа в трёх лентах, кнопка после короткого жеста, отсутствие переключения вкладки, запрет корзины ребёнку на чужом общем деле, отсутствие отмены взрослому на чужом общем деле, загрузка пяти списков и удаление одного экземпляра серии. Дополнительно проверены прежние операции и формы, оболочка и покупки.

При возврате по истории браузера/Android экран сменяется мгновенно; отложенный переход не может затереть возврат. Проверка ощущений жестов на настоящих iPhone и Android остаётся шагом владельца при выпуске.

Обычные e2e используют `reducedMotion: 'reduce'` по умолчанию. Только сценарии движения UI-8 (`motion.e2e.ts`, `motion-repeat.e2e.ts`) явно включают `no-preference` и повторяют проверки с `reduce`. Общий лимит браузерного задания CI — 60 минут по согласованию владельца; тайм-ауты отдельных тестов прежние.
