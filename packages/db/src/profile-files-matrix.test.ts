// OBJ-4: семейная аудитория профиля, снятые фото, несколько домов и уход участника.
import { randomUUID } from 'node:crypto';
import { canViewProfileFile, canWriteProfileFile } from '@homecrm/shared';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { eq, memberProfiles, profileFiles, sql } from './index.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { createScene, type Scene } from './testing/helpers.ts';
import { hasCode } from './testing/matrix.ts';

let db: TestDatabase, scene: Scene;
const fixture = (accountId: string) => ({
  accountId,
  title: 'Вымышленное фото.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 32,
  storageKey: randomUUID(),
  envelope: {},
  previewStorageKey: randomUUID(),
  previewEnvelope: {},
});
beforeAll(async () => {
  db = await createTestDatabase(inject('pgAdminUrl'));
  scene = await createScene(db);
  for (const owner of scene.family.people) {
    const [current] = await db.admin
      .query(
        `INSERT INTO profile_files(account_id,title,mime_type,size_bytes,storage_key,envelope) VALUES ($1,'Фото','image/jpeg',32,gen_random_uuid(),'{}') RETURNING id`,
        [owner.id],
      )
      .then((r) => r.rows);
    await scene.as(owner.key, (tx) =>
      tx
        .update(memberProfiles)
        .set({ photoFileId: current.id })
        .where(eq(memberProfiles.accountId, owner.id)),
    );
    await db.admin.query(
      `INSERT INTO profile_files(account_id,title,mime_type,size_bytes,storage_key,envelope,deleted_at) VALUES ($1,'Снятое фото','image/jpeg',32,gen_random_uuid(),'{}',now())`,
      [owner.id],
    );
    // Живой, но не выбранный файл не становится публичным по одному UUID.
    await db.admin.query(
      `INSERT INTO profile_files(account_id,title,mime_type,size_bytes,storage_key,envelope) VALUES ($1,'Не выбранное фото','image/jpeg',32,gen_random_uuid(),'{}')`,
      [owner.id],
    );
  }
});
afterAll(async () => {
  await db?.drop();
});

async function matrix() {
  const files = (
    await db.admin.query(
      `SELECT f.*, p.photo_file_id=f.id current FROM profile_files f JOIN member_profiles p ON p.account_id=f.account_id`,
    )
  ).rows;
  const memberships = (
    await db.admin.query('SELECT account_id,space_id,left_at FROM space_members')
  ).rows;
  let checks = 0;
  for (const viewer of scene.family.people) {
    const liveHouses = memberships
      .filter((m) => m.account_id === viewer.id && m.left_at === null)
      .map((m) => m.space_id);
    const currentViewer = {
      accountId: viewer.id,
      memberships: new Map(
        [...viewer.viewer.memberships].filter(([id]) => liveHouses.includes(id)),
      ),
    };
    const visible = await scene.as(viewer.key, (tx) => tx.select().from(profileFiles));
    for (const file of files) {
      const label = `${viewer.key}/${file.id}`;
      const houses = memberships
        .filter((m) => m.account_id === file.account_id && m.left_at === null)
        .map((m) => m.space_id);
      expect(
        visible.some((row) => row.id === file.id),
        label,
      ).toBe(
        canViewProfileFile(
          currentViewer,
          file.account_id,
          houses,
          file.deleted_at !== null,
          file.current,
        ),
      );
      const changed = await scene.as(viewer.key, async (tx) => {
        await tx.execute(sql`SAVEPOINT probe`);
        try {
          return (
            (
              await tx
                .update(profileFiles)
                .set({ deletedAt: file.deleted_at ? null : new Date() })
                .where(eq(profileFiles.id, file.id))
                .returning()
            ).length === 1
          );
        } finally {
          await tx.execute(sql`ROLLBACK TO SAVEPOINT probe`);
        }
      });
      expect(changed, label).toBe(canWriteProfileFile(currentViewer, file.account_id));
      checks += 2;
    }
    for (const owner of scene.family.people) {
      const inserted = await scene.as(viewer.key, async (tx) => {
        await tx.execute(sql`SAVEPOINT probe`);
        try {
          await tx.insert(profileFiles).values(fixture(owner.id));
          return true;
        } catch (error) {
          if (!hasCode(error, ['42501'])) throw error;
          return false;
        } finally {
          await tx.execute(sql`ROLLBACK TO SAVEPOINT probe`);
        }
      });
      expect(inserted, `${viewer.key}/insert/${owner.key}`).toBe(
        canWriteProfileFile(currentViewer, owner.id),
      );
      checks++;
    }
  }
  expect(checks).toBe(252);
}
it('матрица чтения, загрузки, снятия и восстановления совпадает с access.ts: 252 проверки', matrix);
it('после ухода из одного из двух домов доступ сохраняется только в другом: ещё 252 проверки', async () => {
  await db.admin.query(
    `UPDATE space_members SET left_at=now(),left_by=account_id WHERE account_id=$1 AND space_id=$2`,
    [scene.person('mila').id, scene.home('household').spaceId],
  );
  await matrix();
});
it('SQL запрещает PDF, изменение содержимого, чужую привязку и подмену даты корзины', async () => {
  await expect(
    scene.as('boris', (tx) =>
      tx
        .insert(profileFiles)
        .values({ ...fixture(scene.person('boris').id), mimeType: 'application/pdf' }),
    ),
  ).rejects.toSatisfy((e: unknown) => hasCode(e, ['23514']));
  const [file] = await scene.as('boris', (tx) =>
    tx
      .insert(profileFiles)
      .values(fixture(scene.person('boris').id))
      .returning(),
  );
  if (!file) throw new Error('File missing');
  await expect(
    scene.as('boris', (tx) =>
      tx.update(profileFiles).set({ storageKey: randomUUID() }).where(eq(profileFiles.id, file.id)),
    ),
  ).rejects.toSatisfy((e: unknown) => hasCode(e, ['42501']));
  await expect(
    scene.as('anna', (tx) =>
      tx
        .update(memberProfiles)
        .set({ photoFileId: file.id })
        .where(eq(memberProfiles.accountId, scene.person('anna').id)),
    ),
  ).rejects.toSatisfy((e: unknown) => hasCode(e, ['42501']));
  const [trashed] = await scene.as('boris', (tx) =>
    tx
      .update(profileFiles)
      .set({ deletedAt: new Date(0) })
      .where(eq(profileFiles.id, file.id))
      .returning(),
  );
  expect(trashed?.deletedAt?.getTime()).toBeGreaterThan(Date.now() - 60_000);
  await expect(db.auth.query('SELECT * FROM profile_files')).rejects.toMatchObject({
    code: '42501',
  });
  expect((await db.owner.query('SELECT * FROM profile_files')).rows).toEqual([]);
});
