import type { Role } from '@homecrm/shared';
import type { Visibility } from '../access/visibility.ts';
import type { DateOnly } from '../ui/format.ts';

// Модель вымышленных данных прототипа. Она повторяет PRD, раздел 12, но неглубоко:
// ровно то, что нужно экранам прототипа. Деньги — целые копейки.

export type PersonId = 'anna' | 'igor' | 'nika';

export interface Person {
  id: PersonId;
  name: string;
  fullName: string;
  role: Role;
  birthday: DateOnly;
}

/** Общие поля записи: от аудитории зависит, кто её видит (PRD, раздел 7). */
interface RecordBase {
  id: string;
  visibility: Visibility;
}

export interface TaskRecord extends RecordBase {
  kind: 'task';
  title: string;
  /** День плана; `null` — «без даты». */
  when: DateOnly | null;
  time?: string;
  status: 'open' | 'waiting' | 'done';
  assignee: PersonId;
  propertyId?: string;
  /** Для статуса «жду»: от кого ждём и когда проверить (TASK-8). */
  waiting?: string;
}

export interface NoteRecord extends RecordBase {
  kind: 'note';
  title: string;
  text: string;
  created: DateOnly;
  propertyId?: string;
}

export interface ShoppingRecord extends RecordBase {
  kind: 'shopping';
  title: string;
  bought: boolean;
}

export type DocGroup = 'identity' | 'policy' | 'property' | 'other';

export interface DocumentRecord extends RecordBase {
  kind: 'document';
  title: string;
  docType: string;
  group: DocGroup;
  /** Чей документ: имя участника или название объекта. */
  owner: string;
  propertyId?: string;
  number?: string;
  issuedBy?: string;
  issued?: DateOnly;
  /** `null` — бессрочно. */
  expires: DateOnly | null;
  /** Сколько страниц отсканировано. */
  files: number;
}

export interface Phone {
  label: string;
  number: string;
}

export interface Interaction {
  id: string;
  date: DateOnly;
  text: string;
  /** Копейки. */
  amount?: number;
  /** Оценка «звать снова». */
  again?: boolean;
  propertyId?: string;
}

export type ContactKind = 'person' | 'organization';

export interface ContactRecord extends RecordBase {
  kind: 'contact';
  name: string;
  contactKind: ContactKind;
  /** Подпись: «Сантехник», «УК или ТСЖ», «Подруга». */
  role: string;
  phones: Phone[];
  address?: string;
  hours?: string;
  note?: string;
  birthday?: DateOnly;
  propertyIds: string[];
  interactions: Interaction[];
}

export type PropertyStatus = 'live' | 'rent' | 'empty';

export interface PropertyRecord extends RecordBase {
  kind: 'property';
  title: string;
  address: string;
  propertyType: string;
  status: PropertyStatus;
  area?: number;
  responsible: PersonId;
  owners: string;
}

export type ProtoRecord =
  | TaskRecord
  | NoteRecord
  | ShoppingRecord
  | DocumentRecord
  | ContactRecord
  | PropertyRecord;

export type RecordKind = ProtoRecord['kind'];
export type RecordOf<K extends RecordKind> = Extract<ProtoRecord, { kind: K }>;

// Дочерние записи объекта лежат в его пространстве и не видны шире него (правило 7.3.3):
// отдельного значения доступа у них нет, оно берётся у объекта.

export interface Account {
  id: string;
  propertyId: string;
  title: string;
  /** Короткое название услуги для фраз вроде «показания: вода». */
  short: string;
  supplier: string;
  /** Контакт-организация поставщика, если она есть в «Людях». */
  contactId?: string;
  number: string;
  /** Способ передачи показаний (UTIL-2). */
  method: string;
  /** Окно передачи показаний: числа месяца. */
  window?: { from: number; to: number };
  /** Срок оплаты словами: «до 15-го числа». */
  payment: string;
  payer: string;
}

export type Resource = 'ХВС' | 'ГВС' | 'Электроэнергия';

export interface Meter {
  id: string;
  propertyId: string;
  accountId: string;
  resource: Resource;
  place: string;
  serial: string;
  unit: 'м³' | 'кВт·ч';
  /** Знаков после запятой в показании. */
  digits: number;
  previous: number;
  previousDate: DateOnly;
  /** Обычный расход за месяц: для предупреждения об аномалии (UTIL-5). */
  typical: number;
  nextVerification: DateOnly;
}

export interface Charge {
  id: string;
  propertyId: string;
  accountId: string;
  title: string;
  /** Копейки. */
  amount: number;
  due: DateOnly;
  paid: boolean;
}

export interface FeedEvent {
  id: string;
  propertyId: string;
  date: DateOnly;
  title: string;
  details?: string;
  /** Копейки. */
  amount?: number;
  contactId?: string;
}
