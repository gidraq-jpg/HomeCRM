import { describe, expect, it } from 'vitest';
import { cardDismissed, dismissedKey, dismissPushCard } from './push.ts';

describe('отказ от карточки уведомлений (NOTIF-1)', () => {
  it('помнится по участнику: у второго человека на том же браузере карточка своя', () => {
    expect(cardDismissed('fictional-anna')).toBe(false);
    dismissPushCard('fictional-anna');
    expect(cardDismissed('fictional-anna')).toBe(true);
    expect(cardDismissed('fictional-boris')).toBe(false);
  });

  it('ключ хранилища содержит участника', () => {
    expect(dismissedKey('a')).not.toBe(dismissedKey('b'));
  });
});
