import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { AutoDrafts, DraftSchemas } from '@homecrm/shared';
import { parseBuffer } from 'music-metadata';
import { z } from 'zod';
import { loadAiConfig } from '../config.ts';
import { note } from '../prompts/note.ts';
import { shopping } from '../prompts/shopping.ts';
import { task } from '../prompts/task.ts';
import { createProviders } from '../providers.ts';
import { cases, context } from './cases.ts';

const Sample = z.strictObject({
  kind: z.enum(['task', 'shopping', 'note', 'auto']),
  text: z.string(),
  expected: z.unknown(),
});
const index = process.argv.indexOf('--samples');
const directory =
  index >= 0 ? resolve(process.argv[index + 1] ?? '') : join(import.meta.dirname, 'samples');
const prompts = { task, shopping, note };
if (process.argv.includes('--rules-only')) {
  for (const kind of Object.keys(prompts) as (keyof typeof prompts)[])
    prompts[kind] = prompts[kind].split('\n')[0] ?? '';
}
const omit = process.argv.find((arg) => arg.startsWith('--omit='))?.slice(7);
if (omit) {
  const [kind, line] = omit.split(':');
  if (!(kind && kind in prompts && /^\d+$/.test(line ?? '')))
    throw new Error('Invalid evaluation variant');
  const key = kind as keyof typeof prompts;
  prompts[key] = prompts[key]
    .split('\n')
    .filter((_, index) => index !== Number(line))
    .join('\n');
}
const config = loadAiConfig({
  ...process.env,
  AI_STT_PROVIDER: process.env.AI_STT_PROVIDER ?? 'fake',
  AI_EXTRACT_PROVIDER: process.env.AI_EXTRACT_PROVIDER ?? 'fake',
});
const providers = createProviders(config, undefined, prompts);
let total = 0;
let correct = 0;
let samples = 0;
let failed = 0;
const failureCodes: Record<string, number> = {};
const missed: { sample: number; fields: string[] }[] = [];
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
  const inputs =
    index < 0 && config.AI_EXTRACT_PROVIDER !== 'fake'
      ? cases
      : await Promise.all(
          (await readdir(directory))
            .filter((name) => name.endsWith('.json'))
            .map(async (name) =>
              Sample.parse(JSON.parse(await readFile(join(directory, name), 'utf8'))),
            ),
        );
  const only = process.argv.find((arg) => arg.startsWith('--kind='))?.slice(7);
  for (const [sampleIndex, sample] of inputs.entries()) {
    if (only && sample.kind !== only && sample.kind !== 'auto') continue;
    const expected = (sample.kind === 'auto' ? AutoDrafts : DraftSchemas[sample.kind]).parse(
      sample.expected,
    );
    let actual: unknown;
    try {
      actual = await providers.extractor.extract({ kind: sample.kind, text: sample.text, context });
    } catch (error) {
      failed++;
      const code =
        error instanceof Error && 'code' in error ? String(error.code) : 'EVALUATION_ERROR';
      failureCodes[code] = (failureCodes[code] ?? 0) + 1;
    }
    const expectedRows = Array.isArray(expected) ? expected : [expected];
    const actualRows = Array.isArray(actual) ? actual : actual ? [actual] : [];
    const missing: string[] = [];
    score(`${sample.kind}.count`, actualRows.length === expectedRows.length);
    expectedRows.forEach((row, i) => {
      for (const [key, value] of Object.entries(row)) {
        const matched = isDeepStrictEqual(normalize(actualRows[i]?.[key]), normalize(value));
        if (!matched) missing.push(`${i}.${key}`);
        score(`${sample.kind}.${key}`, matched);
      }
    });
    samples++;
    if (missing.length) missed.push({ sample: sampleIndex + 1, fields: missing });
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
      mode: config.AI_EXTRACT_PROVIDER === 'fake' ? 'contract' : 'quality',
      failed,
      failureCodes,
      variant: omit ?? (process.argv.includes('--rules-only') ? 'rules-only' : 'full'),
      promptLengths: Object.fromEntries(
        Object.entries(prompts).map(([kind, text]) => [kind, text.length]),
      ),
      missed,
      fields: total,
      byField,
      correct,
      accuracy: total ? correct / total : 0,
      extraction: {
        correct: correct - (byField['speech.text']?.correct ?? 0),
        fields: total - (byField['speech.text']?.total ?? 0),
        accuracy:
          (correct - (byField['speech.text']?.correct ?? 0)) /
          (total - (byField['speech.text']?.total ?? 0) || 1),
      },
      durationMs: Date.now() - started,
    }),
  );
  const extractionTotal = total - (byField['speech.text']?.total ?? 0);
  const extractionCorrect = correct - (byField['speech.text']?.correct ?? 0);
  if (!extractionTotal || extractionCorrect / extractionTotal < 0.85 || failed)
    process.exitCode = 1;
} catch {
  console.error('AI evaluation failed');
  process.exitCode = 1;
} finally {
  await providers.close();
}
function normalize(value: unknown): unknown {
  if (typeof value === 'string') return value.toLocaleLowerCase('ru').trim();
  if (value && typeof value === 'object' && 'value' in value)
    return { ...value, value: normalize(value.value) };
  return value;
}
