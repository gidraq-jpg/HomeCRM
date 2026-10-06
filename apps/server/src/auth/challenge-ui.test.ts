import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enrollTotp } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World;
beforeAll(async () => {
  world = await createWorld();
  for (const person of [world.anna, world.boris]) {
    const device = world.device();
    await device.signIn(person.username, person.password);
    await enrollTotp(device, person);
  }
});
afterAll(async () => {
  await world?.close();
});

describe('признак доверия устройству для экрана TOTP', () => {
  it('не раскрывает роль при неверном пароле', async () => {
    const reply = await world.device().signIn('anna', 'fictional-wrong-password');
    expect(reply.status).toBe(401);
    expect(reply.json()).not.toHaveProperty('trustDeviceAllowed');
  });
  it('после верного пароля администратору доверие запрещено', async () => {
    const reply = await world.device().signIn('anna', world.anna.password);
    expect(reply.status).toBe(200);
    expect(reply.json()).toMatchObject({ twoFactorRedirect: true, trustDeviceAllowed: false });
  });
  it('взрослому доверие разрешено', async () => {
    const reply = await world.device().signIn('boris', world.boris.password);
    expect(reply.status).toBe(200);
    expect(reply.json()).toMatchObject({ twoFactorRedirect: true, trustDeviceAllowed: true });
  });
  it('лишнее имя в запросе по почте не меняет признак администратора', async () => {
    const reply = await world.device().post('/api/auth/sign-in/email', {
      email: 'anna@family.test',
      username: 'boris',
      password: world.anna.password,
    });
    expect(reply.status).toBe(200);
    expect(reply.json()).toMatchObject({ twoFactorRedirect: true, trustDeviceAllowed: false });
  });
});
