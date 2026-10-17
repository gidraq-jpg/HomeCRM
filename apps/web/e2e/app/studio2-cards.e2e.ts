import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
} from '../support/helpers.ts';
import { seedDocument } from './documents-support.ts';
import { apiAs, seedNote } from './notes-support.ts';
import { seedOrganization, seedPerson } from './people-support.ts';
import { seedProperty } from './property-support.ts';
import { closeRecordActions } from './record-actions.ts';
import { signInAs } from './support.ts';

const phase = process.env.UI6_PHASE === 'before' ? 'before' : 'after';

test('UI-6: карточки, списки и формы Studio 2', async ({ page, family }, info) => {
  test.setTimeout(240_000);
  const api = await apiAs(family, 'adult');
  const _object = await seedProperty(api, family, {
    title: 'Вымышленная квартира',
    typeData: { address: 'ул. Примерная, 12' },
  });
  const note = await seedNote(api, family, {
    title: 'Вымышленная заметка',
    body: '## На выходные\nПроверить запасы и полить цветы.',
    checklist: [{ title: 'Проверить фильтр' }],
    audience: 'household',
  });
  const person = await seedPerson(api, {
    title: 'Вымышленный мастер',
    data: { phones: [{ number: '+79990000001', label: 'Рабочий' }] },
    placement: { spaceId: family.houseId, audience: 'household' },
  });
  const organization = await seedOrganization(api, { title: 'Вымышленная мастерская' });
  const doc = await seedDocument(api, {
    title: 'Вымышленный договор',
    type: 'other',
    indefinite: true,
  });
  const created = await api.post('tasks', {
    title: 'Проверить вымышленный фильтр',
    description: 'Осмотреть корпус и заменить картридж.',
    checklist: [{ id: crypto.randomUUID(), title: 'Проверить корпус', done: false, position: 0 }],
  });
  expect(created.status).toBe(201);
  const task = created.body as { id: string };
  await signInAs(page, family, 'adult');
  const screens = [
    ['task', `/today/tasks/${task.id}`],
    ['note', `/more/notes/${note.id}`],
    ['person', `/people/contacts/${person.id}`],
    ['document', `/documents/${doc.id}`],
    ['organization', `/more/organizations/${organization.id}`],
    ['objects', '/home'],
    ['documents', '/documents'],
    ['people', '/people'],
    ['organizations', '/more/organizations'],
    ['new-task', '/today/new'],
    ['new-note', '/more/notes/new'],
    ['new-object', '/home/new'],
    ['new-document', '/documents/new'],
    ['new-person', '/people/contacts/new'],
    ['new-organization', '/more/organizations/new'],
    ['templates', '/home/from-template'],
    ['new-template', '/home/from-template/apartment'],
  ] as const;
  const dir = resolve(import.meta.dirname, '../../../../docs/screenshots/UI-6', phase);
  await mkdir(dir, { recursive: true });
  for (const percent of phase === 'before' ? [100] : [100, 200]) {
    await page.evaluate((p) => {
      document.documentElement.style.fontSize = `${p}%`;
    }, percent);
    for (const [name, route] of screens) {
      await page.goto(`#${route}`);
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByText(/^Загружаем/)).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      if (phase === 'after') {
        await expectNoHorizontalScroll(page);
        await expectAccessible(page, name);
        await expectTouchTargets(page);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: resolve(dir, `${name}-${info.project.name}-${percent}.png`),
        fullPage: true,
      });
      if (phase === 'after' && (await page.locator('.ui6-record-page').count())) {
        await page.getByRole('button', { name: 'Ещё: действия с записью' }).click();
        await expect(page.getByRole('dialog', { name: 'Ещё', exact: true })).toBeVisible();
        await expectAccessible(page, `${name}-more`);
        await expectTouchTargets(page);
        await page.screenshot({
          path: resolve(dir, `${name}-more-${info.project.name}-${percent}.png`),
        });
        await closeRecordActions(page);
        if (name === 'person' || name === 'organization') {
          await expect(page.getByRole('button', { name: 'Кто видит запись' })).toHaveCount(0);
        } else {
          await page.getByRole('button', { name: 'Кто видит запись' }).click();
          await expect(page.getByRole('dialog')).toBeVisible();
          await expectAccessible(page, `${name}-access`);
          await expectTouchTargets(page);
          await page
            .getByRole('dialog')
            .getByRole('button', { name: 'Закрыть', exact: true })
            .click();
        }
        await page
          .getByRole('button', { name: name === 'task' ? 'Править дело' : 'Править', exact: true })
          .click();
        await expect(page.locator('.ui6-panel form')).toBeVisible();
        await expectNoHorizontalScroll(page);
        await expectAccessible(page, `${name}-edit`);
        await page.screenshot({
          path: resolve(dir, `${name}-edit-${info.project.name}-${percent}.png`),
          fullPage: true,
        });
        await page
          .locator('.ui6-panel form')
          .getByRole('button', { name: 'Отмена', exact: true })
          .click();
      }
    }
  }
});

