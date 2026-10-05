import { describe, expect, it } from 'vitest';
import {
  ACCOUNTS,
  CHARGES,
  CONTACTS,
  DOCUMENTS,
  FEED,
  METERS,
  PEOPLE,
  PROPERTIES,
  SEED_MAIN_TASK_ID,
  SEED_RECORDS,
  TASKS,
  TODAY,
} from './data/index.ts';
import type { RecordKind } from './model.ts';

const propertyIds = new Set(PROPERTIES.map((property) => property.id));
const accountIds = new Set(ACCOUNTS.map((account) => account.id));
const contactIds = new Set(CONTACTS.map((contact) => contact.id));

describe('вымышленные данные прототипа', () => {
  it('у всех записей разные идентификаторы', () => {
    const ids = SEED_RECORDS.map((record) => record.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('связи указывают на существующие записи', () => {
    for (const record of SEED_RECORDS) {
      if (record.kind === 'task' || record.kind === 'note' || record.kind === 'document') {
        if (record.propertyId !== undefined) expect(propertyIds).toContain(record.propertyId);
      }
      if (record.kind === 'contact') {
        for (const id of record.propertyIds) expect(propertyIds).toContain(id);
      }
    }
    for (const account of ACCOUNTS) {
      expect(propertyIds).toContain(account.propertyId);
      if (account.contactId !== undefined) expect(contactIds).toContain(account.contactId);
    }
    for (const meter of METERS) {
      expect(propertyIds).toContain(meter.propertyId);
      expect(accountIds).toContain(meter.accountId);
    }
    for (const charge of CHARGES) {
      expect(propertyIds).toContain(charge.propertyId);
      expect(accountIds).toContain(charge.accountId);
    }
    for (const event of FEED) {
      expect(propertyIds).toContain(event.propertyId);
      if (event.contactId !== undefined) expect(contactIds).toContain(event.contactId);
    }
    expect(TASKS.map((task) => task.id)).toContain(SEED_MAIN_TASK_ID);
  });

  it('деньги — целые копейки', () => {
    for (const charge of CHARGES) expect(Number.isInteger(charge.amount)).toBe(true);
    for (const event of FEED) expect(Number.isInteger(event.amount ?? 0)).toBe(true);
    for (const contact of CONTACTS) {
      for (const item of contact.interactions)
        expect(Number.isInteger(item.amount ?? 0)).toBe(true);
    }
  });

  it('все телефоны — из диапазона для вымышленных номеров', () => {
    for (const contact of CONTACTS) {
      for (const phone of contact.phones)
        expect(phone.number).toMatch(/^\+7 \(900\) 555-\d\d-\d\d$/);
    }
  });

  it('и личных, и общих записей хватает, чтобы переключатель было видно', () => {
    const kinds: RecordKind[] = ['task', 'note', 'document', 'contact'];
    for (const kind of kinds) {
      const visibilities = SEED_RECORDS.filter((record) => record.kind === kind).map(
        (record) => record.visibility,
      );
      expect(visibilities, `личные записи вида ${kind}`).toContain('personal');
      expect(
        visibilities.some((visibility) => visibility !== 'personal'),
        `общие записи вида ${kind}`,
      ).toBe(true);
    }
  });

  it('всех трёх значений доступа достаточно в данных', () => {
    const used = new Set(SEED_RECORDS.map((record) => record.visibility));
    expect([...used].sort()).toEqual(['adults', 'household', 'personal']);
  });

  it('по таблице 7.2: недвижимость — «Взрослые», организации и мастера — «Вся семья»', () => {
    expect(PROPERTIES.every((property) => property.visibility === 'adults')).toBe(true);
    const shared = CONTACTS.filter((contact) => contact.visibility !== 'personal');
    expect(shared.every((contact) => contact.visibility === 'household')).toBe(true);
  });

  it('у взрослого прототипа есть личные документы, у объектов — общие', () => {
    expect(DOCUMENTS.some((doc) => doc.visibility === 'personal')).toBe(true);
    expect(
      DOCUMENTS.filter((doc) => doc.propertyId !== undefined).every(
        (doc) => doc.visibility === 'adults',
      ),
    ).toBe(true);
  });

  it('семья: взрослый, администратор и ребёнок; сегодня — четверг, 22 октября', () => {
    expect(PEOPLE.map((person) => person.role).sort()).toEqual(['admin', 'adult', 'child']);
    expect(TODAY).toBe('2026-10-22');
  });
});

describe('данные, на которых держатся пять заданий проверки', () => {
  it('1: окно показаний воды квартиры, где живёт семья, — до 25 числа; у второй квартиры срок другой', () => {
    const family = PROPERTIES.find((property) => property.status === 'live');
    expect(family?.title).toBe('Квартира на Садовой');
    const water = ACCOUNTS.find((a) => a.propertyId === family?.id && a.short === 'вода');
    expect(water?.window).toEqual({ from: 20, to: 25 });
    const rented = PROPERTIES.find((property) => property.status === 'rent');
    const rentedWater = ACCOUNTS.find((a) => a.propertyId === rented?.id && a.short === 'вода');
    expect(rentedWater?.window?.to).not.toBe(25);
    expect(
      METERS.filter((meter) => meter.propertyId === family?.id && meter.accountId === water?.id),
    ).toHaveLength(4);
  });

  it('2: страховка дачи заканчивается 14 ноября 2026, страховка квартиры — другая', () => {
    const dacha = PROPERTIES.find((property) => property.propertyType === 'Дача');
    const policies = DOCUMENTS.filter(
      (doc) => doc.group === 'policy' && doc.title.includes('Страховка'),
    );
    expect(policies.length).toBeGreaterThanOrEqual(2);
    expect(policies.find((doc) => doc.propertyId === dacha?.id)?.expires).toBe('2026-11-14');
  });

  it('3: сантехник один, у него есть телефон', () => {
    const plumbers = CONTACTS.filter((contact) => contact.role === 'Сантехник');
    expect(plumbers).toHaveLength(1);
    expect(plumbers[0]?.phones[0]?.number).toBe('+7 (900) 555-01-23');
  });
});
