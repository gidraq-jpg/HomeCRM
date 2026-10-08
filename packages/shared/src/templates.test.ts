import { expect, it } from 'vitest';
import { ApplyTemplate } from './templates.ts';

it.each([{}, { number: 'X' }, { payer: 'tenant' }, { number: 'X', payer: 'tenant' }])(
  'TPL-2: переопределение счёта сохраняет только переданные поля %j',
  (data) => {
    const body = ApplyTemplate.parse({
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      title: 'Вымышленная квартира',
      accounts: [{ id: 'water_sewerage', data }],
    });
    expect(body.accounts[0]?.data).toEqual(data);
  },
);

it('TPL-3: явные пустые услуги и отключённые сроки сохраняются в переопределении', () => {
  const data = { services: [], readingRule: null, paymentRule: null };
  const body = ApplyTemplate.parse({
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
    title: 'Вымышленная квартира',
    accounts: [{ id: 'water_sewerage', data }],
  });
  expect(body.accounts[0]?.data).toEqual(data);
});
