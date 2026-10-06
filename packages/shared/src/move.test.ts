import { describe, expect, it } from 'vitest';
import {
  canChangeAudience,
  canCopyToPersonal,
  canMove,
  type Placement,
  type RecordFacts,
  type Viewer,
} from './access.ts';

const viewer: Viewer = {
  accountId: 'author',
  memberships: new Map([
    ['home', 'adult'],
    ['other', 'adult'],
  ]),
};
const personal: Placement = { kind: 'personal', spaceId: 'mine', ownerId: 'author' };
const common: Placement = { kind: 'household', spaceId: 'home', audience: 'household' };
const record: RecordFacts = { type: 'note', placement: common, authorId: 'author' };
describe('SPACE-7: отдельные действия переноса', () => {
  it('поделиться может владелец, только в доступный для записи дом', () => {
    expect(canMove(viewer, { ...record, placement: personal }, common)).toBe(true);
    expect(
      canMove({ ...viewer, accountId: 'other' }, { ...record, placement: personal }, common),
    ).toBe(false);
    expect(
      canMove(
        { ...viewer, memberships: new Map([['home', 'child']]) },
        { ...record, placement: personal },
        common,
      ),
    ).toBe(false);
  });
  it('сделать личной может только автор без чужого вклада; неизвестный вклад означает отказ', () => {
    expect(canMove(viewer, record, personal, false)).toBe(true);
    expect(canMove(viewer, record, personal, true)).toBe(false);
    expect(canMove(viewer, record, personal)).toBe(false);
    expect(canMove(viewer, { ...record, authorId: 'other' }, personal, false)).toBe(false);
    expect(canMove(viewer, { ...record, trashed: true }, personal, false)).toBe(false);
  });
  it('между домами и чужими личными пространствами перенос запрещён', () => {
    expect(canMove(viewer, record, { ...common, spaceId: 'other' }, false)).toBe(false);
    expect(canMove(viewer, record, { ...personal, ownerId: 'other' }, false)).toBe(false);
    expect(canMove(viewer, { ...record, placement: personal }, personal, false)).toBe(false);
  });
  it('читатель может скопировать в личное, включая ребёнка; корзину не копируют', () => {
    const child = { ...viewer, memberships: new Map([['home', 'child'] as const]) };
    expect(canCopyToPersonal(child, record)).toBe(true);
    expect(
      canCopyToPersonal(child, { ...record, placement: { ...common, audience: 'adults' } }),
    ).toBe(false);
    expect(canCopyToPersonal(child, { ...record, trashed: true })).toBe(false);
    expect(canChangeAudience(child, record, { ...common, audience: 'adults' })).toBe(false);
    expect(canChangeAudience(viewer, record, { ...common, audience: 'adults' })).toBe(true);
  });
});
