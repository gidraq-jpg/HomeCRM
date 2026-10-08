# R1a.1b — недвижимость, лицевые счета, организации: экраны

Снимки сделаны Chromium на вымышленной семье (Анна — администратор, Борис — взрослый, Вера — ребёнок) сценариями `app/property.e2e.ts` на ширине 360 и 412 px. Axe: без серьёзных и критичных нарушений; цели от 44 px, горизонтальной прокрутки нет. Снимки сделаны на компьютере владельца (Windows), а не в контейнере Playwright: для сравнения с эталоном они не годятся, только для просмотра. Рабочее окружение не использовалось.

| Состояние | 360 px | 412 px |
|---|---|---|
| Недвижимость: ошибки формата у полей | [Снимок](360/app-property-form-error.png) | [Снимок](412/app-property-form-error.png) |
| Карточка недвижимости, статус рядом с названием | [Снимок](360/app-property-card.png) | [Снимок](412/app-property-card.png) |
| «Дом»: статус и адрес в списке | [Снимок](360/app-property-home-list.png) | [Снимок](412/app-property-home-list.png) |
| Вкладка «Счета»: пусто | [Снимок](360/app-accounts-empty.png) | [Снимок](412/app-accounts-empty.png) |
| Форма лицевого счёта | [Снимок](360/app-account-form.png) | [Снимок](412/app-account-form.png) |
| «Новая организация» прямо из формы счёта | [Снимок](360/app-account-new-organization.png) | [Снимок](412/app-account-new-organization.png) |
| Три лицевых счёта (S1) | [Снимок](360/app-accounts-list.png) | [Снимок](412/app-accounts-list.png) |
| Поставщик скрыт от читателя | [Снимок](360/app-account-hidden-supplier.png) | [Снимок](412/app-account-hidden-supplier.png) |
| «Люди и организации» в обзоре | [Снимок](360/app-people-block.png) | [Снимок](412/app-people-block.png) |
| Связать с организацией | [Снимок](360/app-people-link-sheet.png) | [Снимок](412/app-people-link-sheet.png) |
| Организации: список | [Снимок](360/app-organizations-list.png) | [Снимок](412/app-organizations-list.png) |
| Карточка организации: телефоны, «Аварийный» | [Снимок](360/app-organization-card.png) | [Снимок](412/app-organization-card.png) |
| Организация: ошибки формы | [Снимок](360/app-organization-form-error.png) | [Снимок](412/app-organization-form-error.png) |
| Ребёнок: организация видна, связи с квартирой нет | [Снимок](360/app-organizations-child.png) | [Снимок](412/app-organizations-child.png) |
| Ребёнок: объект «Взрослые» недоступен | [Снимок](360/app-property-child-hidden.png) | [Снимок](412/app-property-child-hidden.png) |
| Ребёнок: счета «Вся семья» только для чтения | [Снимок](360/app-accounts-child-readonly.png) | [Снимок](412/app-accounts-child-readonly.png) |
| Корзина: лицевые счета | [Снимок](360/app-trash-accounts.png) | [Снимок](412/app-trash-accounts.png) |
| Корзина: организации | [Снимок](360/app-trash-organizations.png) | [Снимок](412/app-trash-organizations.png) |

Проверки на физических телефонах и выпуск не выполнялись.
