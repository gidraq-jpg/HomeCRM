# Коммунальные сроки: API R1a.6

API требует сессию и проверяет RLS источника. Клиент получает контекст одним `GET /api/deadlines?from=YYYY-MM-DD&to=YYYY-MM-DD`; отдельные запросы объектов и счетов для списка не нужны. Существующие поля, группы и `recalculating` сохранены.

У каждого пункта добавлены:

- `sourceKind`: `record` (прежний срок заметки/объекта), `readings`, `payment`, `verification`;
- `object: {id,title,status} | null`: `status` — `living`, `rented`, `vacant` или `null`;
- `utilityAccount: {id,title,number,transmission} | null`;
- `meter: {id,title} | null`;
- `primaryAction`: `null` для прежнего срока либо действие ниже.

| Вид | Основное действие | Вызов клиента |
|---|---|---|
| `readings` | `{kind:"enter_readings",label:"Внести показания",objectId}` | Открыть экран показаний объекта; сохранить показания прежним API и отметить переданными |
| `payment` | `{kind:"mark_payment",label:"Отметить оплату",occurrenceId}` | `POST /api/deadlines/occurrences/:id/complete-payment {completed?:true}`; `{completed:false}` отменяет отметку |
| `verification` | `{kind:"verify_meter",label:"Поверка проведена",meterId}` | `POST /api/meters/:id/verify {verifiedOn:"YYYY-MM-DD",nextVerificationOn?:"YYYY-MM-DD"|null}` |

Отметка оплаты возвращает наступление, повтор сохраняет первоначальный `completedAt`. Отметка чужого или невидимого платежа — 404; для видимого без права правки — 403; для другого вида — 409 `NOT_A_PAYMENT`. Поверка возвращает карточку прибора: без явной следующей даты она пересчитывается от `verifiedOn` по интервалу, `null` снимает дату. Неактивный прибор — 409 `METER_INACTIVE`.

Управляемые сроки создаются автоматически из `readingRule`/`paymentRule` счёта и `nextVerificationOn` активного прибора. Их нельзя редактировать или удалять через общий API сроков: 409 `EDIT_UTILITY_SOURCE`. В обычном блоке сроков объекта и общей корзине сроков они не дублируются. Корзина, восстановление и правки выполняются у источника; `recalculating` сообщает о незавершённом пересчёте. Нет активных приборов — нет открытого окна. Показание до окна, непереданное или в корзине не закрывает его. Закрытие пересчитывается сразу при чтении, без ожидания worker.

Правила DEAD-1 принимают `warningTime: "HH:mm"` и `endWarnings: number[]`. Предупреждения окна по умолчанию — открытие, за день до закрытия и последний день; оплаты — за 3 дня и в день срока, в 09:00 дома. Для поверки доступны необязательные `verificationWarnings` и `verificationWarningTime` в `data` прибора, умолчания `[60,30,7]` и `09:00`. Подробная совместимость прежних пустых настроек — ADR-0033.

`PATCH /api/notifications/settings` принимает прежний `deadline` (все сроки) и конкретные виды `readings_open`, `readings_closing`, `readings_last_day`, `payment_upcoming`, `payment_due`, `verification`. Чтобы выбрать конкретные виды, передайте их без `deadline`. В push родительский объект остаётся в `recordId`, `kind` остаётся `deadline`, коммунальный вид находится в дополнительном `notificationKind`. Тихие часы, бюджет и скрытие текста работают как прежде.
