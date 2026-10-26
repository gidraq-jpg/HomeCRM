import { expect, test } from '../auth/support/fixtures.ts';
import { homeDate, setHomeZone } from './deadlines-support.ts';
import { apiAs } from './notes-support.ts';
import { signInAs } from './support.ts';

for (const reduce of [false, true]) {
  test(`UI-8: длинный свайп повторяющегося дела затрагивает один экземпляр (${reduce})`, async ({
    page,
    family,
  }) => {
    await page.emulateMedia({ reducedMotion: reduce ? 'reduce' : 'no-preference' });
    await setHomeZone(family);
    const api = await apiAs(family, 'adult');
    const created = await api.post('tasks', {
      title: 'Вымышленный повтор',
      planOn: homeDate(0),
      repeatRule: { kind: 'daily' },
    });
    expect(created.status).toBe(201);
    const firstId = (created.body as { id: string }).id;
    const completed = await api.post(`tasks/${firstId}/status`, { status: 'done' });
    expect(completed.status).toBe(200);
    const nextId = (completed.body as { nextTaskId: string }).nextTaskId;
    expect(nextId).toBeTruthy();
    await signInAs(page, family, 'adult');
    await page.goto('#/today/all');
    const row = page.locator(`.swipe-task[data-motion-key="${nextId}"]:not([data-motion-ghost])`);
    await expect(row).toBeVisible();
    await row.scrollIntoViewIfNeeded();
    const box = await row.locator('a').boundingBox();
    if (!box) throw new Error('Repeated row is missing');
    const width = page.viewportSize()?.width ?? 360;
    const x = Math.min(width - 40, box.x + box.width - 8);
    const y = box.y + Math.min(20, box.height / 2);
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 8; step++)
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x - ((x - 40) * step) / 8, y }],
      });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
    await expect(page.getByText('Дело в корзине', { exact: true })).toBeVisible();
    expect((await api.get(`tasks/${firstId}`)).body).toMatchObject({ deletedAt: null });
    expect((await api.get(`tasks/${nextId}`)).body).toMatchObject({ id: nextId });
    expect((await api.get(`tasks/${nextId}`)).body).not.toMatchObject({ deletedAt: null });
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    await expect(page.getByText('Дело восстановлено', { exact: true })).toBeVisible();
    await expect(row).toBeVisible();
    expect((await api.get(`tasks/${nextId}`)).body).toMatchObject({ deletedAt: null });
  });
}
