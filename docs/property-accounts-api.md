# Недвижимость, организации и лицевые счета: API R1a.1–3

Все маршруты требуют сессию. Доступ проверяется сервером и RLS. `404` одинаков для отсутствующей и невидимой записи; отказ в правке видимой записи — `403`. Неверная схема — `400`, конфликт версии или целостности — `409`. Ответы не содержат внутренних признаков вклада и вычисляемых колонок.

## Недвижимость

`POST /api/objects` и `PATCH /api/objects/:id` принимают `typeData` для `objectType: "property"`. PATCH заменяет `typeData` целиком; пропущенное поле сохраняет прежнее. При смене типа поля очищаются. В списках, карточках и копии возвращается `typeData`.

```json
{
  "title": "Вымышленная квартира",
  "objectType": "property",
  "typeData": {
    "kind": "apartment",
    "address": "Вымышленная улица, 1",
    "areaHundredths": 5731,
    "cadastralNumber": "66:41:0101001:123",
    "status": "living",
    "ownerMemberIds": []
  }
}
```

Все поля типа необязательны. Площадь выше — 57,31 м². Виды: `apartment`, `house`, `dacha_land`, `garage_parking`, `non_residential`; статусы: `living`, `rented`, `vacant`. Кадастровый номер: две цифры, две цифры, 6–7 цифр, 1–10 цифр, части разделены двоеточиями. Собственники-контакты связываются через `/api/links` с концом `{type:"contact",id}` и ролью «собственник».

При копировании объекта `ownerMemberIds` проверяются для нового места: недоступные участники, в том числе ушедшие из дома, молча отбрасываются. Копия создаётся с ответом 201, остальные поля сохраняются. При обычной правке прежняя ссылка на ушедшего собственника сохраняется; новая недопустимая ссылка отклоняется с `INVALID_OWNER`.

Для объектов отсутствие `placement` сохраняет прежний смысл «Только я», даже при наличии `typeData`. Форма создания уже выбирает общее «Взрослые» по таблице 7.2 PRD и передаёт `placement: {spaceId,audience?}` явно. Общее место недвижимости без аудитории получает «Взрослые»; явно указанная аудитория имеет приоритет. Организация без `placement` — общее «Вся семья»; при нескольких домах выбирается первый по UUID, без дома используется личное. Для явного выбора организации тоже передайте `placement`. `GET /api/me` возвращает `personalSpaceId` текущего участника для выбора «Только я».

## Организации

| Маршрут | Тело или результат |
|---|---|
| `POST /api/contacts` | `{title, kind?:"organization", data?, placement?}` → карточка, 201 |
| `GET /api/contacts` | Массив карточек; `organizationType`, `scope=all|household|personal`, `trash=true`, `limit` 1–100, `offset` |
| `GET /api/contacts/:id` | Карточка, включая доступную запись в корзине |
| `PATCH /api/contacts/:id` | `{title?,data?,expectedUpdatedAt?}`; `data` заменяется целиком |
| `DELETE /api/contacts/:id` или `POST /api/contacts/:id/trash` | Корзина |
| `POST /api/contacts/:id/restore` | Восстановление |

`data`: `organizationType`, `phones: [{number,label?,emergency?}]`, `website`, `address`, `openingHours`, `note`. Строки необязательны, ссылки могут быть `null`, сайты — только HTTP(S). Типы: `management`, `utility`, `bank`, `insurance`, `school`, `clinic`, `service`, `shop`, `government`, `other`. Телефонов до 20. Только название обязательно. Вид `person` ещё не принимается.

Связь с объектом создаётся обычным `/api/links`; карточка объекта содержит `peopleAndOrganizations: [{linkId,role,contact}]`. В блок входят только живые видимые контакты, когда видны оба конца. Сама организация остаётся видна ребёнку, даже если связана с квартирой «Взрослые»; связь ребёнку не возвращается.

## Лицевые счета

| Маршрут | Тело или результат |
|---|---|
| `POST /api/objects/:id/accounts` | `{title?,supplierId?,data?}` → карточка, 201 |
| `GET /api/objects/:id/accounts` | Массив карточек; `trash=true`, `limit`, `offset` |
| `GET /api/accounts` | Все видимые счета; `trash=true` включает каскадную корзину удалённых объектов; `limit`, `offset` |
| `GET /api/accounts/:id` | Карточка, включая доступную запись в корзине |
| `PATCH /api/accounts/:id` | `{title?,supplierId?,data?,expectedUpdatedAt?}`; `data` заменяется целиком |
| `DELETE /api/accounts/:id` или `POST /api/accounts/:id/trash` | Самостоятельная корзина |
| `POST /api/accounts/:id/restore` | Восстановление при живом родителе |

Название по умолчанию «Лицевой счёт». Поставщик и номер необязательны. Карточка содержит `parentId`, `data`, `supplierId` и `supplier: {id,title,deletedAt}`; скрытый или отсутствующий поставщик представлен двумя `null`, `supplierHidden: true` различает скрытого поставщика без раскрытия его id. Новый поставщик должен быть видимой живой организацией. Место и аудитория принимаются только от объекта, самостоятельно их менять нельзя.

`data`: `services`, `number`, `transmission`, `readingRule`, `paymentRule`, `payer`, `cabinetUrl`, `note`. Услуги: `maintenance`, `unified_bill`, `electricity`, `water_sewerage`, `heating`, `gas`, `waste`, `capital_repairs`, `internet_tv`, `intercom`, `other`. Они соответствуют приложению А; повторы запрещены. `payer`: `owner`, `tenant`, `other`.

Передача: `{method:"gosuslugi_dom"}`, `{method:"provider",url}`, `{method:"phone",phone}`, `{method:"automatic"}`, `{method:"not_required"}` или `null`, пока способ неизвестен.

```json
{
  "data": {
    "services": ["water_sewerage"],
    "number": "TEST-123",
    "transmission": {"method": "provider", "url": "https://supplier.invalid"},
    "readingRule": {
      "kind": "repeat",
      "anchor": "2026-01-01",
      "repeat": {"unit": "month", "every": 1, "day": 28, "endDay": 5}
    },
    "paymentRule": {
      "kind": "repeat",
      "anchor": "2026-02-01",
      "repeat": {"unit": "month", "every": 1, "day": 15}
    },
    "payer": "owner"
  }
}
```

Окно выше — с 28-го до конца 5-го числа следующего месяца. `endDay` — календарная граница; `durationDays` при нём должен быть 0. Оплата — ежемесячная дата без окна. `anchor` задаёт первое наступление; остальные поля DEAD-1 (`time`, `warnings`) доступны, умолчания добавляет общая схема. Правила не создают строки радара в этом этапе.

Перенос и смена аудитории объекта уносят счета. Восстановление объекта возвращает только счета его каскадной корзины; отдельно удалённые остаются в корзине. Копия объекта сохраняет живые счета с новыми id. Скрытый поставщик или поставщик в корзине в копии не назначается. Чужое добавление или правка счёта блокирует превращение общего объекта в личный; остаётся копия.

ZIP `/api/export/archive` включает новые сущности и их историю под правилами ADR-0030. Поиск объекта находит адрес и кадастровый номер; самостоятельные результаты организаций и счетов будут добавлены вместе с их экранами, см. ADR-0031. Счётчики, показания и подключение счетов к радару — следующие задачи.
