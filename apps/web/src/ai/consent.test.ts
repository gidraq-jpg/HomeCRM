import { expect, it } from 'vitest';
import { consentKey } from './consent.tsx';

it('AI-3: смена поставщика, участника или дома требует нового согласия', () => {
  const first = consentKey('member', 'house', 'Hermes:first');
  expect(consentKey('member', 'house', 'Другой:second')).not.toBe(first);
  expect(consentKey('other', 'house', 'Hermes:first')).not.toBe(first);
  expect(consentKey('member', 'other', 'Hermes:first')).not.toBe(first);
});
