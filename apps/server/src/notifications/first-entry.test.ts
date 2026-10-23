import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { MIGRATIONS_DIR, runMigrations } from '../../../../packages/db/src/migrate.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World, folder: string;
afterAll(async () => {
  await world?.close();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('TPL-5: миграция отмечает всех прежних участников, даже без строки настроек', async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-first-entry-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 65);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal), 'utf8');
  for (const e of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${e.tag}.sql`), join(folder, `${e.tag}.sql`));
  world = await createWorld({ migrationsFolder: folder });
  await world.database.admin.query(
    'INSERT INTO notification_settings(account_id,today_main_enabled) VALUES($1,false)',
    [world.boris.id],
  );
  await runMigrations(world.database.owner);
  const rows = (
    await world.database.admin.query(
      'SELECT first_entry_shown,today_main_enabled FROM notification_settings',
    )
  ).rows;
  expect(rows).toHaveLength(3);
  expect(rows.every((r) => r.first_entry_shown)).toBe(true);
  expect(rows.filter((r) => !r.today_main_enabled)).toHaveLength(1);
});
it('TPL-5: новый участник, серверная отметка, второй вход, чужой участник и запрет сброса', async () => {
  await world.close();
  world = await createWorld();
  const device = world.device(),
    other = world.device();
  await device.signIn(world.boris.username, world.boris.password);
  await other.signIn(world.vera.username, world.vera.password);
  expect((await device.get('/api/me')).json()).toMatchObject({ firstEntryShown: false });
  expect(
    (
      await device.request('PATCH', '/api/notifications/settings', {
        json: { firstEntryShown: true },
      })
    ).status,
  ).toBe(200);
  expect((await device.get('/api/me')).json()).toMatchObject({ firstEntryShown: true });
  expect((await other.get('/api/me')).json()).toMatchObject({ firstEntryShown: false });
  expect(
    (
      await device.request('PATCH', '/api/notifications/settings', {
        json: { firstEntryShown: false },
      })
    ).status,
  ).toBe(400);
  const second = world.device();
  await second.signIn(world.boris.username, world.boris.password);
  expect((await second.get('/api/me')).json()).toMatchObject({ firstEntryShown: true });
});
