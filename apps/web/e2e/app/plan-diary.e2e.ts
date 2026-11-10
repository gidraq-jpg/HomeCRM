import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
} from '../support/helpers.ts';
import { homeDate, setHomeZone } from './deadlines-support.ts';
import { apiAs } from './notes-support.ts';
import { signInAs } from './support.ts';

test('TASK-5: ежедневник, история, неделя, без даты и воскресный разбор', async ({
  page,
  family,
}, info) => {
  await page.setViewportSize({ width: info.project.name === 'w360' ? 360 : 412, height: 800 });
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const make = async (fields: object) => {
    const r = await api.post('tasks', {
      title: 'Учебное дело',
      placement: { spaceId: family.houseId, audience: 'household' },
      ...fields,
    });
    expect(r.status).toBe(201);
    return r.body as { id: string };
  };
  for (let i = 0; i < 8; i++) await make({ title: `Сегодняшнее дело ${i}`, planOn: homeDate(0) });
  await make({ title: 'Завтрашнее дело', planOn: homeDate(1) });
  const weekOffset = (new Date(`${homeDate(0)}T12:00:00Z`).getUTCDay() + 6) % 7;
  const futureSunday = homeDate(20 - weekOffset);
  await make({ title: 'Дело в конце будущей недели', planOn: futureSunday });
  await make({ title: 'Просроченное дело', planOn: homeDate(-2) });
  await make({ title: 'Давнее открытое дело', planOn: homeDate(-20) });
  await make({ title: 'Ещё более давнее дело', planOn: homeDate(-40) });
  const done = await make({ title: 'Выполненное вчера', planOn: homeDate(-3) });
  expect((await api.post(`tasks/${done.id}/status`, { status: 'done' })).status).toBe(200);
  await family.database.admin.query('UPDATE tasks SET done_at=$1::timestamptz WHERE id=$2', [
    `${homeDate(-1)}T23:30:00+03:00`,
    done.id,
  ]);
  // Только изолированная вымышленная база: возраст фикстуры задаём при отключённом guard.
  await family.database.admin.query('ALTER TABLE tasks DISABLE TRIGGER USER');
  try {
    await family.database.admin.query(
      "INSERT INTO tasks(space_id,space_kind,audience,author_id,assignee_id,household_id,title,created_at) VALUES($1,'household','household',$2,$2,$1,'Давняя идея',$3::timestamptz)",
      [family.houseId, family.person('adult').id, `${homeDate(-24)}T12:00:00+03:00`],
    );
  } finally {
    await family.database.admin.query('ALTER TABLE tasks ENABLE TRIGGER USER');
  }
  const pastRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    const cursor = url.searchParams.get('cursor');
    if (url.pathname === '/api/tasks/plan' && cursor && cursor < homeDate(0))
      pastRequests.push(cursor);
  });
  await signInAs(page, family, 'adult');
  await page.goto('#/today/plan');
  await expect(page.getByRole('navigation', { name: 'Неделя плана' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Сегодняшнее дело 0', exact: true }),
  ).toBeInViewport();
  const shot = async (name: string) => {
    await expectNoHorizontalScroll(page);
    const y = await page.evaluate(() => window.scrollY);
    await expectAccessible(page, name);
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await expectTouchTargets(page);
    const dir = resolve(import.meta.dirname, '../../test-results/screens/d49');
    await mkdir(dir, { recursive: true });
    await page.screenshot({ path: resolve(dir, `${name}-${info.project.name}.png`) });
  };
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(pastRequests).toEqual([]);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  const todayButton = page.locator('.plan-week__days button[aria-current="date"]');
  const todayColors = await todayButton.evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor,
    color: getComputedStyle(el).color,
  }));
  expect(todayColors.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(todayColors.background).not.toBe(todayColors.color);
  await shot('today');
  const browseWeek = async (name: 'Следующая неделя' | 'Предыдущая неделя') => {
    const button = page.getByRole('button', { name, exact: true });
    await expect(button).toBeEnabled();
    const box = await button.boundingBox();
    if (!box) throw new Error('Week arrow missing');
    // Координатное касание не делает предварительный scrollIntoView Playwright.
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  };
  const beforeWeek = await page.evaluate(() => scrollY);
  await browseWeek('Следующая неделя');
  await browseWeek('Следующая неделя');
  expect(await page.evaluate(() => scrollY)).toBe(beforeWeek);
  await expect(
    page.getByRole('link', { name: 'Дело в конце будущей недели', exact: true }),
  ).toHaveCount(0);
  const full = (date: string) =>
    new Intl.DateTimeFormat('ru-RU', { dateStyle: 'full', timeZone: 'UTC' }).format(
      new Date(`${date}T12:00:00Z`),
    );
  await page
    .getByRole('button', { name: `${full(futureSunday)}, дела не загружены`, exact: true })
    .click();
  await expect(
    page.getByRole('link', { name: 'Дело в конце будущей недели', exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: `${full(futureSunday)}, 1 дело`, exact: true }),
  ).toBeVisible();
  await browseWeek('Предыдущая неделя');
  await browseWeek('Предыдущая неделя');
  await page.getByRole('button', { name: `${full(homeDate(0))}, 8 дел`, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Следующая неделя', exact: true })).toBeEnabled();
  expect(pastRequests).toEqual([]);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const top = document.querySelector('.plan-week')?.getBoundingClientRect().bottom ?? 0;
        const bottom =
          document.querySelector('.bottom-nav')?.getBoundingClientRect().top ?? innerHeight;
        return [...document.querySelectorAll('.plan-diary-days .plan-row')].filter(
          (el) =>
            el.getBoundingClientRect().top >= top && el.getBoundingClientRect().bottom <= bottom,
        ).length;
      }),
    )
    .toBeGreaterThanOrEqual(5);
  await shot('sticky');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const tomorrow = page.getByRole('button', { name: new RegExp(`^${full(homeDate(1))},`) });
  await tomorrow.click();
  await expect(tomorrow).toHaveAttribute('aria-pressed', 'true');
  await tomorrow.evaluate((el) => el.blur());
  const selection = page.locator('.plan-week__selection');
  await expect(selection).toHaveCSS('opacity', '1');
  await expect(selection).toHaveCSS('transition-property', 'transform');
  await expect
    .poll(async () => {
      const frame = await selection.boundingBox();
      const day = await tomorrow.boundingBox();
      return frame && day ? Math.abs(frame.x - day.x) : 1000;
    })
    .toBeLessThan(1);
  expect(await todayButton.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    todayColors.background,
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(selection).toHaveCSS('transition-duration', '0s');
  await shot('selection');
  const beforePastWeek = await page.evaluate(() => scrollY);
  await browseWeek('Предыдущая неделя');
  expect(pastRequests).toEqual([]);
  expect(await page.evaluate(() => scrollY)).toBe(beforePastWeek);
  const pastMonday = homeDate(-weekOffset - 7);
  await page
    .getByRole('button', { name: `${full(pastMonday)}, дела не загружены`, exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('link', { name: 'Выполненное вчера · выполнено', exact: true }),
  ).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Следующая неделя', exact: true })).toBeEnabled();
  expect(pastRequests.length).toBeGreaterThan(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  const anchorTop = () =>
    page.evaluate(
      (date) =>
        [...document.querySelectorAll<HTMLElement>('[data-plan-from]')]
          .find(
            (el) =>
              (el.dataset.planFrom ?? '') <= date &&
              (el.dataset.planUntil ?? el.dataset.planFrom ?? '') >= date,
          )
          ?.getBoundingClientRect().top ?? -1000,
      homeDate(-14),
    );
  const beforePrepend = await anchorTop();
  await page.getByRole('button', { name: 'Показать предыдущие дни', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Давнее открытое дело', exact: true })).toHaveCount(
    1,
  );
  await expect.poll(async () => Math.abs((await anchorTop()) - beforePrepend)).toBeLessThan(3);
  await page.getByRole('button', { name: 'Показать предыдущие дни', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Ещё более давнее дело', exact: true })).toHaveCount(
    1,
  );
  await page
    .getByRole('link', { name: 'Выполненное вчера · выполнено', exact: true })
    .scrollIntoViewIfNeeded();
  await shot('history');
  await page.getByRole('button', { name: 'Без даты · 1', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Без даты', exact: true })).toBeVisible();
  await expect(page.getByText('лежит 3 недели')).toBeVisible();
  await shot('undated');
  await page.getByRole('button', { name: 'Назначить день: Давняя идея', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сегодня', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Сегодня', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Назначить день', exact: true })).toHaveCount(0);
  await page.goto('#/today/plan');
  await expect(page.getByRole('button', { name: /Без даты ·/ })).toHaveCount(0);
  await make({ title: 'Воскресная идея' });
  await page.route('**/api/tasks/today*', async (route) => {
    const r = await route.fetch();
    const data = await r.json();
    (data.data ?? data).today = '2026-11-15';
    await route.fulfill({ response: r, json: data });
  });
  await page.goto('#/today');
  await page.reload();
  await expect(
    page.getByRole('link', { name: 'Разобрать дела без даты: 1', exact: true }),
  ).toBeVisible();
  await shot('review');
  await page.getByRole('link', { name: 'Разобрать дела без даты: 1', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Без даты', exact: true })).toBeVisible();
});
