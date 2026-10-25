import { createHash } from 'node:crypto';
import { z } from 'zod';

const http = z.url().refine((v) => URL.canParse(v) && /^https?:$/.test(new URL(v).protocol));
const optional = <T extends z.ZodType>(s: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), s.optional());
const Schema = z
  .object({
    AI_STT_PROVIDER: z.enum(['disabled', 'fake', 'local-stt']).default('disabled'),
    AI_STT_URL: optional(http),
    AI_EXTRACT_PROVIDER: z.enum(['disabled', 'fake', 'openai-compatible']).default('disabled'),
    AI_EXTRACT_URL: optional(http),
    AI_EXTRACT_KEY_FILE: optional(z.string().min(1)),
    AI_EXTRACT_MODEL: z.string().min(1).default('hermes-agent'),
    AI_HTTPS_PROXY: optional(http),
    AI_DAILY_LIMIT: z.coerce.number().int().min(1).max(10000).default(100),
  })
  .superRefine((c, ctx) => {
    if (
      (c.AI_STT_PROVIDER === 'local-stt' && !c.AI_STT_URL) ||
      (c.AI_EXTRACT_PROVIDER === 'openai-compatible' &&
        (!c.AI_EXTRACT_URL || !c.AI_EXTRACT_KEY_FILE))
    )
      ctx.addIssue({ code: 'custom', message: 'Incomplete AI configuration' });
  });
export type AiConfig = z.infer<typeof Schema>;
export function aiProvider(ai: AiConfig) {
  const version = createHash('sha256')
    .update(JSON.stringify([ai.AI_EXTRACT_PROVIDER, ai.AI_EXTRACT_URL, ai.AI_EXTRACT_MODEL]))
    .digest('hex')
    .slice(0, 16);
  const supplier =
    ai.AI_EXTRACT_PROVIDER === 'fake'
      ? 'Учебный поставщик'
      : ai.AI_EXTRACT_MODEL === 'hermes-agent'
        ? 'Hermes → OpenAI'
        : 'Совместимый поставщик';
  return `${supplier}:${version}`;
}
export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const result = Schema.safeParse(env);
  if (!result.success) throw new Error('Invalid AI configuration');
  return result.data;
}
