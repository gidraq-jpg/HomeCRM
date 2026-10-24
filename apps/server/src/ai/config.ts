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
export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const result = Schema.safeParse(env);
  if (!result.success) throw new Error('Invalid AI configuration');
  return result.data;
}
