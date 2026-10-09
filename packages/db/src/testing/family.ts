// Вымышленная семья для проверок доступа (AGENTS.md: в тестах только вымышленные данные).
// Записи покрывают все сочетания, от которых зависят права в access.ts: место (личное
// каждого, «Вся семья» и «Взрослые» двух домов), вид записи, автор, ответственный, корзина.
import { randomUUID } from 'node:crypto';
import {
  AUDIENCE_LABELS,
  AUDIENCES,
  type Audience,
  canBeAssignee,
  defaultAssignee,
  type Placement,
  type RecordFacts,
  type Role,
  type Viewer,
} from '@homecrm/shared';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { RECORD_TYPES, type RecordType } from '../access-sql.ts';
import { accounts, RECORD_TABLES } from '../schema.ts';

export const PERSON_KEYS = ['anna', 'boris', 'vera', 'gleb', 'dina', 'mila'] as const;
export type PersonKey = (typeof PERSON_KEYS)[number];

const NAMES: Readonly<Record<PersonKey, string>> = {
  anna: 'Анна',
  boris: 'Борис',
  vera: 'Вера',
  gleb: 'Глеб',
  dina: 'Дина',
  mila: 'Мила',
};

// В доме: Анна — администратор, Борис — взрослый, Вера — ребёнок. У соседей — Дина.
// Мила состоит в обоих домах с разными ролями: в «Доме» она ребёнок, у «Соседей» — взрослая.
// Глеб не состоит ни в одном доме: посторонний.
const HOUSES: ReadonlyArray<{ name: string; members: Partial<Record<PersonKey, Role>> }> = [
  { name: 'Дом', members: { anna: 'admin', boris: 'adult', vera: 'child', mila: 'child' } },
  { name: 'Соседи', members: { dina: 'admin', mila: 'adult' } },
];

export const TYPE_LABELS: Readonly<Record<RecordType, string>> = {
  note: 'заметка',
  note_item: 'пункт заметки',
  shopping_item: 'покупка',
  task: 'дело',
  object: 'объект',
  object_field: 'своё поле',
  object_event: 'событие объекта',
  note_file: 'файл заметки',
  object_file: 'файл объекта',
  contact: 'контакт',
  contact_interaction: 'взаимодействие',
  utility_account: 'лицевой счёт',
  meter: 'счётчик',
  meter_reading: 'показание',
  utility_charge: 'начисление',
  utility_payment: 'оплата',
  document: 'документ',
  document_file: 'страница документа',
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
  /** У дочерней записи — заметка-родитель в том же месте. */
  parentId?: string;
}

export interface Family {
  people: readonly Person[];
  houses: readonly House[];
  /** Все места для записи: личное каждого и обе аудитории каждого дома. */
  placements: readonly Placement[];
  records: readonly SeededRecord[];
  person(key: PersonKey): Person;
  /** Кого можно назначить ответственным в этом месте: тех, кто запись видит (правило 9). */
  eligibleAssignees(placement: Placement): string[];
  /** Что может прислать приложение: допустимые значения, пусто и «чужой» для личного — его база заменит владельцем. */
  assigneeInputs(placement: Placement): ReadonlyArray<string | null>;
  /** Заметка-родитель для дочерних записей в этом месте. */
  parentIdFor(placement: Placement, type?: RecordType): string;
  describe(type: RecordType, facts: RecordFacts): string;
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

  // Авторы — те, кто мог положить запись сюда.
  const authorCandidates = (placement: Placement): string[] =>
    placement.kind === 'personal'
      ? [placement.ownerId]
      : [...houseOf(placement.spaceId).members.keys()].map((key) => person(key).id);
  // Ответственные — те, кто запись видит; остальные база не пустит (внешние ключи, правило 9).
  const eligibleAssignees = (placement: Placement): string[] =>
    placement.kind === 'personal'
      ? [placement.ownerId]
      : people.filter((someone) => canBeAssignee(someone.viewer, placement)).map((p) => p.id);
  const assigneeInputs = (placement: Placement): Array<string | null> => {
    if (placement.kind === 'personal') {
      // В личном ответственный всегда владелец, кого бы ни прислали: проверяем и «чужого».
      const stranger =
        placement.ownerId === person('vera').id ? person('anna').id : person('vera').id;
      return [null, placement.ownerId, stranger];
    }
    return [null, ...eligibleAssignees(placement)];
  };

  const describePlacement = (placement: Placement): string =>
    placement.kind === 'personal'
      ? `личное (${nameOf(placement.ownerId)})`
      : `${houseOf(placement.spaceId).name} · ${AUDIENCE_LABELS[placement.audience]}`;
  const describe = (type: RecordType, facts: RecordFacts): string =>
    [
      TYPE_LABELS[type],
      describePlacement(facts.placement),
      `автор ${nameOf(facts.authorId)}`,
      `ответственный ${nameOf(facts.assigneeId)}`,
      ...(facts.trashed === true ? ['в корзине'] : []),
    ].join(' · ');

