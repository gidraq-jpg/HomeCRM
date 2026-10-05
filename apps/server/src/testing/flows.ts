// Типовые сценарии для тестов входа: включить второй фактор, войти с кодом, получить приглашение.
import { expect } from 'vitest';
import type { Device, Reply } from './device.ts';
import { currentCode } from './totp.ts';
import type { Person, World } from './world.ts';

export interface Enrollment {
  /** Ссылка otpauth://, как её показывает приложению-аутентификатору QR-код. */
  uri: string;
  /** Десять одноразовых кодов восстановления (AUTH-4). */
  backupCodes: string[];
}

/** Включение второго фактора по шагам библиотеки: пароль → ссылка и коды → подтверждение кодом. */
export async function enrollTotp(device: Device, person: Person): Promise<Enrollment> {
  const enabled = await device.post('/api/auth/two-factor/enable', { password: person.password });
  expect(enabled.status, enabled.text).toBe(200);
  const { totpURI, backupCodes } = enabled.json<{ totpURI: string; backupCodes: string[] }>();
  const verified = await device.post('/api/auth/two-factor/verify-totp', {
    code: currentCode(totpURI),
  });
  expect(verified.status, verified.text).toBe(200);
  return { uri: totpURI, backupCodes };
}

/** Вход с паролем и кодом приложения: до кода сессии нет. */
export async function signInWithTotp(
  device: Device,
  person: Person,
  enrollment: Pick<Enrollment, 'uri'>,
): Promise<Reply> {
  const first = await device.signIn(person.username, person.password);
  expect(first.status, first.text).toBe(200);
  expect(first.json()).toMatchObject({ twoFactorRedirect: true });
  const second = await device.post('/api/auth/two-factor/verify-totp', {
    code: currentCode(enrollment.uri),
  });
  expect(second.status, second.text).toBe(200);
  return second;
}

/** Администратор, который вошёл и включил второй фактор: ему доступны данные и управление домом. */
export async function signedInAdmin(
  world: World,
  options: { userAgent?: string; ip?: string } = {},
): Promise<{ device: Device; enrollment: Enrollment }> {
  const device = world.device(options);
  const signedIn = await device.signIn(world.anna.username, world.anna.password);
  expect(signedIn.status, signedIn.text).toBe(200);
  const enrollment = await enrollTotp(device, world.anna);
  return { device, enrollment };
}

/** Администратор выдаёт приглашение; возвращает ссылку, одноразовый токен и срок. */
export async function invite(
  admin: Device,
  world: World,
  role: 'admin' | 'adult' | 'child',
): Promise<{ id: string; token: string; url: string; expiresAt: string }> {
  const created = await admin.post('/api/invitations', { householdId: world.houseId, role });
  expect(created.status, created.text).toBe(201);
  return created.json();
}

/** Принять приглашение с чистого устройства. */
export function acceptInvitation(
  device: Device,
  body: {
    token: string;
    username: string;
    displayName?: string;
    password: string;
    email?: string;
  },
): Promise<Reply> {
  return device.post('/api/auth/homecrm/invitation/accept', {
    displayName: 'Новый участник',
    ...body,
  });
}
