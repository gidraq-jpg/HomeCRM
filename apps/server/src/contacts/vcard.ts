import { ContactBirthday, PersonData } from '@homecrm/shared';
import { z } from 'zod';
import { Failure } from '../objects/support.ts';

export const MAX_VCARD_BYTES = 512 * 1024;
export const VCardFile = z.strictObject({
  fileName: z
    .string()
    .min(1)
    .max(255)
    .regex(/\.vcf$/i),
  content: z
    .string()
    .min(1)
    .max(MAX_VCARD_BYTES)
    .refine((v) => Buffer.byteLength(v, 'utf8') <= MAX_VCARD_BYTES),
});
export type ImportedPerson = { title: string; data: PersonData; organization: string };
function invalid(): never {
  throw new Failure(
    400,
    'INVALID_VCARD',
    'Не удалось прочитать vCard. Проверьте формат 3.0 или 4.0 и поля карточек.',
  );
}
export function normalizePhone(number: string): string | null {
  const clean = number.replace(/^tel:/i, '').replace(/[\s().-]/g, '');
  if (!/^\+?\d{3,15}$/.test(clean)) return null;
  const digits = clean.replace(/^\+/, '');
  return digits.length === 11 && digits.startsWith('8') ? `7${digits.slice(1)}` : digits;
}
function split(value: string, delimiter: string): string[] {
  const out = [''];
  let escaped = false;
  for (const char of value) {
    if (!escaped && char === delimiter) out.push('');
    else out[out.length - 1] += char;
    escaped = char === '\\' && !escaped;
  }
  return out;
}
const decodeText = (v: string) =>
  v.replace(/\\([nN,;\\])/g, (_, c: string) => (/[nN]/.test(c) ? '\n' : c)).trim();
function quotedPrintable(value: string, charset: string) {
  if (/=(?![a-f0-9]{2})/i.test(value)) invalid();
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '=') {
      bytes.push(Number.parseInt(value.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(...Buffer.from(value[i] ?? '', 'utf8'));
  }
  if (!['utf-8', 'utf8', 'windows-1251', 'iso-8859-1'].includes(charset.toLowerCase())) invalid();
  try {
    return new TextDecoder(charset, { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return invalid();
  }
}
/** Ограниченный текстовый vCard 3/4; неизвестные свойства и PHOTO не исполняются и не сохраняются. */
export function parseVCard(content: string): ImportedPerson[] {
  if (content.includes('\0') || content.includes('\uFFFD')) invalid();
  const lines = content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const logical: string[] = [];
  for (const line of lines) {
    const prev = logical[logical.length - 1];
    if (prev && /;ENCODING=QUOTED-PRINTABLE/i.test(prev.split(':')[0] ?? '') && prev.endsWith('='))
      logical[logical.length - 1] = prev.slice(0, -1) + line.replace(/^[ \t]/, '');
    else if (/^[ \t]/.test(line) && prev) logical[logical.length - 1] = prev + line.slice(1);
    else logical.push(line);
  }
  const cards: ImportedPerson[] = [];
  let fields: Map<string, string[]> | null = null;
  for (const line of logical) {
    if (!line.trim()) continue;
    if (line.toUpperCase() === 'BEGIN:VCARD') {
      if (fields) invalid();
      fields = new Map();
      continue;
    }
    if (line.toUpperCase() === 'END:VCARD') {
      if (!fields || !['3.0', '4.0'].includes(fields.get('VERSION')?.[0] ?? '')) invalid();
      const first = (key: string) => fields?.get(key)?.[0] ?? '';
      const name = split(first('N'), ';').map(decodeText);
      const title =
        decodeText(first('FN')) ||
        [name[3], name[1], name[2], name[0], name[4]].filter(Boolean).join(' ');
      const rawBirth = first('BDAY')
        .replace(/^--(\d{2})(\d{2})$/, '--$1-$2')
        .replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
      const birth = rawBirth ? ContactBirthday.safeParse(rawBirth) : null;
      if (birth && !birth.success) invalid();
      const data = PersonData.safeParse({
        phones: (fields.get('TEL') ?? []).map((v) => ({
          number: decodeText(v).replace(/^tel:/i, ''),
        })),
        emails: (fields.get('EMAIL') ?? []).map(decodeText),
        address: split(first('ADR'), ';').map(decodeText).filter(Boolean).join(', '),
        birthday: birth?.success ? birth.data : null,
        note: decodeText(first('NOTE')),
      });
      if (!title || title.length > 200 || !data.success) invalid();
      const organization = split(first('ORG'), ';').map(decodeText).filter(Boolean).join(' · ');
      if (organization.length > 200 || cards.length >= 500) invalid();
      cards.push({ title, data: data.data, organization });
      fields = null;
      continue;
    }
    if (!fields) invalid();
    const colon = line.indexOf(':');
    if (colon <= 0) invalid();
    const header = line.slice(0, colon),
      key = (header.split(';')[0]?.split('.').at(-1) ?? '').toUpperCase();
    if (
      key === 'PHOTO' ||
      !['VERSION', 'FN', 'N', 'TEL', 'EMAIL', 'ADR', 'BDAY', 'ORG', 'NOTE'].includes(key)
    )
      continue;
    let value = line.slice(colon + 1);
    if (/;ENCODING=QUOTED-PRINTABLE/i.test(header))
      value = quotedPrintable(value, /;CHARSET=([^;:]+)/i.exec(header)?.[1] ?? 'utf-8');
    fields.set(key, [...(fields.get(key) ?? []), value]);
  }
  if (fields || !cards.length) invalid();
  return cards;
}
export function mergePerson(existing: PersonData, incoming: PersonData): PersonData {
  const phones = [...existing.phones];
  const seen = new Set(phones.map((p) => normalizePhone(p.number) ?? p.number));
  for (const phone of incoming.phones) {
    const key = normalizePhone(phone.number) ?? phone.number;
    if (!seen.has(key)) {
      phones.push(phone);
      seen.add(key);
    }
  }
  const emails = [...existing.emails];
  for (const email of incoming.emails)
    if (!emails.some((e) => e.toLowerCase() === email.toLowerCase())) emails.push(email);
  const parsed = PersonData.safeParse({
    ...existing,
    phones,
    emails,
    address: existing.address || incoming.address,
    birthday: existing.birthday ?? incoming.birthday,
    note:
      existing.note && incoming.note && existing.note !== incoming.note
        ? `${existing.note}\n${incoming.note}`
        : existing.note || incoming.note,
  });
  if (!parsed.success) throw new Failure(409, 'IMPORT_FIELD_LIMIT');
  return parsed.data;
}
