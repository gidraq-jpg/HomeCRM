import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { parsePaymentQr, ReceiptPhotoDraft } from '@homecrm/shared';
import sharp from 'sharp';
import { z } from 'zod';
import { receipt } from '../prompts/receipt.ts';
import type { createProviders } from '../providers.ts';

const require = createRequire(new URL('../../../../web/package.json', import.meta.url));
const jsQR = require('jsqr') as (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => { binaryData: number[] } | null;
const Sample = z.strictObject({
  image: z.string(),
  qr: z.string().nullable(),
  account: z.strictObject({ id: z.uuid(), number: z.string(), title: z.string() }),
  expected: z.strictObject({
    supplier: z.string(),
    period: z.string(),
    totalCents: z.number().int(),
    dueOn: z.string(),
  }),
});
export async function evaluateReceipts(
  providers: ReturnType<typeof createProviders>,
  fake: boolean,
  prompts = { receipt },
) {
  const index = process.argv.indexOf('--samples');
  const directory =
    index < 0
      ? join(import.meta.dirname, 'samples/receipts')
      : resolve(process.argv[index + 1] ?? '');
  const cases = z
    .array(Sample)
    .parse(JSON.parse(await readFile(join(directory, 'cases.json'), 'utf8')));
  const accounts = cases.map((sample) => sample.account);
  let fields = 0,
    correct = 0,
    failed = 0,
    qrTotal = 0,
    qrCorrect = 0;
  const byField: Record<string, { total: number; correct: number }> = {};
  const codes: Record<string, number> = {};
  const started = Date.now();
  for (const sample of cases) {
    const bytes = await readFile(join(directory, sample.image));
    let draft: ReceiptPhotoDraft | undefined;
    try {
      draft = ReceiptPhotoDraft.parse(
        await providers.photo({
          kind: 'receipt',
          image: { bytes, classification: 'ordinary' },
          context: { objects: [], members: [], timeZone: 'UTC', accounts },
        }),
      );
    } catch (error) {
      failed++;
      const code =
        error instanceof Error && 'code' in error ? String(error.code) : 'INVALID_RESPONSE';
      codes[code] = (codes[code] ?? 0) + 1;
    }
    const expected = { ...sample.expected, accountId: sample.account.id };
    for (const [key, value] of Object.entries(expected)) {
      const name = key as keyof ReceiptPhotoDraft;
      const actual = draft?.[name].value;
      const matched = fake
        ? !!draft
        : typeof value === 'string'
          ? String(actual).toLocaleLowerCase('ru').trim() === value.toLocaleLowerCase('ru').trim()
          : actual === value;
      const counter = byField[name] ?? { total: 0, correct: 0 };
      counter.total++;
      fields++;
      if (matched) {
        counter.correct++;
        correct++;
      }
      byField[name] = counter;
    }
    if (sample.qr) {
      qrTotal++;
      const { data, info } = await sharp(bytes)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
      const parsed = code ? parsePaymentQr(new Uint8Array(code.binaryData)) : null;
      if (
        parsed?.totalCents === sample.expected.totalCents &&
        parsed.accountNumber === sample.account.number &&
        parsed.period === sample.expected.period
      )
        qrCorrect++;
    }
  }
  console.log(
    JSON.stringify({
      kind: 'receipt',
      mode: fake ? 'contract' : 'quality',
      samples: cases.length,
      fields,
      correct,
      accuracy: correct / fields,
      failed,
      codes,
      byField,
      qr: { total: qrTotal, correct: qrCorrect },
      promptLength: prompts.receipt.length,
      variant: process.argv.find((arg) => arg.startsWith('--omit=')) ?? 'full',
      durationMs: Date.now() - started,
    }),
  );
  if (failed || correct / fields < (fake ? 1 : 0.85) || qrCorrect !== qrTotal) process.exitCode = 1;
}
