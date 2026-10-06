import { describe, expect, it } from 'vitest';
import {
  AUDIENCES,
  canInvite,
  canResetPassword,
  canRestore,
  canTrash,
  canView,
  canViewAccountJournal,
  canWrite,
  mustUseSecondFactor,
  type Placement,
  type RecordFacts,
  type Role,
  type Viewer,
} from './access.ts';

// Вымышленная семья: администратор, второй взрослый, ребёнок и посторонний без членства в доме.
const HOUSE = 'house-1';
const member = (accountId: string, role: Role): Viewer => ({
  accountId,
  memberships: new Map([[HOUSE, role]]),
});
const admin = member('admin-1', 'admin');
const adult = member('adult-1', 'adult');
const child = member('child-1', 'child');
const outsider: Viewer = { accountId: 'outsider-1', memberships: new Map() };
const everyone = [admin, adult, child, outsider];

const personalOf = (viewer: Viewer): Placement => ({
  kind: 'personal',
  spaceId: `personal-${viewer.accountId}`,
  ownerId: viewer.accountId,
});
const shared = (audience: 'household' | 'adults'): Placement => ({
  kind: 'household',
  spaceId: HOUSE,
  audience,
});
const record = (placement: Placement, extra: Partial<RecordFacts> = {}): RecordFacts => ({
  placement,
  type: 'note',
  authorId: adult.accountId,
  ...extra,
});

describe('canView', () => {
  it('личное видит только владелец — администратор тоже нет', () => {
    for (const owner of everyone) {
      for (const viewer of everyone) {
        expect(canView(viewer, personalOf(owner))).toBe(viewer === owner);
      }
    }
  });

  it('«Вся семья» видят все участники дома, посторонний — нет', () => {
    expect(everyone.map((v) => canView(v, shared('household')))).toEqual([true, true, true, false]);
  });

  it('«Взрослые» не видят ребёнок и посторонний', () => {
    expect(everyone.map((v) => canView(v, shared('adults')))).toEqual([true, true, false, false]);
  });

  it('участник другого дома не видит общее этого дома', () => {
    const neighbour = { accountId: 'n-1', memberships: new Map([['house-2', 'admin' as const]]) };
    for (const audience of AUDIENCES) expect(canView(neighbour, shared(audience))).toBe(false);
  });
});

describe('canWrite', () => {
  it('взрослые меняют любые общие записи, которые видят', () => {
    for (const viewer of [admin, adult]) {
      for (const audience of AUDIENCES)
        expect(canWrite(viewer, record(shared(audience)))).toBe(true);
    }
  });

  it('ребёнок в общем пишет только покупки и дела, назначенные ему', () => {
    const family = shared('household');
    expect(canWrite(child, record(family, { type: 'shopping_item' }))).toBe(true);
    expect(canWrite(child, record(family, { type: 'task', assigneeId: child.accountId }))).toBe(
      true,
    );
    expect(canWrite(child, record(family, { type: 'task', assigneeId: adult.accountId }))).toBe(
      false,
    );
    expect(canWrite(child, record(family, { type: 'note' }))).toBe(false);
    expect(canWrite(child, record(shared('adults'), { type: 'shopping_item' }))).toBe(false);
  });

  it('в личном пишет только владелец', () => {
    expect(canWrite(child, record(personalOf(child)))).toBe(true);
    expect(canWrite(admin, record(personalOf(child)))).toBe(false);
  });
});

describe('canTrash и canRestore', () => {
  it('ребёнок не убирает общее в корзину и не восстанавливает', () => {
    const item = record(shared('household'), { type: 'shopping_item', authorId: child.accountId });
    expect(canTrash(child, item)).toBe(false);
    expect(canRestore(child, item)).toBe(false);
  });

  it('из общей корзины восстанавливает администратор или взрослый-автор', () => {
    const byAdult = record(shared('adults'), { authorId: adult.accountId });
    const byAdmin = record(shared('adults'), { authorId: admin.accountId });
    expect(canRestore(admin, byAdult)).toBe(true);
    expect(canRestore(adult, byAdult)).toBe(true);
    expect(canRestore(adult, byAdmin)).toBe(false);
  });

  it('личное убирает и восстанавливает только владелец', () => {
    const mine = record(personalOf(adult));
    expect(canTrash(adult, mine)).toBe(true);
    expect(canRestore(adult, mine)).toBe(true);
    expect(canTrash(admin, mine)).toBe(false);
    expect(canRestore(admin, mine)).toBe(false);
  });
});

describe('canInvite (AUTH-2)', () => {
  it('приглашает только администратор этого дома', () => {
    expect(everyone.map((v) => canInvite(v, HOUSE))).toEqual([true, false, false, false]);
  });

  it('администратор соседнего дома в этот дом не приглашает', () => {
    const neighbour = { accountId: 'n-1', memberships: new Map([['house-2', 'admin' as const]]) };
    expect(canInvite(neighbour, HOUSE)).toBe(false);
    expect(canInvite(neighbour, 'house-2')).toBe(true);
  });
});

describe('canResetPassword (AUTH-5)', () => {
  it('администратор сбрасывает пароль только ребёнку своего дома', () => {
    expect(everyone.map((target) => canResetPassword(admin, target))).toEqual([
      false, // себе — нет
      false, // взрослый — нет
      true, // ребёнок — да
      false, // посторонний без дома — нет
    ]);
  });

  it('взрослый, ребёнок и посторонний не сбрасывают никому', () => {
    for (const viewer of [adult, child, outsider]) {
      for (const target of everyone) expect(canResetPassword(viewer, target)).toBe(false);
    }
  });

  it('администратор соседнего дома чужого ребёнка не сбрасывает', () => {
    const neighbour = { accountId: 'n-1', memberships: new Map([['house-2', 'admin' as const]]) };
    expect(canResetPassword(neighbour, child)).toBe(false);
  });

  it('кто где-то взрослый или администратор — не ребёнок, даже если в этом доме он ребёнок', () => {
    const both = {
      accountId: 'both-1',
      memberships: new Map<string, Role>([
        [HOUSE, 'child'],
        ['house-2', 'adult'],
      ]),
    };
    expect(canResetPassword(admin, both)).toBe(false);
  });
});

describe('mustUseSecondFactor (AUTH-3)', () => {
  it('обязателен администратору; взрослому и ребёнку — нет', () => {
    expect(everyone.map(mustUseSecondFactor)).toEqual([true, false, false, false]);
  });

  it('администратор хотя бы одного дома — администратор', () => {
    const both = {
      accountId: 'both-1',
      memberships: new Map<string, Role>([
        [HOUSE, 'adult'],
        ['house-2', 'admin'],
      ]),
    };
    expect(mustUseSecondFactor(both)).toBe(true);
  });
});

describe('canViewAccountJournal (AUTH-8)', () => {
  it('журнал входов видит только владелец, администратор тоже нет', () => {
    for (const owner of everyone) {
      for (const viewer of everyone) {
        expect(canViewAccountJournal(viewer, owner.accountId)).toBe(viewer === owner);
      }
    }
  });
});
