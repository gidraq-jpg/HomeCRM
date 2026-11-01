import { createHash, randomUUID } from 'node:crypto';
import { test } from '../auth/support/fixtures.ts';
import { checkApp, expect, signInAs } from './support.ts';

// Callback локального OAuth-клиента подменяется Playwright, без перехвата навигации PWA.
test.use({ serviceWorkers: 'block' });

test('D41: согласие, личные черновики пачкой и отключение ключа в профиле', async ({
  page,
  family,
}, info) => {
  await family.database.admin.query('UPDATE spaces SET chat_enabled=true WHERE id=$1', [
    family.houseId,
  ]);
  const callback = `${family.baseURL}oauth-callback`;
  const client = await family.database.admin.query(
    "INSERT INTO chat_clients(name,redirects) VALUES ('Учебный Claude',$1) RETURNING id",
    [JSON.stringify([callback])],
  );
  await signInAs(page, family, 'adult');
  const query = new URLSearchParams({
    client_id: client.rows[0].id,
    redirect_uri: callback,
    response_type: 'code',
    code_challenge: createHash('sha256').update('x'.repeat(43)).digest('base64url'),
    code_challenge_method: 'S256',
  });
  await page.goto(`#/oauth/consent?${query}`);
  await expect(page.getByRole('button', { name: 'Разрешить', exact: true })).toBeEnabled();
  await checkApp(page, info, 'd41-consent');
  await page.route(`${callback}**`, (route) =>
    route.fulfill({ body: 'connected', contentType: 'text/plain' }),
  );
  await page.getByRole('button', { name: 'Разрешить', exact: true }).click();
  await expect(page.getByText('connected', { exact: true })).toBeVisible();
  const person = family.person('adult');
  await family.database.admin.query(
    "INSERT INTO chat_grants(space_id,account_id,house_id,client_id,name,access_hash,refresh_hash,access_expires_at) VALUES ((SELECT id FROM spaces WHERE owner_account_id=$1),$1,$2,$3,'Учебный Claude','e2e-access-hash','e2e-refresh-hash',now()+interval '1 hour')",
    [person.id, family.houseId, client.rows[0].id],
  );
  for (const kind of ['note', 'object', 'contact'])
    await family.database.admin.query(
      "INSERT INTO inbox_items(id,space_id,space_kind,author_id,assignee_id,title,source,status,chat_draft) VALUES ($1,$2,'personal',$3,$3,$4,'chat','ready',$5)",
      [
        randomUUID(),
        person.personalSpaceId,
        person.id,
        `Учебный ${kind}`,
        JSON.stringify({
          kind,
          title: `Учебный ${kind}`,
          body: 'Учебный текст',
          uncertain: ['title'],
        }),
      ],
    );
  await page.goto(`${family.baseURL}#/more/inbox`);
  await expect(page.getByRole('heading', { name: 'Черновики от ИИ' })).toBeVisible();
  await expect(page.getByLabel('Куда сохранить')).toHaveValue('personal');
  for (const checkbox of await page.getByRole('checkbox', { name: /От ИИ/ }).all())
    await checkbox.check();
  await checkApp(page, info, 'd41-inbox');
  await page.getByRole('button', { name: 'Сохранить выбранные' }).click();
  await expect(page.getByRole('heading', { name: 'Черновики от ИИ' })).toHaveCount(0);
  await page.goto('#/more/settings');
  await expect(page.getByRole('heading', { name: 'Устройства ИИ' })).toBeVisible();
  await checkApp(page, info, 'd41-profile');
  await page.getByRole('button', { name: 'Отключить', exact: true }).click();
  await expect(page.getByText('Учебный Claude', { exact: true })).toHaveCount(0);
});
