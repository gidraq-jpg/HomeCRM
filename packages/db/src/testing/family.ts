// Вымышленная семья для проверок доступа (AGENTS.md: в тестах только вымышленные данные).
// Записи покрывают все сочетания, от которых зависят права в access.ts: место (личное
// каждого, «Вся семья» и «Взрослые» двух домов), вид записи, автор, ответственный, корзина.
import { randomUUID } from 'node:crypto';
import {
  AUDIENCE_LABELS,
  AUDIENCES,
  type Audience,
  type Placement,
  type RecordFacts,
  type Role,
  type Viewer,
} from '@homecrm/shared';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { RECORD_TYPES, type RecordType } from '../access-sql.ts';
import { accounts, RECORD_TABLES, spaceMembers, spaces } from '../schema.ts';

export const PERSON_KEYS = ['anna', 'boris', 'vera', 'gleb', 'dina'] as const;
export type PersonKey = (typeof PERSON_KEYS)[number];

const NAMES: Readonly<Record<PersonKey, string>> = {
  anna: 'Анна',
  boris: 'Борис',
  vera: 'Вера',
  gleb: 'Глеб',
  dina: 'Дина',
};

// В доме: Анна — администратор, Борис — взрослый, Вера — ребёнок. У соседей — Дина.
// Глеб не состоит ни в одном доме: посторонний.
const HOUSES: ReadonlyArray<{ name: string; members: Partial<Record<PersonKey, Role>> }> = [
  { name: 'Дом', members: { anna: 'admin', boris: 'adult', vera: 'child' } },
  { name: 'Соседи', members: { dina: 'admin' } },
];

export const TYPE_LABELS: Readonly<Record<RecordType, string>> = {
  note: 'заметка',
  shopping_item: 'покупка',
  task: 'дело',
};

export interface Person {
  key: PersonKey;
  name: string;
  id: string;
  personalSpaceId: string;
  /** Тот же участник глазами эталона access.ts. */
  viewer: Viewer;
}

export interface House {
  name: string;
  id: string;
  members: ReadonlyMap<PersonKey, Role>;
}

export interface SeededRecord {
  id: string;
  type: RecordType;
  facts: RecordFacts;
  trashed: boolean;
  label: string;
}

export interface Family {
  people: readonly Person[];
  houses: readonly House[];
  /** Все места для записи: личное каждого и обе аудитории каждого дома. */
  placements: readonly Placement[];
  records: readonly SeededRecord[];
  person(key: PersonKey): Person;
  /** Кого можно сделать ответственным в этом месте — вместе с «чужими» для проверки. */
  assigneeCandidates(placement: Placement): ReadonlyArray<string | null>;
  describe(type: RecordType, facts: RecordFacts, trashed?: boolean): string;
}

