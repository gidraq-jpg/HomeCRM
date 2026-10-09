import { AUDIENCES, OrganizationData, PersonData } from '@homecrm/shared';
import * as z from 'zod';

// Схемы ответов контактов (ADR-0036, docs/passport-people-api.md): организации и люди приходят из
// одного маршрута, а вид записи (`kind`) выбирает форму `data`. ФИО, телефоны и адреса живут только
// в ответах и памяти страницы: в адреса, журнал, localStorage и кэш сервис-воркера они не попадают.

/** Быстрые действия (CONT-5): ссылки готовит сервер, клиент только подставляет их в кнопки. */
export const ContactActions = z.object({
  phones: z.array(z.object({ label: z.string(), href: z.string() })),
  emails: z.array(z.object({ href: z.string() })),
  messengers: z.array(z.object({ label: z.string(), href: z.string() })),
  mapAddress: z.string().nullable(),
});
export type ContactActions = z.infer<typeof ContactActions>;

export const NO_ACTIONS: ContactActions = {
  phones: [],
  emails: [],
  messengers: [],
  mapAddress: null,
};

export const ContactBase = {
  id: z.string(),
  title: z.string(),
  spaceId: z.string(),
  spaceKind: z.enum(['personal', 'household']),
  audience: z.enum(AUDIENCES).nullable(),
  authorId: z.string(),
  assigneeId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  /** Видимая организация человека; скрытая или удалённая приходит как `null`. */
  organizationId: z.string().nullable().default(null),
  organization: z.object({ id: z.string(), title: z.string() }).nullable().default(null),
  actions: ContactActions.catch(NO_ACTIONS),
};

export const OrganizationCard = z.object({
  ...ContactBase,
  kind: z.literal('organization'),
  data: OrganizationData,
});
export type OrganizationCard = z.infer<typeof OrganizationCard>;

export const PersonCard = z.object({
  ...ContactBase,
  kind: z.literal('person'),
  data: PersonData,
});
export type PersonCard = z.infer<typeof PersonCard>;

export const AnyContact = z.discriminatedUnion('kind', [OrganizationCard, PersonCard]);
export type AnyContact = z.infer<typeof AnyContact>;
