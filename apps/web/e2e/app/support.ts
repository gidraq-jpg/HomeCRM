import type { Page, TestInfo } from '@playwright/test';
import type { Family } from '../auth/support/family.ts';
import { expect } from '../auth/support/fixtures.ts';
import { checkAuth, expectSignedIn, signIn } from '../auth/support/helpers.ts';

export { expect, expectSignedIn };

/** Вымышленные данные, по которым видно, что в рабочее приложение не просочился прототип. */
export const PROTOTYPE_MARKERS = [
  'Орлов',
  'Садовой',
  'Сосновка',
  'Страховка дачи',
  'Пётр Семёнов',
  'прототип',
] as const;

/**
 * Вход под ролью. Администратору второй фактор обязателен (AUTH-3): он включается заранее,
 * а вход идёт по резервному коду — так сценарий не зависит от часов.
 */
export async function signInAs(page: Page, family: Family, role: 'admin' | 'adult' | 'child') {
  if (role === 'admin') {
    const enrollment = await family.enroll('admin');
    await signIn(page, family, 'admin');
    await page.getByRole('button', { name: 'Использовать резервный код' }).click();
    await page.getByLabel('Резервный код', { exact: true }).fill(enrollment.backupCodes[0] ?? '');
    await page.getByRole('button', { name: 'Подтвердить вход' }).click();
  } else {
    await signIn(page, family, role);
  }
  await expectSignedIn(page);
}

/** Телефон и дата рождения вымышленных участников: их показывают карточки. */
export async function seedProfiles(family: Family) {
  const rows: [string, string, string][] = [
    ['admin', '+7 (900) 555-01-23', '1984-05-17'],
    ['adult', '+7 (900) 555-04-56', '1986-11-02'],
  ];
  for (const [role, phone, birthDate] of rows) {
    await family.database.admin.query(
      'UPDATE member_profiles SET phone = $1, birth_date = $2 WHERE account_id = $3',
      [phone, birthDate, family.person(role === 'admin' ? 'admin' : 'adult').id],
    );
  }
}

/** Всё, что проверяется на каждом экране рабочего приложения: прокрутка, цели, axe, скриншот. */
export async function checkApp(page: Page, info: TestInfo, name: string) {
  await checkAuth(page, info, name, 'app');
}

export async function openSection(page: Page, hash: string, heading: string) {
  await page.goto(`#${hash}`);
  await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
}
