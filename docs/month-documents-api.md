# API месячной коммуналки и документов

Контракт R1a.9 + R1b.1, UTIL-11/12, DOC-1/2/5/6/7. Все маршруты требуют действующую сессию и обычные проверки доступа. Для изменяющих запросов нужен Origin; администратору — включённый TOTP. Решения: [ADR-0035](adr/0035-month-documents-api.md). Клиент в этой задаче не меняется.

## Коммуналка

`GET /api/utilities/month?month=2026-10`:

```json
{
  "month": "2026-10",
  "objects": [{
    "id": "UUID", "title": "Вымышленная квартира",
    "chargedCents": 10000, "paidCents": 4000, "remainingCents": 6000,
    "accounts": [{"id": "UUID", "title": "Вымышленный счёт", "status": "not_transmitted"}]
  }],
  "totals": {"chargedCents": 10000, "paidCents": 4000, "remainingCents": 6000}
}
```

`accounts[].status`: `transmitted`, `not_transmitted`, `not_open`, `not_required`. Возвращаются все видимые живые объекты, включая объекты без счетов (нулевые суммы). Оплаты относятся к начислениям выбранного расчётного месяца независимо от даты оплаты. Отменённое и корзина не учитываются. Недопустимый месяц — 400, переполнение безопасного диапазона суммы — 409 `TOTAL_TOO_LARGE`.

`GET /api/objects/:id/analytics?month=2026-10`: `month` необязателен, по умолчанию текущий месяц в поясе дома. Ответ `{objectId, months}` содержит 12 месяцев по возрастанию; каждый `{month, chargedCents, paidCents, consumption, previousYear}`. `consumption` — массив `{resource, unit, value}`, где `value` — точная десятичная строка. `previousYear` имеет те же поля без вложенного сравнения. Месяцы без данных имеют нулевые суммы и пустой расход. Оплаты здесь относятся к месяцу календарной даты оплаты. Скрытый объект — 404.

## Документы

- `GET /api/document-types` — массив `{type,label}`; закрытый каталог в `packages/shared/src/documents.ts`.
- `POST /api/documents` — `{title, data?, owner?, placement?, assigneeId?}`, ответ 201.
- `GET /api/documents` — массив карточек; параметры `ownerKind=member|contact|object` с `ownerId`, `type`, `expiry=expiring|expired`, `scope=all|personal|household`, `spaceId`, `q`, `status=valid|invalid|all` (по умолчанию `valid`), `trash=true|false` (по умолчанию `false`), `limit=1…100`, `offset`. Сортировка название/UUID. «Истекает» включает сегодня и 90-й день в поясе дома, «просрочен» — раньше сегодня. `q` ищет только название/тип, с буквальными `%` и `_`.
- `GET /api/documents/:id` — карточка; скрытый документ — 404.
- `PATCH /api/documents/:id` — `{title?,data?,expectedUpdatedAt?}`. `data` — полная замена реквизитов с их значениями по умолчанию. У недействительной версии реквизиты менять нельзя: 409 `DOCUMENT_INVALID`.
- `POST /api/documents/:id/renew` — `{data,title?,expectedUpdatedAt?}`, новая карточка с 201. Операция атомарна; повтор/гонка — 409. Старые страницы остаются у старой версии.
- `GET /api/documents/:id/versions` — видимые версии цепочки; `GET /api/documents/:id/history` — журнал изменений.
- `POST /api/documents/:id/trash`, `POST /api/documents/:id/restore`, `DELETE /api/documents/:id` — обычные правила корзины (DELETE также мягкий).
- `POST /api/documents/:id/move` — `{spaceId,audience?,confirmed:true,assigneeId?}`. Документ объекта переносится вместе с объектом; удостоверение ребёнка нельзя открыть всей семье.
- `POST /api/documents/:id/assignee` — `{assigneeId}`.

`owner`: `null` либо `{kind:"member"|"contact"|"object",id:"UUID"}`. После создания владелец неизменяем. `placement`: `{spaceId,audience?:"household"|"adults"}`; отсутствие означает правила PRD 7.2.

`data`: `type` (по умолчанию `other`), строки `series`, `number`, `issuedBy`, `note`; `issuedOn`/`expiresOn` — `YYYY-MM-DD` либо null; `indefinite` — boolean; `tags` — массив строк; необязательный `warnings` — массив целых дней до окончания (0…365). Неизвестные поля/типы и несовместимые даты — 400. Бессрочный документ не имеет даты окончания. Карточка содержит обычные поля записи, `data`, `status`, `previousId`, `owner`. Скрытые контакт/предшественник возвращаются как null.

Файлы: `GET|POST /api/documents/:id/files`, загрузка multipart с полем `file`; `POST /api/documents/:id/files/:fileId/trash|restore`. Скачивание и превью — общие `/api/files/:id` и `/api/files/:id/preview`. Доступ и шифрование совпадают с файлами объекта/заметки. Связи — существующий `/api/links` с типами `document` и `document_file`.

Срок появляется автоматически из `expiresOn`; предупреждения по типу либо `data.warnings`. В `/api/deadlines` у него `sourceKind:"document"`, `documentId`, `title`. Для уже начавшегося предупреждения дальше 90 дней возможна группа `later`; `RADAR_GROUPS` и `groups` содержат `overdue`, `now`, `7days`, `30days`, `90days`, `later` (счётчик может быть нулевым). Клиент показывает «Позже» последней группой. Просроченные документы выдаются независимо от нижней границы `from` и сохраняются при пересчёте. Продление убирает срок старой версии. Бессрочность и корзина также скрывают срок. Изменять правило следует через `data`, ручное создание второго срока документа запрещено.

Экспорт ZIP включает `documents.json`, `document_files.json`, расшифрованные страницы и историю; действующие и недействительные версии, включая корзину. Состав ограничен выбранным пространством и RLS. В общий поисковый индекс входят только название и тип документа.