export function buildFamily(): Family {
  const houses: House[] = HOUSES.map((house) => ({
    name: house.name,
    id: randomUUID(),
    members: new Map(Object.entries(house.members) as Array<[PersonKey, Role]>),
  }));
  const people: Person[] = PERSON_KEYS.map((key) => {
    const id = randomUUID();
    const memberships = new Map<string, Role>();
    for (const house of houses) {
      const role = house.members.get(key);
      if (role !== undefined) memberships.set(house.id, role);
    }
    return {
      key,
      name: NAMES[key],
      id,
      personalSpaceId: randomUUID(),
      viewer: { accountId: id, memberships },
    };
  });
  const person = (key: PersonKey): Person => {
    const found = people.find((candidate) => candidate.key === key);
    if (found === undefined) throw new Error(`Unknown person: ${key}`);
    return found;
  };
  const houseOf = (spaceId: string): House => {
    const found = houses.find((house) => house.id === spaceId);
    if (found === undefined) throw new Error(`Unknown house: ${spaceId}`);
    return found;
  };
  const nameOf = (accountId: string | null | undefined): string =>
    people.find((someone) => someone.id === accountId)?.name ?? 'нет';

  const placements: Placement[] = [
    ...people.map(
      (owner): Placement => ({
        kind: 'personal',
        spaceId: owner.personalSpaceId,
        ownerId: owner.id,
      }),
    ),
    ...houses.flatMap((house) =>
      AUDIENCES.map((audience): Placement => ({ kind: 'household', spaceId: house.id, audience })),
    ),
  ];

  // Авторы — те, кто мог положить запись сюда. Ответственные — ещё и «чужие» для этого места:
  // назначение не должно открывать доступ.
  const authorCandidates = (placement: Placement): string[] =>
    placement.kind === 'personal'
      ? [placement.ownerId]
      : [...houseOf(placement.spaceId).members.keys()].map((key) => person(key).id);
  const assigneeCandidates = (placement: Placement): Array<string | null> => {
    const child = person('vera').id;
    if (placement.kind === 'personal') {
      const stranger = placement.ownerId === child ? person('anna').id : child;
      return [null, placement.ownerId, stranger];
    }
    const members = authorCandidates(placement);
    return [null, ...members, ...(members.includes(child) ? [] : [child])];
  };

  const describePlacement = (placement: Placement): string =>
    placement.kind === 'personal'
      ? `личное (${nameOf(placement.ownerId)})`
      : `${houseOf(placement.spaceId).name} · ${AUDIENCE_LABELS[placement.audience]}`;
  const describe = (type: RecordType, facts: RecordFacts, trashed = false): string =>
    [
      TYPE_LABELS[type],
      describePlacement(facts.placement),
      `автор ${nameOf(facts.authorId)}`,
      `ответственный ${nameOf(facts.assigneeId)}`,
      ...(trashed ? ['в корзине'] : []),
    ].join(' · ');

  const records: SeededRecord[] = [];
  for (const type of RECORD_TYPES) {
    for (const placement of placements) {
      for (const authorId of authorCandidates(placement)) {
        for (const assigneeId of assigneeCandidates(placement)) {
          for (const trashed of [false, true]) {
            const facts: RecordFacts = { placement, type, authorId, assigneeId };
            records.push({
              id: randomUUID(),
              type,
              facts,
              trashed,
              label: describe(type, facts, trashed),
            });
          }
        }
      }
    }
  }

  return { people, houses, placements, records, person, assigneeCandidates, describe };
}

/** Колонки места записи: пространство, его вид и аудитория (только у общего). */
export function placementColumns(placement: Placement): {
  spaceId: string;
  spaceKind: Placement['kind'];
  audience: Audience | null;
} {
  return {
    spaceId: placement.spaceId,
    spaceKind: placement.kind,
    audience: placement.kind === 'household' ? placement.audience : null,
  };
}

/** Записывает семью в базу от имени суперпользователя: он обходит RLS. */
export async function seedFamily(admin: pg.Pool, family: Family): Promise<void> {
  const db = drizzle({ client: admin });
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db.transaction(async (tx) => {
    await tx
      .insert(accounts)
      .values(family.people.map((someone) => ({ id: someone.id, displayName: someone.name })));
    await tx.insert(spaces).values([
      ...family.people.map((owner) => ({
        id: owner.personalSpaceId,
        kind: 'personal' as const,
        name: `Личное: ${owner.name}`,
        ownerAccountId: owner.id,
      })),
      ...family.houses.map((house) => ({
        id: house.id,
        kind: 'household' as const,
        name: house.name,
      })),
    ]);
    await tx.insert(spaceMembers).values(
      family.houses.flatMap((house) =>
        [...house.members].map(([key, role]) => ({
          spaceId: house.id,
          accountId: family.person(key).id,
          role,
        })),
      ),
    );
    for (const type of RECORD_TYPES) {
      const rows = family.records
        .filter((record) => record.type === type)
        .map((record) => ({
          id: record.id,
          ...placementColumns(record.facts.placement),
          authorId: record.facts.authorId,
          assigneeId: record.facts.assigneeId ?? null,
          title: `${TYPE_LABELS[type]} для проверки`,
          deletedAt: record.trashed ? dayAgo : null,
        }));
      await tx.insert(RECORD_TABLES[type]).values(rows);
    }
  });
}