test('UI-6: пустые списки и формы, текст 100/200%', async ({ page, family }, info) => {
  test.skip(phase === 'before', 'Исходная съёмка выполнена отдельно.');
  test.setTimeout(180_000);
  await signInAs(page, family, 'adult');
  const dir = resolve(import.meta.dirname, '../../../../docs/screenshots/UI-6/after');
  await mkdir(dir, { recursive: true });
  const routes = [
    ['objects', '/home'],
    ['documents', '/documents'],
    ['people', '/people'],
    ['organizations', '/more/organizations'],
    ['new-task', '/today/new'],
    ['new-note', '/more/notes/new'],
    ['new-object', '/home/new'],
    ['new-document', '/documents/new'],
    ['new-person', '/people/contacts/new'],
    ['new-organization', '/more/organizations/new'],
  ] as const;
  for (const percent of [100, 200]) {
    await page.evaluate((p) => {
      document.documentElement.style.fontSize = `${p}%`;
    }, percent);
    for (const [name, route] of routes) {
      await page.goto(`#${route}`);
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByText(/^Загружаем/)).toHaveCount(0);
      await expectNoHorizontalScroll(page);
      await expectAccessible(page, `${name}-empty`);
      await expectTouchTargets(page);
      await page.screenshot({
        path: resolve(dir, `${name}-empty-${info.project.name}-${percent}.png`),
        fullPage: true,
      });
      if (name.startsWith('new-')) {
        const input = page.locator('form input[type="text"], form input:not([type])').first();
        await expect(input).toBeVisible();
        await input.fill('Вымышленная запись формы');
        await expect(input).toHaveValue('Вымышленная запись формы');
        await expectNoHorizontalScroll(page);
        await expectAccessible(page, `${name}-filled`);
        await page.screenshot({
          path: resolve(dir, `${name}-filled-${info.project.name}-${percent}.png`),
          fullPage: true,
        });
      }
    }
  }
});

