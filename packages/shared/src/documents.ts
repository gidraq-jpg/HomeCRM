import { z } from 'zod';
import { CalendarDate } from './deadlines.ts';

/** DOC-1: закрытый каталог; реквизиты документа никогда не служат поисковыми полями. */
export const DOCUMENT_TYPES = [
  'russian_passport',
  'international_passport',
  'birth_certificate',
  'snils',
  'inn',
  'driver_license',
  'oms',
  'dms',
  'osago',
  'kasko',
  'property_insurance',
  'sts',
  'pts',
  'egrn',
  'contract',
  'warranty_receipt',
  'medical',
  'school',
  'certificate',
  'other',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const DOCUMENT_LABELS: Readonly<Record<DocumentType, string>> = {
  russian_passport: 'Паспорт РФ',
  international_passport: 'Загранпаспорт',
  birth_certificate: 'Свидетельство о рождении',
  snils: 'СНИЛС',
  inn: 'ИНН',
  driver_license: 'Водительское удостоверение',
  oms: 'ОМС',
  dms: 'ДМС',
  osago: 'ОСАГО',
  kasko: 'КАСКО',
  property_insurance: 'Страхование имущества',
  sts: 'СТС',
  pts: 'ПТС',
  egrn: 'Выписка ЕГРН',
  contract: 'Договор',
  warranty_receipt: 'Гарантия и чек',
  medical: 'Медицинский документ',
  school: 'Школьный документ',
  certificate: 'Справка',
  other: 'Другое',
};
export const IDENTITY_DOCUMENT_TYPES: readonly DocumentType[] = [
  'russian_passport',
  'international_passport',
  'birth_certificate',
  'snils',
  'inn',
  'driver_license',
];
export function documentWarnings(type: DocumentType): number[] {
  if (type === 'international_passport') return [180, 90, 30];
  if (type === 'driver_license') return [90, 30];
  if (['osago', 'kasko', 'property_insurance'].includes(type)) return [30, 14, 3];
  if (type === 'contract' || type === 'russian_passport') return [60, 30];
  if (type === 'warranty_receipt') return [30];
  return [30, 7];
}
export const DocumentData = z
  .strictObject({
    type: z.enum(DOCUMENT_TYPES).default('other'),
    series: z.string().trim().max(100).default(''),
    number: z.string().trim().max(200).default(''),
    issuedBy: z.string().trim().max(2000).default(''),
    issuedOn: CalendarDate.nullable().default(null),
    expiresOn: CalendarDate.nullable().default(null),
    indefinite: z.boolean().default(false),
    note: z.string().max(10000).default(''),
    tags: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
    warnings: z.array(z.number().int().min(0).max(365)).max(20).optional(),
  })
  .refine((d) => !(d.indefinite && d.expiresOn), {
    message: 'Бессрочный документ не имеет даты окончания',
  })
  .refine((d) => !d.issuedOn || !d.expiresOn || d.issuedOn <= d.expiresOn, {
    message: 'Срок раньше выдачи',
  });
export type DocumentData = z.infer<typeof DocumentData>;
export const DocumentOwner = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('member'), id: z.uuid() }),
  z.strictObject({ kind: z.literal('contact'), id: z.uuid() }),
  z.strictObject({ kind: z.literal('object'), id: z.uuid() }),
]);
export type DocumentOwner = z.infer<typeof DocumentOwner>;
