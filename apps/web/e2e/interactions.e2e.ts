import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures.ts';
import { goToSection, openApp, plain } from './support/helpers.ts';

// Остальные касания: дела, главное дело, фильтры списков, вкладки объекта, «Ещё», «Коммуналка за месяц».
// Проверяется, что всё, что выглядит нажимаемым, действительно работает.

const toast = (page: Page) => page.locator('.toast-region');
const checkbox = (page: Page, name: string) => page.getByRole('checkbox', { name });
const link = (page: Page, name: RegExp | string) => page.getByRole('link', { name });

test.describe('«Сегодня»', () => {
  test('выполнить дело и отменить в течение 7 секунд', async ({ page }) => {
    await openApp(page, '/today');
    await checkbox(page, 'Забрать посылку на почте').click();
    await expect(toast(page)).toContainText('Дело выполнено');
    await expect(toast(page)).toContainText('Забрать посылку на почте');
    await expect(checkbox(page, 'Забрать посылку на почте')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Выполнено · 2/ })).toBeVisible();

    await toast(page).getByRole('button', { name: 'Отменить' }).click();
    await expect(checkbox(page, 'Забрать посылку на почте')).toBeVisible();
    await expect(page.getByRole('button', { name: /Выполнено · 1/ })).toBeVisible();
  });

  test('выполненное свёрнуто и раскрывается', async ({ page }) => {
    await openApp(page, '/today');
    const toggle = page.getByRole('button', { name: /Выполнено · 1/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(checkbox(page, 'Отправить договор в УК')).toHaveCount(0);
    await toggle.click();
    await expect(page.getByRole('button', { name: 'Скрыть выполненное' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(checkbox(page, 'Отправить договор в УК')).toBeChecked();
  });

  test('главное дело: открыть, выбрать другое, выполнить', async ({ page }) => {
    await openApp(page, '/today');
    const focus = page.locator('.focus');
    await expect(focus).toContainText('Собрать документы на новый загранпаспорт');
    await expect(focus).toContainText('Только я');

    await focus.getByRole('button', { name: 'Открыть дело' }).click();
    const sheet = page.getByRole('dialog', { name: 'Собрать документы на новый загранпаспорт' });
    await expect(sheet).toContainText('Только я');
    await sheet.getByRole('button', { name: 'Закрыть' }).click();

    await focus.getByRole('button', { name: 'Выбрать другое главное дело' }).click();
    const chooser = page.getByRole('dialog', { name: 'Главное на сегодня' });
    await chooser.getByRole('button', { name: /Позвонить в УК про течь в ванной/ }).click();
    await expect(toast(page)).toContainText('Главное дело выбрано');
    await expect(focus).toContainText('Позвонить в УК про течь в ванной');
    await expect(focus).toContainText('Взрослые');

    // Выполненное главное дело освобождает место для выбора.
    await focus.getByRole('button', { name: 'Открыть дело' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Отметить выполненным' }).click();
    await expect(page.getByRole('heading', { name: 'Что сегодня важнее всего?' })).toBeVisible();
    await page.getByRole('button', { name: 'Выбрать главное' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Записаться к стоматологу/ })
      .click();
    await expect(focus).toContainText('Записаться к стоматологу');
  });

  test('карточка дела: «Сделать главным на сегодня» и «Отметить выполненным»', async ({ page }) => {
    await openApp(page, '/today');
    await page.getByRole('button', { name: /Забрать посылку на почте/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Забрать посылку на почте' });
    await expect(sheet).toContainText('Вся семья');
    await sheet.getByRole('button', { name: 'Сделать главным на сегодня' }).click();
    await expect(page.locator('.focus')).toContainText('Забрать посылку на почте');

    await page.getByRole('button', { name: 'Открыть дело' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Отметить выполненным' }).click();
    await expect(toast(page)).toContainText('Дело выполнено');
    await expect(page.getByRole('heading', { name: 'Что сегодня важнее всего?' })).toBeVisible();
  });

  test('«Срочное» ведёт к нужной записи', async ({ page }) => {
    await openApp(page, '/today');
    await link(page, /Оплата: взнос на капремонт/).click();
    await expect(page).toHaveURL(/#\/home\/sadovaya\/utilities$/);
    await expect(page.getByText('Просрочено', { exact: true })).toBeVisible();
  });
});

test.describe('«План» и «Все дела»', () => {
  test('«План»: лента дней от сегодняшнего и дела без даты', async ({ page }) => {
    await openApp(page, '/today');
    await page
      .getByRole('navigation', { name: 'Дела' })
      .getByRole('link', { name: 'План' })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('План');
    await expect(page.getByRole('heading', { level: 2, name: 'Сегодня, 22 окт.' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Суббота, 24 окт.' })).toBeVisible();
    await expect(page.getByText('Отвезти старый диван на дачу')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Без даты' })).toBeVisible();
    await expect(page.getByText('Выбрать подарок маме')).toBeVisible();
    await expect(page.getByText('Дел нет. Свободный день.')).toHaveCount(4);
  });

  test('«Все дела»: фильтры «Мои», «Назначил другим», «Без даты», «Жду»', async ({ page }) => {
    await openApp(page, '/today/all');
    const rows = page.locator('.task-row');
    await expect(rows).toHaveCount(9);

    await page.getByRole('radio', { name: 'Мои' }).check();
    await expect(rows).toHaveCount(8);
    await page.getByRole('radio', { name: 'Назначил другим' }).check();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Отвезти старый диван на дачу');
    await expect(rows.first()).toContainText('Исполнитель: Игорь');
    await page.getByRole('radio', { name: 'Без даты' }).check();
    await expect(rows).toHaveCount(3);
    await page.getByRole('radio', { name: 'Жду' }).check();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Ждём Петра Семёнова, проверить 26 окт.');
    await page.getByRole('radio', { name: 'Все', exact: true }).check();
    await expect(rows).toHaveCount(9);
  });

  test('созданное дело «Без даты» попадает в «Все дела» и «План»', async ({ page }) => {
    await openApp(page, '/today/all');
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^Дело/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Что нужно сделать').fill('Проверить чердак на даче');
    await dialog.getByLabel('Когда').selectOption('none');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(
      page.locator('.task-row').filter({ hasText: 'Проверить чердак на даче' }),
    ).toContainText('Без даты');
    await page
      .getByRole('navigation', { name: 'Дела' })
      .getByRole('link', { name: 'План' })
      .click();
    await expect(page.getByText('Проверить чердак на даче')).toBeVisible();
  });
});

test.describe('«Документы»: фильтры', () => {
  test('по типу, человеку и сроку; пустой результат — со сбросом', async ({ page }) => {
    await openApp(page, '/documents');
    const rows = page.getByRole('list', { name: 'Документы' }).getByRole('listitem');
    await expect(rows).toHaveCount(10);

    await page.getByRole('radio', { name: 'Полисы' }).check();
    await expect(rows).toHaveCount(3);
    await page.getByRole('radio', { name: 'Удостоверения' }).check();
    await expect(rows).toHaveCount(3);
    await page.getByRole('radio', { name: 'Все', exact: true }).check();

    await page.getByLabel('Чей документ').selectOption('Анна');
    await expect(rows).toHaveCount(3);
    await page.getByLabel('Чей документ').selectOption('');

    await page.getByLabel('Срок').selectOption('soon');
    await expect(rows).toHaveCount(2);
    await expect(link(page, /Страховка дачи/)).toBeVisible();
    await expect(link(page, /Загранпаспорт/)).toBeVisible();
    await page.getByLabel('Срок').selectOption('expired');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Просрочен 22 дня назад');

    await page.getByRole('radio', { name: 'Полисы' }).check();
    await expect(page.getByText('По этим фильтрам документов нет.')).toBeVisible();
    await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
    await expect(rows).toHaveCount(10);
  });

  test('срок — словами: просрочен, истекает, бессрочно', async ({ page }) => {
    await openApp(page, '/documents');
    const row = (title: RegExp) => page.getByRole('listitem').filter({ has: link(page, title) });
    await expect(row(/Гарантия на водонагреватель/)).toContainText('Просрочен 22 дня назад');
    await expect(row(/Страховка дачи/)).toContainText('Истекает через 23 дня');
    await expect(row(/Загранпаспорт/)).toContainText('Истекает через 84 дня');
    await expect(row(/Полис ОМС/)).toContainText('бессрочно');
    await expect(row(/Водительское удостоверение/)).toContainText('до 30 июн. 2031');
  });
});

test.describe('карточка объекта: шесть вкладок', () => {
  test('«Обзор», «Коммуналка», «Счётчики», «Документы», «Люди», «Лента»', async ({ page }) => {
    await openApp(page, '/home/sadovaya');
    const tabs = page.getByRole('navigation', { name: 'Разделы объекта' });
    await expect(tabs.getByRole('link')).toHaveText([
      'Обзор',
      'Коммуналка',
      'Счётчики',
      'Документы',
      'Люди',
      'Лента',
    ]);
    await expect(tabs.getByRole('link', { name: 'Обзор' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 2, name: 'Ближайшее' })).toBeVisible();

    const expected: readonly (readonly [string, string])[] = [
      ['Коммуналка', 'Лицевые счета'],
      ['Счётчики', 'Счётчики'],
      ['Документы', 'Документы объекта'],
      ['Люди', 'Люди и организации'],
      ['Лента', 'Лента'],
    ];
    for (const [tab, heading] of expected) {
      await tabs.getByRole('link', { name: tab }).click();
      await expect(tabs.getByRole('link', { name: tab })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
    }
  });

  test('«Коммуналка»: счета с номерами, которые копируются, и начисления с суммами', async ({
    page,
  }) => {
    await openApp(page, '/home/sadovaya/utilities');
    await expect(
      page.getByRole('heading', { level: 3, name: 'Водоснабжение и водоотведение' }),
    ).toBeVisible();
    await expect(page.getByText('Госуслуги Дом, 20–25 числа').first()).toBeVisible();

    await page.getByRole('button', { name: 'Скопировать номер лицевого счёта' }).first().click();
    await expect(toast(page)).toContainText('Скопировано: номер лицевого счёта');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('4012-557-0931');

    const charges = page.getByRole('list').filter({ hasText: 'Взнос на капремонт' }).last();
    await expect(charges).toContainText('Оплачено');
    await expect(charges).toContainText('К оплате до 22 окт.');
    await expect(charges).toContainText('Просрочено');
    expect(plain(await charges.innerText())).toContain('1 840,50 ₽');
  });

  test('«Счётчики»: у каждого место, заводской номер, последнее значение и поверка', async ({
    page,
  }) => {
    await openApp(page, '/home/sadovaya/meters');
    await expect(page.getByRole('listitem').filter({ hasText: 'ГВС · Ванная' })).toContainText(
      'поверка до 18 апр. 2027',
    );
    await expect(page.getByRole('listitem').filter({ hasText: 'ХВС · Кухня' })).toContainText(
      '№ 0412-8831',
    );
    await expect(page.getByRole('listitem').filter({ hasText: 'Электроэнергия' })).toContainText(
      '14 827',
    );
  });

  test('на сдаваемой квартире и даче свой набор вкладок и данных', async ({ page }) => {
    await openApp(page, '/home/rechnaya/utilities');
    await expect(page.getByText('Арендатор').first()).toBeVisible();
    await openApp(page, '/home/sosnovka/feed');
    await expect(page.getByText('Дача закрыта на зиму')).toBeVisible();
    await expect(page.getByRole('link', { name: /Проводка на даче/ })).toBeVisible();
  });
});

test('«Коммуналка за месяц»: суммы по объектам и по всем вместе сходятся', async ({ page }) => {
  await openApp(page, '/home');
  await link(page, /Коммуналка за месяц/).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Коммуналка за месяц');

  const section = (title: string) =>
    page.locator('.section').filter({ has: page.getByRole('heading', { level: 2, name: title }) });
  const row = (block: ReturnType<typeof section>, label: string) =>
    block.locator('.facts__item').filter({ hasText: label });

  const all = section('Все объекты вместе');
  await expect(row(all, 'Начислено')).toContainText('16 620,50 ₽');
  await expect(row(all, 'Оплачено')).toContainText('12 660 ₽');
  await expect(row(all, 'К оплате')).toContainText('3 960,50 ₽');

  const sadovaya = section('Квартира на Садовой');
  await expect(row(sadovaya, 'Начислено')).toContainText('11 710,50 ₽');
  await expect(row(sadovaya, 'К оплате')).toContainText('3 320,50 ₽');
  await expect(sadovaya).toContainText('Показания: передать до 25 окт.');
  await expect(section('Квартира на Речной')).toContainText('Показания: передать до 23 окт.');
  await expect(section('Дача «Сосновка»')).toContainText('Показания: окно закрыто');

  await sadovaya.getByRole('link', { name: 'Счета и начисления' }).click();
  await expect(page).toHaveURL(/#\/home\/sadovaya\/utilities$/);
});

test.describe('«Люди»', () => {
  test('участники дома с ролями, организации и мастера, личные контакты', async ({ page }) => {
    await openApp(page, '/people');
    const members = page.getByRole('list', { name: 'Участники дома' });
    await expect(members).toContainText('Анна Орлова (вы)');
    await expect(members).toContainText('Взрослый');
    await expect(members).toContainText('Игорь Орлов');
    await expect(members).toContainText('Администратор');
    await expect(members).toContainText('Ника Орлова');
    await expect(members).toContainText('Ребёнок · видит записи «Вся семья»');
    await expect(
      page.getByRole('list', { name: 'Организации и мастера' }).getByRole('listitem'),
    ).toHaveCount(5);
    await expect(
      page.getByRole('list', { name: 'Личные контакты' }).getByRole('listitem'),
    ).toHaveCount(2);
  });

  test('карточка организации: два телефона, адрес, часы работы, связанные объекты', async ({
    page,
  }) => {
    await openApp(page, '/people');
    await link(page, /УК «Уют-Сервис»/).click();
    await expect(page.getByText('Аварийная служба, круглосуточно')).toBeVisible();
    await expect(page.getByRole('link', { name: '+7 (900) 555-01-11' })).toBeVisible();
    await expect(page.getByText('Пн–Пт 9:00–18:00')).toBeVisible();
    await expect(link(page, /Квартира на Садовой/)).toBeVisible();

    await page.getByRole('button', { name: 'На карте' }).click();
    await expect(toast(page)).toContainText('В прототипе карта не открывается');
  });

  test('карточка мастера: история работ и «звать снова»', async ({ page }) => {
    await openApp(page, '/people/plumber');
    await expect(page.getByRole('heading', { level: 2, name: 'История' })).toBeVisible();
    await expect(page.getByText('Замена смесителя на кухне')).toBeVisible();
    expect(
      plain(await page.getByRole('listitem').filter({ hasText: 'Замена смесителя' }).innerText()),
    ).toContain('3 500 ₽ · звать снова');
  });
});

test.describe('«Ещё»', () => {
  test('каждая строка ведёт на свой экран', async ({ page }) => {
    await openApp(page, '/more');
    const rows: readonly (readonly [RegExp, string])[] = [
      [/^Заметки/, 'Заметки'],
      [/^Покупки/, 'Покупки'],
      [/^Радар/, 'Радар'],
      [/^Настройки/, 'Настройки'],
      [/^Корзина/, 'Корзина'],
      [/^Экспорт/, 'Экспорт'],
      [/^Как устроены личное и общее/, 'Как устроены личное и общее'],
    ];
    for (const [name, heading] of rows) {
      await openApp(page, '/more');
      await page.getByRole('list', { name: 'Разделы' }).getByRole('link', { name }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
      await page.getByRole('link', { name: 'Ещё', exact: true }).first().click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ещё');
    }
  });

  test('заглушки объясняют, что здесь будет', async ({ page }) => {
    await openApp(page, '/more/settings');
    await expect(page.getByText('Перенос из LifeOS и сведения о системе.')).toBeVisible();
    await openApp(page, '/more/export');
    await expect(page.getByText('Чужое личное в экспорт дома не попадает.')).toBeVisible();
    await openApp(page, '/more/trash');
    await expect(page.getByText('Удалённое хранится 30 дней, потом исчезает.')).toBeVisible();
  });

  test('«Как устроены личное и общее»: три значка, переключатель и оговорка о доступе администратора сервера', async ({
    page,
  }) => {
    await openApp(page, '/more/spaces');
    for (const [label, hint] of [
      ['Только я', 'Видите только вы'],
      ['Взрослые', 'Видят все взрослые дома'],
      ['Вся семья', 'Видят все в доме, включая детей'],
    ] as const) {
      await expect(page.locator('.spaces-list li').filter({ hasText: label })).toContainText(hint);
    }
    await expect(
      page.getByText('технически может прочитать любые незашифрованные записи'),
    ).toBeVisible();
  });

  test('«Покупки»: купить и вернуть', async ({ page }) => {
    await openApp(page, '/more/shopping');
    await checkbox(page, 'Молоко, 2 л').click();
    await expect(toast(page)).toContainText('Куплено');
    await expect(checkbox(page, 'Молоко, 2 л')).toBeChecked();
    await expect(page.locator('.task-row').filter({ hasText: 'Молоко, 2 л' })).toContainText(
      'Куплено',
    );
    await toast(page).getByRole('button', { name: 'Отменить' }).click();
    await expect(checkbox(page, 'Молоко, 2 л')).not.toBeChecked();
  });

  test('«Радар»: пункты по горизонтам с основными действиями', async ({ page }) => {
    await openApp(page, '/more/radar');
    for (const group of ['Просрочено', 'Сейчас', '7 дней', '30 дней', '90 дней']) {
      await expect(page.getByRole('heading', { level: 2, name: group })).toBeVisible();
    }
    await expect(link(page, /Окно показаний: вода и электроэнергия/)).toContainText(
      'Внести показания',
    );
    await expect(link(page, /Страховка дачи/)).toContainText('Продлить');
    await expect(link(page, /Оплата: взнос на капремонт/)).toContainText('Отметить оплату');
    await link(page, /Окно показаний: вода и электроэнергия/).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Показания');
  });
});

test('«Дом»: карточка объекта открывается из списка, назад возвращает в «Дом»', async ({
  page,
}) => {
  await openApp(page, '/today');
  await goToSection(page, 'Дом');
  await link(page, /Дача «Сосновка»/).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Дача «Сосновка»');
  await page.getByRole('link', { name: 'Дом', exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Дом');
});