test('UI-6: ребёнку недоступны взрослые и чужие личные карточки', async ({ page, family }) => {
  test.skip(phase === 'before', 'Исходная съёмка выполнена отдельно.');
  test.setTimeout(120_000);
  const api = await apiAs(family, 'adult');
  const forbidden: { route: string; title: string }[] = [];
  for (const audience of ['adults', null] as const) {
    const placement = audience
      ? { spaceId: family.houseId, audience }
      : { spaceId: family.person('adult').personalSpaceId };
    const title = audience ? 'Закрытая взрослая запись' : 'Чужая личная запись';
    for (const [collection, fields, route] of [
      ['tasks', {}, '/today/tasks/'],
      ['notes', {}, '/more/notes/'],
      ['objects', { objectType: 'other' }, '/home/'],
      ['documents', { data: { type: 'other' } }, '/documents/'],
      ['contacts', { kind: 'person' }, '/people/contacts/'],
      ['contacts', { kind: 'organization' }, '/more/organizations/'],
    ] as const) {
      const result = await api.post(collection, { title, ...fields, placement });
      expect(result.status).toBe(201);
      forbidden.push({ route: route + (result.body as { id: string }).id, title });
    }
  }
  const visible = await seedPerson(api, {
    title: 'Открытый вымышленный контакт',
    placement: { spaceId: family.houseId, audience: 'household' },
  });
  await signInAs(page, family, 'child');
  for (const route of ['/home', '/documents', '/people', '/more/organizations']) {
    await page.goto(`#${route}`);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.getByText(/^Загружаем/)).toHaveCount(0);
    await expect(page.getByRole('main')).not.toContainText('Закрытая взрослая запись');
    await expect(page.getByRole('main')).not.toContainText('Чужая личная запись');
  }
  await page.goto(`#/people/contacts/${visible.id}`);
  await expect(
    page.getByRole('heading', { name: 'Открытый вымышленный контакт', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Править', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ещё: действия с записью' }).click();
  await expect(page.getByRole('button', { name: 'В корзину', exact: true })).toHaveCount(0);
  await closeRecordActions(page);
  for (const item of forbidden) {
    await page.goto(`#${item.route}`);
    await expect(page.getByText(/^Загружаем/)).toHaveCount(0);
    await expect(
      page.getByRole('heading', { level: 1, name: item.title, exact: true }),
    ).toHaveCount(0);
    await expect(page.locator('.ui6-record-page')).toHaveCount(0);
  }
});

test('UI-6: файлы, версии и взаимодействия в группах Studio 2', async ({ page, family }, info) => {
  test.skip(phase === 'before', 'Исходная съёмка выполнена отдельно.');
  test.setTimeout(180_000);
  const api = await apiAs(family, 'adult');
  const note = await seedNote(api, family, {
    title: 'Вымышленная инструкция',
    body: 'Памятка по фильтру.',
    audience: 'household',
  });
  const file = await api.upload(`notes/${note.id}/files`, {
    name: 'Вымышленная квитанция.pdf',
    type: 'application/pdf',
    data: Buffer.from('%PDF-1.7\nfictional receipt\n%%EOF'),
  });
  expect(file.status).toBe(201);
  const doc = await seedDocument(api, {
    title: 'Вымышленная страховка',
    type: 'other',
    indefinite: true,
  });
  const old = (await api.get(`documents/${doc.id}`)).body as {
    data: Record<string, unknown>;
    updatedAt: string;
  };
  const renewal = await api.post(`documents/${doc.id}/renew`, {
    title: 'Вымышленная страховка',
    data: old.data,
    expectedUpdatedAt: old.updatedAt,
  });
  expect(renewal.status).toBe(201);
  const person = await seedPerson(api, {
    title: 'Вымышленный мастер с историей',
    placement: { spaceId: family.houseId, audience: 'household' },
  });
  expect(
    (
      await api.post(`contacts/${person.id}/interactions`, {
        kind: 'work',
        text: 'Заменён вымышленный фильтр',
        occurredOn: '2026-10-16',
        amountCents: 184050,
        callAgain: true,
      })
    ).status,
  ).toBe(201);
  await signInAs(page, family, 'adult');
  const dir = resolve(import.meta.dirname, '../../../../docs/screenshots/UI-6/after');
  for (const percent of [100, 200]) {
    await page.evaluate((p) => {
      document.documentElement.style.fontSize = `${p}%`;
    }, percent);
    for (const [name, route] of [
      ['rich-note', `/more/notes/${note.id}`],
      ['rich-document', `/documents/${(renewal.body as { id: string }).id}`],
      ['rich-person', `/people/contacts/${person.id}`],
    ] as const) {
      await page.goto(`#${route}`);
      await expect(page.locator('.ui6-record-page')).toBeVisible();
      await expect(page.getByText(/^Загружаем/)).toHaveCount(0);
      await expectNoHorizontalScroll(page);
      await expectAccessible(page, name);
      await expectTouchTargets(page);
      await page.screenshot({
        path: resolve(dir, `${name}-${info.project.name}-${percent}.png`),
        fullPage: true,
      });
    }
  }
});
