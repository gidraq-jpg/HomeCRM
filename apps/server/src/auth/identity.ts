// Имя для входа, служебный адрес почты и одноразовые ссылки: мелкие правила входа, общие для
// настроек библиотеки и собственных маршрутов.
import { createHash, randomBytes } from 'node:crypto';

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;

/** Имя для входа не зависит от регистра и вида Unicode: «Вера» и «вера» — одно имя (AUTH-9). */
export function normalizeUsername(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

/** Буквы любого алфавита, цифры, точка, дефис и подчёркивание; начинается с буквы или цифры. */
export function isValidUsername(value: string): boolean {
  return /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(value);
}

/**
 * Better Auth требует адрес почты у каждой учётной записи, а ребёнку он не нужен (AUTH-9):
 * вместо него — служебный адрес в зоне .invalid, которую RFC 2606 оставил для несуществующих
 * адресов. Письма на него не уходят, а войти по нему нельзя (маршрут входа по почте его отвергает).
 */
export const PLACEHOLDER_EMAIL_DOMAIN = 'no-email.homecrm.invalid';

export function placeholderEmail(unique: string): string {
  return `${unique}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

export function isPlaceholderEmail(email: string): boolean {
  return /\.invalid$/i.test(email.trim());
}

/** Ссылка-приглашение: 256 случайных бит, в базе — только SHA-256. Перебрать её нельзя, соль не нужна. */
export const INVITATION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export function newInvitationToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}
