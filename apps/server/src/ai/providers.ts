import { readFile } from 'node:fs/promises';
import {
  CalendarDate,
  type Draft,
  type DraftKind,
  IdentityCheck,
  type MeterData,
  parseQuickline,
} from '@homecrm/shared';
import sharp from 'sharp';
import { ProxyAgent, type RequestInit as ProxyRequestInit, fetch as proxyFetch } from 'undici';
import { z } from 'zod';
import { Failure } from '../objects/support.ts';
import type { AiConfig } from './config.ts';
import { normalizeResponse, ResponseSchemas, requestContext } from './drafts.ts';
import { common } from './prompts/common.ts';
import { identity } from './prompts/identity.ts';
import { meter } from './prompts/meter.ts';
import { note } from './prompts/note.ts';
import { receipt } from './prompts/receipt.ts';
import { shopping } from './prompts/shopping.ts';
import { task } from './prompts/task.ts';

export interface Audio {
  bytes: Buffer;
  mime: string;
  durationMs: number;
}
export interface SpeechToText {
  transcribe(audio: Audio, options: { lang: 'ru' }): Promise<{ text: string; durationMs: number }>;
  health(): Promise<boolean>;
}
export interface ExtractRequest {
  kind: DraftKind | 'auto';
  text?: string;
  image?: { bytes: Buffer; classification: 'ordinary' | 'passport' | 'medical' };
  deadline?: number;
  context: {
    objects: readonly { id: string; title: string }[];
    members: readonly { id: string; name: string }[];
    timeZone: string;
    now?: Date;
    accounts?: readonly { id: string; number: string }[];
    meter?: Pick<MeterData, 'resource' | 'zones' | 'integerDigits' | 'fractionDigits' | 'unit'> & {
      previous: string[] | null;
    };
  };
}
export interface Extractor {
  extract(input: ExtractRequest): Promise<Draft>;
  health(): Promise<boolean>;
}
const unavailable = () =>
  new Failure(503, 'AI_UNAVAILABLE', 'Служба ИИ недоступна. Можно ввести вручную.');
const invalid = () =>
  new Failure(422, 'AI_INVALID_RESPONSE', 'Не удалось разобрать. Можно ввести вручную.');
