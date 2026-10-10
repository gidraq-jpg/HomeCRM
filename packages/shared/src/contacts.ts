import { z } from 'zod';
import { CalendarDate } from './deadlines.ts';
import { WebLink } from './utilities.ts';

export const PERSON_CATEGORIES = [
  'family',
  'friend',
  'craftsperson',
  'doctor',
  'tutor',
  'neighbor',
  'tenant',
  'other',
] as const;
export const INTERACTION_KINDS = ['call', 'visit', 'message', 'work'] as const;
export const ContactBirthday = z.union([
  CalendarDate,
  z
    .string()
    .regex(/^--\d{2}-\d{2}$/)
    .refine((v) => CalendarDate.safeParse(`2000${v.slice(1)}`).success),
]);
export const ContactPhone = z.strictObject({
  number: z.string().trim().min(1).max(100),
  label: z.string().trim().max(200).default(''),
  emergency: z.boolean().default(false),
});
export const PersonData = z.strictObject({
  categories: z
    .array(z.enum(PERSON_CATEGORIES))
    .max(PERSON_CATEGORIES.length)
    .refine((v) => new Set(v).size === v.length)
    .default([]),
  phones: z.array(ContactPhone).max(20).default([]),
  emails: z.array(z.email().max(254)).max(20).default([]),
  messengers: z
    .array(z.strictObject({ label: z.string().trim().max(200).default(''), url: WebLink }))
    .max(20)
    .default([]),
  address: z.string().trim().max(4000).default(''),
  birthday: ContactBirthday.nullable().default(null),
  // Отсутствующий флаг при правке означает сохранение текущего напоминания.
  birthdayEnabled: z.boolean().optional(),
  note: z.string().max(10000).default(''),
});
export type PersonData = z.infer<typeof PersonData>;
export const InteractionData = z.strictObject({
  kind: z.enum(INTERACTION_KINDS),
  occurredOn: CalendarDate,
  text: z.string().trim().min(1).max(10000),
  amountCents: z.number().int().safe().nonnegative().nullable().default(null),
  callAgain: z.boolean().nullable().default(null),
  objectId: z.uuid().nullable().default(null),
});

/** CONT-5: телефон очищается для URI; неподходящий номер не превращается в ссылку. */
export function contactActions(data: {
  phones: { number: string; label: string }[];
  address: string;
  emails?: string[];
  messengers?: { label: string; url: string }[];
}) {
  return {
    phones: data.phones.flatMap(({ number, label }) => {
      const normalized = number.replace(/[\s().-]/g, '');
      return /^\+?\d{3,15}$/.test(normalized) ? [{ label, href: `tel:${normalized}` }] : [];
    }),
    emails: (data.emails ?? []).map((email) => ({
      href: `mailto:${encodeURIComponent(email).replace(/%40/g, '@')}`,
    })),
    messengers: (data.messengers ?? []).map(({ label, url }) => ({
      label,
      href: url,
    })),
    mapAddress: data.address || null,
  };
}