  const records: SeededRecord[] = [];
  const parents = new Map<Placement, string>();
  const contactParents = new Map<Placement, string>();
  const objectParents = new Map<Placement, string>();
  const meterParents = new Map<Placement, string>();
  const accountParents = new Map<Placement, string>();
  const documentParents = new Map<Placement, string>();
  const chargeParents = new Map<Placement, string>();
  for (const type of RECORD_TYPES) {
    for (const placement of placements) {
      for (const authorId of authorCandidates(placement)) {
        for (const assigneeId of eligibleAssignees(placement)) {
          for (const trashed of [false, true]) {
            const facts: RecordFacts = { placement, type, authorId, assigneeId, trashed };
            const id = randomUUID();
            if (type === 'contact' && !trashed && !contactParents.has(placement))
              contactParents.set(placement, id);
            if (type === 'document' && !trashed && !documentParents.has(placement))
              documentParents.set(placement, id);
            if (type === 'note' && !trashed && !parents.has(placement)) parents.set(placement, id);
            if (type === 'object' && !trashed && !objectParents.has(placement))
              objectParents.set(placement, id);
            if (type === 'meter' && !trashed && !meterParents.has(placement))
              meterParents.set(placement, id);
            if (type === 'utility_account' && !trashed && !accountParents.has(placement))
              accountParents.set(placement, id);
            if (type === 'utility_charge' && !trashed && !chargeParents.has(placement))
              chargeParents.set(placement, id);
            records.push({ id, type, facts, trashed, label: describe(type, facts) });
          }
        }
      }
    }
  }
  const parentIdFor = (placement: Placement, type: RecordType = 'note_item'): string => {
    const found = (
      type === 'contact_interaction'
        ? contactParents
        : type === 'document_file'
          ? documentParents
          : type === 'utility_charge'
            ? accountParents
            : type === 'utility_payment'
              ? chargeParents
              : type === 'meter_reading'
                ? meterParents
                : ['note_item', 'note_file'].includes(type)
                  ? parents
                  : objectParents
    ).get(placement);
    if (found === undefined) throw new Error('No parent note in this place');
    return found;
  };
  for (const record of records) {
    if (record.type === 'note_item' || record.type === 'note_file')
      record.parentId = parentIdFor(record.facts.placement);
    if (
      record.type === 'document_file' ||
      record.type === 'contact_interaction' ||
      record.type === 'object_field' ||
      record.type === 'object_event' ||
      record.type === 'object_file' ||
      record.type === 'utility_account' ||
      record.type === 'meter' ||
      record.type === 'utility_charge' ||
      record.type === 'utility_payment' ||
      record.type === 'meter_reading'
    )
      record.parentId = parentIdFor(record.facts.placement, record.type);
  }

  return {
    people,
    houses,
    placements,
    records,
    person,
    eligibleAssignees,
    assigneeInputs,
    parentIdFor,
    describe,
  };
}

/** Итоговые факты новой записи: ответственного определяет правило 9, как в базе. */
export function createdFacts(
  type: RecordType,
  placement: Placement,
  authorId: string,
  assigneeInput: string | null,
): RecordFacts {
  return {
    placement,
    type,
    authorId,
    assigneeId: defaultAssignee(placement, authorId, assigneeInput),
    trashed: false,
  };
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

/** Записывает учётные записи, пространства и участников от имени суперпользователя: он обходит RLS. */
export async function seedPeople(admin: pg.Pool, family: Family): Promise<void> {
  const db = drizzle({ client: admin });
  await db.transaction(async (tx) => {
    await tx.insert(accounts).values(
      family.people.map((someone) => ({
        id: someone.id,
        displayName: someone.name,
        // Зона .invalid зарезервирована: письма на такие адреса не уходят.
        email: `${someone.key}@family.invalid`,
        username: someone.key,
      })),
    );
    // Явные колонки: фикстура также используется до миграции time_zone.
    for (const owner of family.people)
      await tx.execute(
        sql`INSERT INTO spaces(id,kind,name,owner_account_id) VALUES (${owner.personalSpaceId},'personal',${`Личное: ${owner.name}`},${owner.id})`,
      );
    for (const house of family.houses)
      await tx.execute(
        sql`INSERT INTO spaces(id,kind,name) VALUES (${house.id},'household',${house.name})`,
      );
    // Явные колонки сохраняют пригодность фикстуры для теста обновления старой схемы:
    // Drizzle иначе перечисляет новые колонки даже со значением DEFAULT.
    for (const house of family.houses)
      for (const [key, role] of house.members)
        await tx.execute(sql`INSERT INTO space_members(space_id, account_id, role)
        VALUES (${house.id}, ${family.person(key).id}, ${role})`);
  });
}

/** Записывает семью и её записи в базу от имени суперпользователя: он обходит RLS. */
export async function seedFamily(admin: pg.Pool, family: Family): Promise<void> {
  await seedPeople(admin, family);
  const db = drizzle({ client: admin });
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db.transaction(async (tx) => {
    for (const type of RECORD_TYPES) {
      const rows = family.records
        .filter((record) => record.type === type)
        .map((record) => ({
          ...fileFixture(type),
          id: record.id,
          ...placementColumns(record.facts.placement),
          authorId: record.facts.authorId,
          assigneeId: record.facts.assigneeId ?? null,
          title: `${TYPE_LABELS[type]} для проверки`,
          deletedAt: record.trashed ? dayAgo : null,
          ...(record.parentId === undefined ? {} : { parentId: record.parentId }),
        }));
      await tx.insert(RECORD_TABLES[type]).values(rows as never);
    }
  });
}

/** Вымышленные метаданные блоков для общей матрицы; файлов на диске нет. */
export function fileFixture(type: RecordType) {
  if (type === 'utility_charge') return { period: '2026-10', totalCents: 0, dueOn: '2026-11-15' };
  if (type === 'utility_payment')
    return { paidOn: '2026-10-08', amountCents: 1, payer: { kind: 'tenant' }, method: 'tenant' };
  if (type === 'meter_reading') return { occurredOn: '2026-10-01' };
  return type === 'note_file' || type === 'object_file' || type === 'document_file'
    ? { mimeType: 'application/pdf', sizeBytes: 8, storageKey: randomUUID(), envelope: {} }
    : {};
}
