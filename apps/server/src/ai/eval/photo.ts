import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { IdentityCheck, MeterData, MeterPhotoDraft } from '@homecrm/shared';
import { z } from 'zod';
import { common } from '../prompts/common.ts';
import { identity } from '../prompts/identity.ts';
import { meter } from '../prompts/meter.ts';
import type { createProviders } from '../providers.ts';

const Sample = z.strictObject({
  image: z.string(),
  meter: MeterData.pick({
    resource: true,
    integerDigits: true,
    fractionDigits: true,
    zones: true,
    unit: true,
  }).extend({ previous: z.array(z.string()).nullable() }),
  expected: z.array(z.string()),
});
export async function evaluatePhotos(
  providers: ReturnType<typeof createProviders>,
  fake: boolean,
  prompts = { meter, identity },
) {
  const samplesIndex = process.argv.indexOf('--samples');
  const directory =
    samplesIndex < 0
      ? join(import.meta.dirname, 'samples/meters')
      : resolve(process.argv[samplesIndex + 1] ?? '');
  const cases = z
    .array(Sample)
    .parse(JSON.parse(await readFile(join(directory, 'cases.json'), 'utf8')));
  let total = 0,
    correct = 0,
    failed = 0;
  const codes: Record<string, number> = {};
  const started = Date.now();
  for (const sample of cases) {
    let draft: MeterPhotoDraft | undefined;
    try {
      draft = MeterPhotoDraft.parse(
        await providers.photo({
          kind: 'meter',
          image: {
            bytes: await readFile(join(directory, sample.image)),
            classification: 'ordinary',
          },
          context: { objects: [], members: [], timeZone: 'UTC', meter: sample.meter },
        }),
      );
    } catch (error) {
      failed++;
      const code =
        error instanceof Error && 'code' in error ? String(error.code) : 'INVALID_RESPONSE';
      codes[code] = (codes[code] ?? 0) + 1;
    }
    sample.expected.forEach((value, i) => {
      total++;
      if (
        fake ? draft?.values.length === sample.expected.length : draft?.values[i]?.value === value
      )
        correct++;
    });
  }
  console.log(
    JSON.stringify({
      kind: 'meter',
      mode: fake ? 'contract' : 'quality',
      samples: cases.length,
      fields: total,
      correct,
      accuracy: correct / total,
      failed,
      codes,
      variant: process.argv.find((arg) => arg.startsWith('--omit=')) ?? 'full',
      promptLengths: {
        common: common.length,
        identity: prompts.identity.length,
        meter: prompts.meter.length,
      },
      durationMs: Date.now() - started,
    }),
  );
  if (failed || correct / total < (fake ? 1 : 0.9)) process.exitCode = 1;
}

export async function evaluateIdentity(
  providers: ReturnType<typeof createProviders>,
  fake: boolean,
  prompts = { identity },
) {
  const index = process.argv.indexOf('--samples');
  const directory =
    index < 0
      ? join(import.meta.dirname, 'samples/identity')
      : resolve(process.argv[index + 1] ?? '');
  const cases = z
    .array(z.strictObject({ image: z.string() }))
    .parse(JSON.parse(await readFile(join(directory, 'cases.json'), 'utf8')));
  let correct = 0,
    failed = 0;
  for (const sample of cases) {
    try {
      const draft = IdentityCheck.parse(
        await providers.extractor.extract({
          kind: 'identity',
          image: {
            bytes: await readFile(join(directory, sample.image)),
            classification: 'ordinary',
          },
          context: { objects: [], members: [], timeZone: 'UTC' },
        }),
      );
      if (fake || draft.identity !== 'no') correct++;
    } catch {
      failed++;
    }
  }
  console.log(
    JSON.stringify({
      kind: 'identity',
      mode: fake ? 'contract' : 'quality',
      samples: cases.length,
      correct,
      failed,
      accuracy: correct / cases.length,
      promptLength: prompts.identity.length,
      variant: process.argv.find((arg) => arg.startsWith('--omit=')) ?? 'full',
    }),
  );
  if (failed || correct !== cases.length) process.exitCode = 1;
}
