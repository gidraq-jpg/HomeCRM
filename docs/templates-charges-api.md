# API шаблонов, начислений и оплат (R1a.7–8)

Авторизация, источник запроса, RLS и ошибки — как в API объектов. Все суммы — целые копейки, не рубли и не float. Решения — [ADR-0034](adr/0034-templates-charges.md).

## Шаблоны

- `GET /api/templates` — три шаблона `apartment`, `rented_apartment`, `house`. Массивы `accounts`, `meters`, `organizations`, `deadlines` содержат `id`, название и `selected: true`; каждый пункт можно снять. `taxRegimes` сдаваемой квартиры — `npd` или `ndfl`, выбор необязателен.
- `GET /api/onboarding` — `{ households: [{ householdId, empty }], needsFirstObject }`, только дома, где текущий участник администратор.
- `POST /api/templates/:id/apply` — создаёт объект и выбранные пункты атомарно, возвращает 201 `{ objectId }`.

```json
{
  "idempotencyKey": "00000000-0000-4000-8000-000000000001",
  "title": "Вымышленная квартира",
  "propertyData": { "address": "Вымышленная улица, 1" },
  "placement": { "spaceId": "00000000-0000-4000-8000-000000000002", "audience": "adults" },
  "accounts": [{ "id": "water_sewerage", "data": { "number": "ВЫМ-001", "payer": "tenant" } }],
  "meters": [{ "id": "cold_water", "data": { "verifiedOn": "2026-10-01" }, "initialReading": { "occurredOn": "2026-10-08", "values": ["123,456"] } }],
  "organizations": ["emergency"],
  "deadlines": [{ "id": "tenant_readings" }],
  "taxRegime": "npd"
}
```

Обязательно только `title` и ключ идемпотентности. Отсутствующий массив — пустой выбор. Поля счёта и счётчика можно переопределять в `data`; `supplierId` и `title` счёта — рядом с `id`. У срока можно переопределить `rule`. Для личного объекта можно явно передать `householdId` календаря. Повтор того же ключа возвращает тот же UUID; другое содержимое — 409 `IDEMPOTENCY_KEY_REUSED`. Ошибка любого пункта откатывает всё. Пункты другого шаблона — 400 `TEMPLATE_ITEM_UNAVAILABLE`. У дома без выбранных сроков и членства объект всё же можно создать в личном.

## Начисления

- `POST /api/accounts/:id/charges` — `{ period: "2026-10", totalCents: 10000, lines?: [{ title, amountCents, kind: "service" | "adjustment" }], dueOn?: "2026-11-15", receiptId?: UUID | null }`.
- `GET /api/accounts/:id/charges?limit=50&offset=0` — живые начисления, включая отменённые, по периоду и UUID; максимум 100 на страницу.
- `GET /api/charges/:id` — начисление, `paidCents`, `remainingCents`, `receiptIds`, признаки и причина отмены. Записи в корзине доступны под прежним RLS для просмотра.
- `POST /api/charges/:id/cancel` — `{ reason }`; сначала отменить действующие оплаты, иначе 409 `CANCEL_PAYMENTS_FIRST`.

Если строк нет, достаточно итога. Если строки есть, их сумма равна итогу. Срок без `dueOn` — день счёта в следующем после `period` месяце; если правила нет — 400 `DUE_DATE_REQUIRED`.

## Оплаты

- `POST /api/charges/:id/payments` — `{ paidOn: "2026-10-08", amountCents: 10000, payer: { kind: "member", accountId: UUID } | { kind: "tenant" }, method: "card" | "autopay" | "gosuslugi" | "cash" | "tenant", receiptId?: UUID | null }`.
- `GET /api/charges/:id/payments?limit=50&offset=0` — оплаты вместе с отменёнными, по дате и UUID, максимум 100.
- `POST /api/payments/:id/cancel` — `{ reason }`; повтор сохраняет первую причину и время. Отменённая оплата не входит в итог.
- `DELETE /api/charges/:id` и `DELETE /api/payments/:id` — 409 `CANCEL_INSTEAD_OF_DELETE` для доступной записи.

Сумма оплаты положительна; переплата разрешена. Плательщик-участник — текущий участник или действующий участник дома объекта. Файл должен быть живым файлом этого объекта. Отдельные маршруты изменения или корзины денег отсутствуют; корзина, восстановление и перенос идут с родителем.

## Радар

`GET /api/deadlines` сохраняет прежний контракт и добавляет `chargeId: UUID | null`. Для шаблонных сроков `title` содержит подпись срока. У начисления основное действие прежнее — `mark_payment`. Срок счёта за соответствующий расчётный месяц скрывается. Оплаченное начисление скрывается, отмена оплаты возвращает его.

`POST /api/deadlines/occurrences/:id/complete-payment` с `{}` создаёт ровно остаток текущей датой дома, плательщик — текущий участник, способ — карта. Повтор не дублирует. `{ completed: false }` для начисления — 409 `CANCEL_PAYMENT_WITH_REASON`; для отмены вызывается API оплаты с причиной. При нескольких начислениях за месяц на старом наступлении счёта — 409 `SELECT_CHARGE`.
