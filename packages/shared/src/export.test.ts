import { expect, it } from 'vitest';
import { ExportManifest, ExportRecords, ExportRequest } from './export.ts';

const randomUUID = () => '71393e34-1828-458e-b236-555dfe6f3ba3';

it('DATA-2: формат версии 1 проверяет область, подтверждение, пояс и счётчики', () => {
  expect(
    ExportRequest.safeParse({ scope: { kind: 'personal' }, password: 'fictional', confirmed: true })
      .success,
  ).toBe(true);
  expect(
    ExportRequest.safeParse({
      scope: { kind: 'household', householdId: randomUUID() },
      password: 'fictional',
      confirmed: true,
    }).success,
  ).toBe(true);
  for (const scope of [{ kind: 'personal', ownerId: randomUUID() }, { kind: 'household' }])
    expect(ExportRequest.safeParse({ scope, password: 'fictional', confirmed: true }).success).toBe(
      false,
    );
  expect(
    ExportRequest.safeParse({
      scope: { kind: 'personal' },
      password: 'fictional',
      confirmed: false,
    }).success,
  ).toBe(false);
  const manifest = {
    format: 'homecrm',
    version: 1,
    exportedAt: new Date().toISOString(),
    timeZone: 'Asia/Yekaterinburg',
    scope: { kind: 'personal' },
    includesTrash: true,
    counts: { notes: 1000 },
  };
  expect(ExportManifest.safeParse(manifest).success).toBe(true);
  for (const change of [{ version: 2 }, { timeZone: 'invalid' }, { counts: { notes: -1 } }])
    expect(ExportManifest.safeParse({ ...manifest, ...change }).success).toBe(false);
});
it('DATA-2: конверты и storage keys не являются полями экспортируемого файла', () => {
  const file = {
    id: randomUUID(),
    account_id: randomUUID(),
    title: 'Фото',
    mime_type: 'image/jpeg',
    size_bytes: 1,
    created_at: new Date().toISOString(),
    deleted_at: null,
    archive_path: 'files/photo.jpg',
  };
  expect(ExportRecords.profile_files.safeParse(file).success).toBe(true);
  for (const field of ['storage_key', 'envelope', 'preview_envelope'])
    expect(ExportRecords.profile_files.safeParse({ ...file, [field]: 'private' }).success).toBe(
      false,
    );
});
