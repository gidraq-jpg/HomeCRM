import type { Viewer } from '@homecrm/shared';
import { describe, expect, it } from 'vitest';
import type { PlacedRecord } from '../notes/abilities.ts';
import { mayRestoreDeadline } from './abilities.ts';

const HOUSE = 'fictional-house';

const viewer = (accountId: string, role: 'admin' | 'adult' | 'child'): Viewer => ({
  accountId,
  memberships: new Map([[HOUSE, role]]),
});

const shared = (authorId: string): PlacedRecord => ({
  spaceId: HOUSE,
  spaceKind: 'household',
  audience: 'household',
  authorId,
  assigneeId: authorId,
  deletedAt: '2026-10-08T09:00:00.000Z',
});

describe('«Отменить» после «В корзину» (DEAD-1, PRD 6)', () => {
  it('администратор возвращает срок любого автора', () => {
    expect(mayRestoreDeadline(viewer('boris', 'admin'), 'objects', shared('anna'))).toBe(true);
  });

  it('взрослый возвращает только свой срок, на чужом отмены нет', () => {
    const adult = viewer('boris', 'adult');
    expect(mayRestoreDeadline(adult, 'objects', shared('boris'))).toBe(true);
    expect(mayRestoreDeadline(adult, 'notes', shared('anna'))).toBe(false);
  });

  it('ребёнок срок не возвращает', () => {
    expect(mayRestoreDeadline(viewer('vera', 'child'), 'notes', shared('vera'))).toBe(false);
  });

  it('личный срок возвращает его владелец', () => {
    const personal: PlacedRecord = {
      spaceId: 'boris-space',
      spaceKind: 'personal',
      audience: null,
      authorId: 'boris',
      assigneeId: 'boris',
      deletedAt: '2026-10-08T09:00:00.000Z',
    };
    expect(mayRestoreDeadline(viewer('boris', 'adult'), 'notes', personal)).toBe(true);
  });
});
