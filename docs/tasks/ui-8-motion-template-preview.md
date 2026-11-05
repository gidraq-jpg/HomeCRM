# UI-8. Изолированный эксперимент движения

Ветка: feat/ui-8-motion-template-preview. Рабочее принятие и выпуск не даны.
Стенд: homecrm-test-motion-template, API 8500, WEB 5360, PG 15500,
случайная новая БД и вымышленная семья Солнечных. Секреты только в .demo.
Вход: http://localhost:5360/api/demo/enter. Приложение и данные настоящие, API не подменяется.

## Охват слоя движения

| Класс | Решение | Файлы |
|---|---|---|
| Локальные результаты и пустое состояние | Применено: fast-выход, base-вход, ограниченная очередь; частичное обновление сохраняет строки | ContentMotion, TasksScreen, DocumentsScreen, ObjectsScreen |
| Добавление/удаление остальных строк | Применено: DOM-ключи RowList, ограниченная очередь; схлопывание сохранено | Row, useListMotion, MotionList, MotionGroups |
| Фильтры и вкладки | Выбор мгновенный; единый быстрый переход цвета | ChipGroup, LinkTabs, motion.css |
| Цифры | Уже соответствует: только изменение значения, доступное число сразу, base | RollingNumber |
| Диаграммы | Применено: изменение высоты рисунка от прежнего значения, base; реальные подписи сразу | BarChart |
| Переходы экранов/нижние вкладки | Уже соответствует ADR-0049: боковой переход 330, dock мгновенно | shell/motion, useSectionNav, motion.css |
| Ленты и свайпы | Сохранено: движение за пальцем, доезд feed450, прерывание и возврат | TaskTabs, TaskFeedCarousel |
| Нижние листы, формы, история, фокус | Сохранено: Radix, sheet300, общий ease; Escape/back/жест | Sheet, sheet-history, sheet-gesture, shell/motion |
| Улёт и отмена дела | Сохранено fly560; добавлена единая кривая пульса цели | taskFlight |
| Плашки и скелеты | Уже соответствует: base/fast, inert копии, reduced motion | Toast, ListSkeleton, useListMotion, motion.css |
| Вход в приложение | Убраны частные 120/160мс и встроенные кривые, используются токены | auth.css |
| Неизменные данные, первоначальные графики | Без нового движения: повторное обновление не означает новое действие | ключи ContentMotion, RollingNumber, BarChart |

Уменьшенное движение: только короткое затухание без очереди и сдвигов.
Проверить: pnpm check:changed, Linux Playwright 360/412 + axe/44px/overflow,
видео и промежуточные кадры; затем одно независимое ревью. Push/PR/merge запрещены до решения владельца.

## Результаты проверки (3 ноября 2026)

- pnpm check:changed: кодировка, Biome, типы; 9 файлов / 60 тестов зелёные.
- Linux UI-8 normal/reduced, 360/412: первый широкий прогон 22/24. Два падения normal child — timeout проверки elementFromPoint до начала жеста; точечный повтор обоих неизменённых сценариев зелёный, причина первоначального таймаута достоверно не установлена.
- Linux targeted: 6/6 (четыре новых сценария и normal child 360/412).
- Расширенные регрессии трёх блокеров: 4/4, normal/reduced × 360/412, одинаковая группа с разными leaf-id, inert/aria-hidden, фокус, same-key, rapid long→short→empty, minHeight ownership, предметный ключ строки в активной ленте, axe/44px/overflow. Включена реальная запись видео и детерминированные кадры паузой WAAPI.
- Единственное независимое ревью: три блокера исправлены. Неблокер прерывания BarChart записан в docs/backlog.md.

Артефакты: apps/web/test-results/motion-template-proof/ (transition-start.png,
transition-middle.png, list-to-empty-preserved.png, video.webm в каталогах четырёх сценариев),
apps/web/test-results/screens/{360,412}/motion-template-*.png.
Снимки и видео локальные, не публикуются и не входят в git.
Рабочая сборка, установленные PWA и физические телефоны не проверялись этим экспериментом.
