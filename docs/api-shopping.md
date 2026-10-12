# Покупки SHOP-1…3

`shopping_items` выражает личный/общий список пространством. Отдельной сущности списка нет.
Права прежние: ребёнок пишет доступное общее, администратор не читает чужое личное.
Название обязательно; вся непонятная быстрая строка остаётся названием, без нового парсера.

| Путь | Действие |
|---|---|
| GET `/api/shopping` | scope=household (по умолчанию)/personal/all, spaceId?, trash=true/false, bought=all/true/false, limit≤100, offset≤50000 |
| GET `/api/shopping/:id` | Карточка |
| POST `/api/shopping` | title, quantity?: текст/null, data?: {note,store,category}, placement?: {spaceId,audience?}, links?: [{type:task/object,id,role?}], idempotencyKey? |
| PATCH `/api/shopping/:id` | title/quantity/data; expectedUpdatedAt?, idempotencyKey?; data заменяется целиком |
| POST `/api/shopping/:id/bought` | bought: boolean, expectedUpdatedAt?, idempotencyKey? |
| DELETE `/api/shopping/:id`, POST `/api/shopping/:id/trash` | Корзина; expectedUpdatedAt?, idempotencyKey? |
| POST `/api/shopping/:id/restore` | Восстановить и снять boughtAt в одной транзакции; те же поля повторов |
| POST `/api/shopping/:id/move` | spaceId, audience?, confirmed:true, expectedUpdatedAt; прежние права переноса/подтверждения |
| GET `/api/shopping/:id/history` | История под RLS |

При нескольких домах для scope=household нужен spaceId (`400 HOUSE_REQUIRED`). Для создания
без placement используется своё личное; общий список выбирается явным placement.
Список сначала показывает некупленное, затем купленное; boughtAt устанавливается сервером.
Повтор bought=true сохраняет актуальную отметку, bought=false снимает её. Новое true после
отмены начинает новый семидневный срок. Перенос доступа — только online с подтверждением.

Worker каждые пять минут/при старте вызывает закрытую для приложения функцию
`app.cleanup_bought_shopping()`: купленное семь суток назад идёт в обычную 30-дневную корзину.
Повтор уборки безопасен. UPDATE и отмена покупки сериализуются блокировкой строки и
повторной проверкой boughtAt. Восстановленная позиция снова некупленная, немедленной
повторной уборки нет. История сохраняет покупку, корзину и восстановление.

Связи используют штатные `/api/links` и `/api/records/shopping_item/:id/links`; названия скрытых
концов не выдаются. Создание проверяет доступ к обеим сторонам. Удаление связей — штатная корзина.
Поиск названия/количества/заметки/магазина/категории: `/api/search?...&includeShopping=true`.
Без флага покупки исключаются до пагинации и счётчиков для совместимости старого клиента.
ZIP личного/общего включает поля, историю и доступные связи; формат экспортов остаётся v1,
старое data отсутствующее читается как пустые поля. Фото для покупок не вводятся.

Безопасный сетевой повтор с UUID-ключом возвращает прежнюю точную metadata-квитанцию и
текущую доступную карточку; другой payload/маршрут под тем же ключом — 409. Покупки не
добавлены в офлайн-allowlist PRD13. Ошибки/авторизация — как у остальных API записей.
