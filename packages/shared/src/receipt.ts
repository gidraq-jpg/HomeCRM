import { z } from 'zod';
import { BillingPeriod, Cents } from './charges.ts';

// Один и тот же стандартный декодер есть в браузере и Node; shared не зависит от DOM/Node типов.
const Decoder = (
  globalThis as typeof globalThis & {
    TextDecoder: new (
      encoding: string,
      options?: { fatal: boolean },
    ) => { decode: (bytes: Uint8Array) => string };
  }
).TextDecoder;
/** Напечатанные рубли — в целые копейки без вычислений над дробными Number. */
export function receiptKopecks(value: string | null): number | null {
  const text = value
    ?.trim()
    .replace(/\s/g, '')
    .replace(/(?:₽|руб\.?)$/iu, '')
    .replace(',', '.');
  const match = /^(\d{1,11})(?:\.(\d{1,2}))?$/.exec(text ?? '');
  if (!match) return null;
  const cents = BigInt(match[1] ?? '0') * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  return cents <= 1_000_000_000_000n ? Number(cents) : null;
}
export function receiptPeriod(value: string | null): string | null {
  if (!value) return null;
  if (BillingPeriod.safeParse(value).success) return value;
  const match = /(?:^|\D)(0[1-9]|1[0-2])[.\-/]?(\d{4})(?:\D|$)/.exec(value);
  return match ? `${match[2]}-${match[1]}` : null;
}
const QrReceipt = z.strictObject({
  supplier: z.string().max(500).nullable(),
  accountNumber: z.string().max(200).nullable(),
  totalCents: Cents.nonnegative().nullable(),
  period: BillingPeriod.nullable(),
  purpose: z.string().max(2000).nullable(),
});
export type QrReceipt = z.infer<typeof QrReceipt>;
export function parsePaymentQr(input: unknown): QrReceipt | null {
  const source = z
    .union([z.string().max(16384), z.instanceof(Uint8Array).refine((v) => v.length <= 16384)])
    .safeParse(input);
  if (!source.success) return null;
  try {
    let text: string;
    if (typeof source.data === 'string') text = source.data;
    else {
      const header = new Decoder('ascii').decode(source.data.subarray(0, 8));
      const encoding = header.startsWith('ST00011|')
        ? 'windows-1251'
        : header.startsWith('ST00012|')
          ? 'utf-8'
          : header.startsWith('ST00013|')
            ? 'koi8-r'
            : null;
      if (!encoding) return null;
      text = new Decoder(encoding, { fatal: true }).decode(source.data);
    }
    if (!/^ST0001[123]\|/.test(text) || text.includes('\ufffd')) return null;
    const fields = new Map<string, string>();
    for (const item of text.slice(8).split('|')) {
      if (!item) continue;
      const index = item.indexOf('=');
      if (index < 1) return null;
      const key = item.slice(0, index);
      if (fields.has(key)) return null;
      fields.set(key, item.slice(index + 1).trim());
    }
    const sum = fields.get('Sum');
    const cents = sum && /^\d{1,13}$/.test(sum) ? BigInt(sum) : null;
    const purpose = fields.get('Purpose') || null;
    const result = QrReceipt.safeParse({
      supplier: fields.get('Name') || null,
      accountNumber: fields.get('PersAcc') || fields.get('PersonalAcc') || null,
      totalCents: cents !== null && cents <= 1_000_000_000_000n ? Number(cents) : null,
      period: receiptPeriod(fields.get('PaymPeriod') ?? purpose),
      purpose,
    });
    return result.success &&
      (result.data.supplier || result.data.accountNumber || result.data.totalCents !== null)
      ? result.data
      : null;
  } catch {
    return null;
  }
}
export function matchReceiptAccount(
  number: string | null,
  accounts: readonly { id: string; number: string }[],
) {
  if (!number) return null;
  const matching = accounts.filter(
    (account) => account.number.replace(/\s/g, '') === number.replace(/\s/g, ''),
  );
  return matching.length === 1 ? (matching[0]?.id ?? null) : null;
}
