# Счётчики и показания: контракт API R1a.4–5

Все запросы требуют входа. Скрытая и неизвестная запись дают одинаковый 404. Изменения общего доступны взрослым; ребёнок может вести свои личные счётчики. Доступ наследуется от объекта. Даты — `YYYY-MM-DD`, моменты передачи — ISO UTC. Значения и расход — **десятичные строки**, не JSON-числа. Все изменения атомарны.

## Счётчик

`POST /api/objects/:id/meters` (201):

```json
{
  "title": "ХВС, санузел",
  "utilityAccountId": null,
  "data": {
    "resource": "cold_water",
    "serialNumber": "FICTION-12345",
    "installationPlace": "Санузел",
    "zones": ["Основная"],
    "integerDigits": 5,
    "fractionDigits": 3,
    "verifiedOn": "2020-10-08"
  },
  "initialReading": { "occurredOn": "2026-09-20", "values": ["100.125"] }
}
```

Обязателен только `data.resource`: `cold_water`, `hot_water`, `electricity`, `gas`, `heat`. Модель, номер и место по умолчанию пусты; 1–3 названия зон, по умолчанию одна; 1–12 целых и 0–6 дробных разрядов, по умолчанию 5 и 3. Единица по умолчанию м³, кВт·ч или Гкал. `installedOn`, `verifiedOn` — даты или null; `verificationYears` — 1–50, по умолчанию 6/4/16/10/4. `nextVerificationOn` вычисляется, явная дата её заменяет. Статус `active`, `replaced`, `removed`, по умолчанию `active`. Необязательный лицевой счёт должен принадлежать тому же объекту.

Ответ содержит общие поля записи, `parentId` объекта, `utilityAccountId`, `previousMeterId`, нормализованный `data`, `initialReading` или null. Общие поля: `id`, `title`, `spaceId`, `spaceKind`, `audience`, `authorId`, `assigneeId`, `createdAt`, `updatedAt`, `deletedAt`.

| Запрос | Ответ |
|---|---|
| `GET /api/objects/:id/meters` | Активные счётчики с `previousReading` (или null) и местом установки в `data` |
| `GET /api/objects/:id/meters?status=all&trash=true` | Самостоятельная корзина счётчиков |
| `GET /api/meters/:id` | Счётчик |
| `PATCH /api/meters/:id` | `title?`, `utilityAccountId?`, `data?`, `expectedUpdatedAt?`; `data` заменяется целиком |
| `DELETE /api/meters/:id` или `POST /api/meters/:id/trash {}` | Корзина |
| `POST /api/meters/:id/restore {}` | Восстановление при живом объекте |

Фильтр `status`: active/replaced/removed/all. Разрядность, зоны и ресурс после первого отсчёта не меняются (409). Статус replaced устанавливает операция замены. Для пересчёта поверки при PATCH не передавайте `nextVerificationOn`; явный null снимает дату.

## Показания и S3

`POST /api/meters/:id/readings` (201) принимает `occurredOn`, `values` по порядку зон, необязательные `rollover` (false), `comment` (пустой), `photoIds` ([]). Фото предварительно загружаются через `POST /api/objects/:id/files`; принимаются только живые изображения этого объекта. Кто снял — текущий участник (`takenBy`, совпадает с автором).

Ответ: общие поля, `parentId` счётчика, `occurredOn`, нормализованные `values`, `consumption` по зонам (null у начального отсчёта), `rollover`, `comment`, `photoIds`, `takenBy`, `transmissionStatus` (`pending`/`transmitted`), `transmittedAt`, `transmissionMethod`, `warnings` (массив текстов).

`GET /api/readings/:id` читает отдельное показание. `GET /api/meters/:id/readings` возвращает живой ряд от старых к новым; `?includePrevious=true` включает предшественников замены. Предупреждения возвращаются при сохранении. `DELETE /api/readings/:id` / `POST /api/readings/:id/trash {}` и `POST /api/readings/:id/restore {}` работают для последнего отсчёта, при живом счётчике. Для исправления последнего значения уберите его в корзину и введите новое.

`POST /api/objects/:id/readings` (201) — «Сохранить всё»:

```json
{
  "readings": [
    { "meterId": "<uuid>", "occurredOn": "2026-10-20", "values": ["110,125"] },
    { "meterId": "<uuid>", "occurredOn": "2026-10-20", "values": ["235.000", "91.750"] }
  ]
}
```

1–100 разных счётчиков одного объекта, всё или ничего. Ответ — массив показаний с расходом и предупреждениями. Меньшее значение без `rollover` или неверная точность — `400 INVALID_READING`; повторная/более ранняя дата — `409 READING_DATE_ORDER`; неактивный прибор — `409 METER_INACTIVE`. Граница перехода через ноль определяется разрядностью. Предупреждение «Проверьте, нет ли утечки или ошибки» не блокирует ввод: порог 40% включительно от среднего имеющихся завершённых интервалов за последние шесть месяцев. Один начальный отсчёт не даёт среднего.

## Замена и передача

`POST /api/meters/:id/replace` (201): `{finalReading: <показание>, newMeter: <создание счётчика с обязательным initialReading>}`. Даты конечного и начального показания совпадают; ресурс тот же. Конечный отсчёт может быть в день предыдущего. Ответ `{oldMeterId, finalReading, newMeter}`. Ошибка любой части откатывает всю замену. Между конечным старого и начальным нового расход не начисляется.

`GET /api/objects/:id/transmission` — массив групп `{utilityAccountId, number, transmission, readings}`. В `readings` последний ещё не переданный отсчёт каждого прибора, с `meterId`, `zones`, `serialNumber`, `installationPlace`. `transmission` — существующий контракт счёта: gosuslugi_dom/provider с url/phone с phone/automatic/not_required. Без живого счёта — группа с null и пустым номером.

`POST /api/objects/:id/readings/transmit`: `{readingIds: ["<uuid>"], method: "Сайт поставщика", transmittedAt?: "<ISO UTC>"}`. 1–100 разных показаний одного объекта. Ответ — массив переданных показаний; повтор сохраняет прежние дату и способ. Ошибка любого id откатывает весь пакет. В S3 четыре счётчика требуют одного ввода и одной отметки передачи.

Показания появляются источником `reading` в ленте объекта и наследуют его текущие пространство и аудиторию, в том числе после «Поделиться». Снимок прежнего доступа ограничивает ручные события, а не показания. Поиск по заводскому номеру ведёт в объект. ZIP включает счётчики, показания, историю и оригиналы фото. Подключение поверки и закрытие окон в радаре — R1a.6. См. [ADR-0032](adr/0032-meters-readings.md).

Поверка и окна подключены к общему радару R1a.6: [контракт](utility-deadlines-api.md). `POST /api/meters/:id/verify` проводит поверку и пересчитывает следующую дату.