const audioTypes = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
];
export function validateAudio(audio: Audio) {
  if (
    !audioTypes.includes(audio.mime) ||
    audio.bytes.length === 0 ||
    audio.bytes.length > 10 * 1024 * 1024 ||
    !Number.isFinite(audio.durationMs) ||
    audio.durationMs <= 0 ||
    audio.durationMs > 120000
  )
    throw new Failure(400, 'AI_INVALID_AUDIO');
}
export function guardInput(input: ExtractRequest) {
  if (
    !(input.kind in ResponseSchemas) ||
    (input.image && input.image.classification !== 'ordinary')
  )
    throw new Failure(400, 'AI_PRIVATE_DOCUMENT');
  if (!input.text && !input.image) throw new Failure(400, 'INVALID_INPUT');
}
export async function preparePhoto(bytes: Buffer) {
  if (bytes.length > 10 * 1024 * 1024) throw new Failure(413, 'INVALID_INPUT');
  try {
    return await sharp(bytes, { limitInputPixels: 40000000 })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg()
      .toBuffer();
  } catch {
    throw new Failure(400, 'INVALID_INPUT');
  }
}
export function fakeDraft(input: ExtractRequest): Draft {
  guardInput(input);
  const f = <T>(value: T) => ({ value, confident: true });
  if (input.kind === 'identity') return { identity: 'no' };
  if (input.kind === 'receipt')
    return {
      supplier: f('Учебный поставщик'),
      accountId: f(input.context.accounts?.[0]?.id ?? null),
      period: f('2026-09'),
      totalCents: f(123456),
      dueOn: f(CalendarDate.parse('2026-10-25')),
    };
  if (input.kind === 'meter')
    return {
      values: (input.context.meter?.zones ?? ['Основная']).map(() =>
        f(
          `1${input.context.meter?.fractionDigits ? `.${'2'.repeat(input.context.meter.fractionDigits)}` : ''}`,
        ),
      ),
    };
  const title = input.text?.trim() || 'Вымышленный образец';
  if (input.kind === 'auto')
    return title
      .split(/\s+и\s+|,/iu)
      .slice(0, 10)
      .map((text) => {
        const unknown = { value: null, confident: false };
        if (/^купить\s/iu.test(text))
          return {
            kind: 'shopping' as const,
            title: f(text.replace(/^купить\s/iu, '')),
            quantity: unknown,
          };
        if (/^заметка:/iu.test(text))
          return {
            kind: 'note' as const,
            title: f('Заметка'),
            body: f(text.replace(/^заметка:\s*/iu, '')),
          };
        const parsed = parseQuickline(text, {
          now: input.context.now ?? new Date(),
          timeZone: input.context.timeZone,
          members: [],
          objects: [],
        });
        return {
          kind: 'task' as const,
          title: f(parsed.title),
          date: { value: parsed.planOn, confident: !!parsed.planOn },
          time: { value: parsed.planTime, confident: !!parsed.planTime },
          assigneeId: unknown,
          objectId: unknown,
        };
      });
  if (input.kind === 'task')
    return {
      title: f(title),
      date: f(null),
      time: f(null),
      assigneeId: f(null),
      objectId: f(null),
    };
  if (input.kind === 'shopping')
    return title.split(',').map((s) => ({ title: f(s.trim()), quantity: f(null) }));
  return { title: f(title.slice(0, 100)), body: f(title) };
}
export function createProviders(
  config: AiConfig,
  timeout: { speech: number; extraction: number; total?: number } = {
    speech: 60000,
    extraction: 90000,
  },
  prompts: {
    task: string;
    shopping: string;
    note: string;
    meter?: string;
    identity?: string;
    receipt?: string;
  } = {
    task,
    shopping,
    note,
  },
) {
  const rules = { meter, identity, receipt, ...prompts };
  // Прокси применяется только к внешнему разбору; локальная речь остаётся в локальной сети.
  const dispatcher = config.AI_HTTPS_PROXY ? new ProxyAgent(config.AI_HTTPS_PROXY) : undefined;
  async function request(
    url: string,
    init: RequestInit,
    external: boolean,
    ms: number,
    deadline = Date.now() + 120000,
  ): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw unavailable();
        const options = {
          ...init,
          redirect: 'error' as const,
          signal: AbortSignal.timeout(Math.min(ms, remaining)),
        };
        if (external && dispatcher)
          return (await proxyFetch(url, {
            ...options,
            dispatcher,
          } as unknown as ProxyRequestInit)) as unknown as Response;
        return await fetch(url, options);
      } catch {
        if (attempt === 1) throw unavailable();
      }
    }
    throw unavailable();
  }
  const speech: SpeechToText = {
    async health() {
      if (config.AI_STT_PROVIDER === 'fake') return true;
      if (config.AI_STT_PROVIDER !== 'local-stt') return false;
      try {
        const r = await fetch(`${config.AI_STT_URL}/health`, {
          signal: AbortSignal.timeout(3000),
          redirect: 'error',
        });
        return r.ok && z.object({ ok: z.literal(true) }).safeParse(await r.json()).success;
      } catch {
        return false;
      }
    },
    async transcribe(audio) {
      validateAudio(audio);
      if (config.AI_STT_PROVIDER === 'fake')
        return { text: 'Вымышленный образец', durationMs: audio.durationMs };
      if (config.AI_STT_PROVIDER !== 'local-stt') throw unavailable();
      const form = new FormData();
      const ext = audio.mime.includes('ogg')
        ? 'ogg'
        : audio.mime.includes('webm')
          ? 'webm'
          : audio.mime.includes('wav')
            ? 'wav'
            : 'm4a';
      form.set(
        'file',
        new Blob([new Uint8Array(audio.bytes)], { type: audio.mime }),
        `audio.${ext}`,
      );
      const r = await request(
        `${config.AI_STT_URL}/transcribe`,
        { method: 'POST', body: form },
        false,
        timeout.speech,
      );
      if (!r.ok) throw unavailable();
      let body: unknown;
      try {
        body = await r.json();
      } catch {
        throw invalid();
      }
      const parsed = z
        .object({ text: z.string().max(20000), duration: z.number().positive().max(120) })
        .safeParse(body);
      if (!parsed.success) throw invalid();
      return { text: parsed.data.text, durationMs: parsed.data.duration * 1000 };
    },
  };
  const extractor: Extractor = {
    async health() {
      if (config.AI_EXTRACT_PROVIDER === 'fake') return true;
      if (config.AI_EXTRACT_PROVIDER !== 'openai-compatible') return false;
      try {
        const key = (await readFile(config.AI_EXTRACT_KEY_FILE as string, 'utf8')).trim();
        const r = await request(
          config.AI_EXTRACT_MODEL === 'hermes-agent'
            ? new URL('/health', config.AI_EXTRACT_URL).href
            : `${config.AI_EXTRACT_URL}/models`,
          { headers: { authorization: `Bearer ${key}` } },
          true,
          3000,
        );
        if (!r.ok) return false;
        if (config.AI_EXTRACT_MODEL === 'hermes-agent')
          return z
            .object({ ok: z.literal(true), authPresent: z.literal(true) })
            .safeParse(await r.json()).success;
        return true;
      } catch {
        return false;
      }
    },
    async extract(input) {
      const deadline = Math.min(
        input.deadline ?? Infinity,
        Date.now() + Math.min(timeout.total ?? 120000, 120000),
      );
      guardInput(input);
      if (config.AI_EXTRACT_PROVIDER === 'fake') return fakeDraft(input);
      if (config.AI_EXTRACT_PROVIDER !== 'openai-compatible') throw unavailable();
      let key: string;
      try {
        key = (await readFile(config.AI_EXTRACT_KEY_FILE as string, 'utf8')).trim();
      } catch {
        throw unavailable();
      }
      const responseSchema = ResponseSchemas[input.kind];
      const jsonSchema = z.toJSONSchema(responseSchema);
      const content: unknown[] = [
        {
          type: 'text',
          text: JSON.stringify({
            kind: input.kind,
            text: input.text,
            context: requestContext(input),
          }),
        },
      ];
      if (input.image) {
        const image = await preparePhoto(input.image.bytes);
        content.push({
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` },
        });
      }
      const messages: unknown[] = [
        {
          role: 'system',
          content: `${common}\n${input.kind === 'auto' ? [rules.task, rules.shopping, rules.note].join('\n') : rules[input.kind]}\n${JSON.stringify(jsonSchema)}`,
        },
        { role: 'user', content },
      ];
      let structured = true;
      let schemaFailures = 0;
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await request(
          `${config.AI_EXTRACT_URL}/chat/completions`,
          {
            method: 'POST',
            headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              model: config.AI_EXTRACT_MODEL,
              messages,
              ...(structured
                ? {
                    response_format: {
                      type: 'json_schema',
                      json_schema: { name: input.kind, schema: jsonSchema, strict: true },
                    },
                  }
                : {}),
            }),
          },
          true,
          timeout.extraction,
          deadline,
        );
        if (r.status === 400 && structured) {
          structured = false;
          continue;
        }
        if (r.status === 429) throw new Failure(429, 'AI_BUSY');
        if (r.status === 403)
          throw new Failure(
            503,
            'AI_FORBIDDEN',
            'Поставщик ИИ отклонил доступ. Обратитесь к администратору дома.',
          );
        if (r.status === 404)
          throw new Failure(
            503,
            'AI_NOT_FOUND',
            'Модель или адрес службы ИИ не найдены. Обратитесь к администратору дома.',
          );
        if (!r.ok) throw unavailable();
        try {
          const envelope = z
            .object({
              choices: z
                .array(z.object({ message: z.object({ content: z.string().max(100000) }) }))
                .min(1),
            })
            .parse(await r.json());
          const text = envelope.choices[0]?.message.content ?? '';
          const json = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/)?.[0] ?? text;
          return normalizeResponse(JSON.parse(json), input);
        } catch {
          if (++schemaFailures > 1) throw invalid();
          messages.push({
            role: 'user',
            content: 'Неверная схема ответа. Верни JSON точно по указанной схеме.',
          });
        }
      }
      throw invalid();
    },
  };
  return {
    speech,
    extractor,
    async photo(input: ExtractRequest) {
      const deadline = Date.now() + Math.min(timeout.total ?? 120000, 120000);
      const check = IdentityCheck.parse(
        await extractor.extract({ ...input, kind: 'identity', deadline }),
      );
      if (check.identity !== 'no')
        throw new Failure(422, 'AI_PRIVATE_DOCUMENT', 'Документ личности — заполните вручную.');
      return extractor.extract({ ...input, deadline });
    },
    close: async () => {
      await dispatcher?.close();
    },
  };
}
