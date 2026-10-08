# R0.8d — клиент сроков и уведомлений: замечания ревью

Снимки сделаны в Linux-контейнере Playwright v1.63.0-noble на вымышленной семье. Сценарии `app/deadlines.e2e.ts`, `app/notifications.e2e.ts`, `app/notifications-worker.e2e.ts`. Axe: без серьёзных и критичных нарушений; цели от 44 px, горизонтальной прокрутки нет. Рабочее окружение не использовалось.

| Состояние | 360 px | 412 px |
|---|---|---|
| Срок чужого автора в корзине: «Отменить» нет | [Снимок](360/app-deadlines-trash-no-undo.png) | [Снимок](412/app-deadlines-trash-no-undo.png) |
| Радар: «Пересчёт затянулся» и «Обновить» | [Снимок](360/app-radar-stalled.png) | [Снимок](412/app-radar-stalled.png) |
| Уведомление ведёт на недоступную запись | [Снимок](360/app-notif-open-unavailable.png) | [Снимок](412/app-notif-open-unavailable.png) |

Проверки на физических телефонах и выпуск не выполнялись.