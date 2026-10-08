# R1a.5b — счётчики и показания: экраны

Снимки сделаны Chromium на вымышленной семье (Анна — администратор, Борис — взрослый, Вера — ребёнок) сценариями `app/meters.e2e.ts` на ширине 360 и 412 px. Axe: без серьёзных и критичных нарушений; цели от 44 px, горизонтальной прокрутки нет. Снимки сделаны на компьютере владельца (Windows), а не в контейнере Playwright: для сравнения с эталоном они не годятся, только для просмотра. Рабочее окружение не использовалось.

| Состояние | 360 px | 412 px |
|---|---|---|
| «Показания»: название объекта и статус в заголовке, четыре счётчика | [Снимок](360/app-readings-empty.png) | [Снимок](412/app-readings-empty.png) |
| Ошибка «Меньше прошлого» у поля, выбор «Переход через ноль» или «Замена счётчика» | [Снимок](360/app-readings-error-lower.png) | [Снимок](412/app-readings-error-lower.png) |
| Заполнено: расход, фото, переход через ноль, две зоны | [Снимок](360/app-readings-filled.png) | [Снимок](412/app-readings-filled.png) |
| Другой объект | [Снимок](360/app-readings-switch.png) | [Снимок](412/app-readings-switch.png) |
| После «Сохранить всё»: расход и предупреждение 40% | [Снимок](360/app-transfer-saved.png) | [Снимок](412/app-transfer-saved.png) |
| Предупреждение 40%: «Исправить значение» | [Снимок](360/app-transfer-warning.png) | [Снимок](412/app-transfer-warning.png) |
| Передача: значения по лицевому счёту, «Скопировать», «Отметить переданными» | [Снимок](360/app-transfer-groups.png) | [Снимок](412/app-transfer-groups.png) |
| Всё передано | [Снимок](360/app-transfer-done.png) | [Снимок](412/app-transfer-done.png) |
| Замена счётчика | [Снимок](360/app-replace-sheet.png) | [Снимок](412/app-replace-sheet.png) |
| Вкладка «Счётчики»: пусто | [Снимок](360/app-meters-empty.png) | [Снимок](412/app-meters-empty.png) |
| Форма счётчика: поверка, начальное показание | [Снимок](360/app-meter-form.png) | [Снимок](412/app-meter-form.png) |
| Список счётчиков | [Снимок](360/app-meters-list.png) | [Снимок](412/app-meters-list.png) |
| Заменённые и снятые в свёрнутой группе | [Снимок](360/app-meters-archive.png) | [Снимок](412/app-meters-archive.png) |
| Лента: показания объекта | [Снимок](360/app-timeline-readings.png) | [Снимок](412/app-timeline-readings.png) |
| Ребёнок: объект «Взрослые» недоступен | [Снимок](360/app-readings-child-hidden.png) | [Снимок](412/app-readings-child-hidden.png) |
| Ребёнок: счётчики общего объекта только для чтения | [Снимок](360/app-meters-child-readonly.png) | [Снимок](412/app-meters-child-readonly.png) |
| Ребёнок: «Показания» только для чтения | [Снимок](360/app-readings-child-readonly.png) | [Снимок](412/app-readings-child-readonly.png) |

Проверки на физических телефонах и выпуск не выполнялись.
