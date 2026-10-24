import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { DraftSchemas } from '@homecrm/shared';
import { parseBuffer } from 'music-metadata';
import { z } from 'zod';
import { loadAiConfig } from '../config.ts';
import { createProviders } from '../providers.ts';

const Sample = z.strictObject({
  kind: z.enum(['task', 'shopping', 'note']),
  text: z.string(),
  expected: z.unknown(),
});
const index = process.argv.indexOf('--samples');
const directory =
  index >= 0 ? resolve(process.argv[index + 1] ?? '') : join(import.meta.dirname, 'samples');
const providers = createProviders(
  loadAiConfig({
    ...process.env,
    AI_STT_PROVIDER: process.env.AI_STT_PROVIDER ?? 'fake',
    AI_EXTRACT_PROVIDER: process.env.AI_EXTRACT_PROVIDER ?? 'fake',
  }),
);
let total = 0;
let correct = 0;
let samples = 0;
const byField: Record<string, { total: number; correct: number }> = {};
function score(field: string, matched: boolean) {
  const entry = byField[field] ?? { total: 0, correct: 0 };
  entry.total++;
  total++;
  if (matched) {
    entry.correct++;
    correct++;
  }
  byField[field] = entry;
}
const started = Date.now();
try {
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.json')) continue;
    const sample = Sample.parse(JSON.parse(await readFile(join(directory, name), 'utf8')));
    const expected = DraftSchemas[sample.kind].parse(sample.expected);
    const actual = await providers.extractor.extract({
      kind: sample.kind,
      text: sample.text,
      context: { objects: [], members: [], timeZone: 'UTC' },
    });
    const expectedRows = Array.isArray(expected) ? expected : [expected];
    const actualRows = Array.isArray(actual) ? actual : [actual];
    score(`${sample.kind}.count`, actualRows.length === expectedRows.length);
    expectedRows.forEach((row, i) => {
      for (const [key, value] of Object.entries(row)) {
        score(
          `${sample.kind}.${key}`,
          isDeepStrictEqual(actualRows[i]?.[key as keyof typeof row], value),
        );
      }
    });
    samples++;
  }
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.wav')) continue;
    const bytes = await readFile(join(directory, name));
    const meta = await parseBuffer(bytes, { mimeType: 'audio/wav' }, { duration: true });
    const result = await providers.speech.transcribe(
      { bytes, mime: 'audio/wav', durationMs: (meta.format.duration ?? 0) * 1000 },
      { lang: 'ru' },
    );
    const expected =
      process.env.AI_STT_PROVIDER === 'local-stt'
        ? (await readFile(join(directory, `${name}.txt`), 'utf8')).trim()
        : 'Вымышленный образец';
    score(
      'speech.text',
      result.text
        .toLocaleLowerCase('ru')
        .replace(/[.,!?]/g, '')
        .trim() === expected.toLocaleLowerCase('ru').trim(),
    );
    samples++;
  }
  console.log(
    JSON.stringify({
      samples,
      fields: total,
      byField,
      correct,
      accuracy: total ? correct / total : 0,
      durationMs: Date.now() - started,
    }),
  );
  if (!total || correct !== total) process.exitCode = 1;
} catch {
  console.error('AI evaluation failed');
  process.exitCode = 1;
} finally {
  await providers.close();
}
