import * as z from 'zod';

export const Me = z.object({
  id: z.string(),
  /** Личное пространство участника: туда кладётся личная запись, когда нужен явный placement. */
  personalSpaceId: z.string().nullable(),
  displayName: z.string(),
  username: z.string().nullable(),
  email: z.string().nullable(),
  twoFactorEnabled: z.boolean(),
  secondFactorRequired: z.boolean(),
  roles: z.array(z.object({ householdId: z.string(), role: z.enum(['admin', 'adult', 'child']) })),
  /** Часовой пояс дома (IANA): в нём показываются даты. */
  timeZone: z.string(),
  passwordReset: z.object({ completedAt: z.string(), ackAllowedAt: z.string() }).nullable(),
});
export type Me = z.infer<typeof Me>;
export const SignIn = z.object({
  twoFactorRedirect: z.boolean().optional(),
  trustDeviceAllowed: z.boolean().optional(),
});
export const Enrollment = z.object({ totpURI: z.string(), backupCodes: z.array(z.string()) });
export const BackupCodes = z.object({ backupCodes: z.array(z.string()) });
export const Sessions = z.array(
  z.object({
    id: z.string(),
    token: z.string(),
    userAgent: z.string().nullable(),
    ipAddress: z.string().nullable(),
    createdAt: z.string(),
    expiresAt: z.string(),
  }),
);
export const Events = z.array(
  z.object({
    kind: z.enum(['sign_in', 'second_factor', 'password_reset']),
    outcome: z.enum(['success', 'failure', 'locked', 'second_factor_required']),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    createdAt: z.string(),
  }),
);
const Failure = z.object({ code: z.string().optional() });

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter: number;
  constructor(status: number, code = '', retryAfter = 0) {
    super('Request failed');
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export type ApiMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** Только cookie; тело и ответы не попадают в localStorage, Cache API или журнал. */
export async function apiRequest<T>(
  method: ApiMethod,
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK');
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = Failure.safeParse(json);
    const seconds = Number(response.headers.get('retry-after'));
    throw new ApiError(
      response.status,
      failure.success ? failure.data.code : '',
      Number.isFinite(seconds) ? Math.max(0, seconds) : 0,
    );
  }
  const result = schema.safeParse(json);
  if (!result.success) throw new ApiError(502, 'INVALID_RESPONSE');
  return result.data;
}

/** GET без тела, POST — с телом: так устроены маршруты входа. */
export function api<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return apiRequest(body === undefined ? 'GET' : 'POST', path, schema, body, signal);
}
export function action(path: string, body: unknown = {}) {
  return api(path, z.unknown(), body);
}
export function isAdmin(me: Me): boolean {
  return me.roles.some(({ role }) => role === 'admin');
}

/** Не показываем технические сообщения сервера: они могут содержать детали запроса. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Не удалось выполнить действие. Попробуйте ещё раз.';
  if (error.status === 429) {
    const minutes = Math.max(1, Math.ceil((error.retryAfter || 900) / 60));
    return `Слишком много попыток. Вход временно заблокирован. Повторите через ${minutes} мин.`;
  }
  if (error.status === 0)
    return 'Не удалось связаться с сервером. Проверьте подключение и повторите.';
  if (/INVITATION_(USED|EXPIRED|REVOKED|NOT_FOUND)/.test(error.code))
    return 'Приглашение недействительно. Попросите администратора прислать новую ссылку.';
  if (error.code === 'RESET_PASSWORD_DISABLED')
    return 'Восстановление по почте на сервере не настроено.';
  if (error.code === 'PASSWORD_MISMATCH') return 'Пароли отличаются. Введите их одинаково.';
  if (/TOKEN/.test(error.code))
    return 'Ссылка недействительна или уже использована. Запросите новую.';
  if (/USERNAME_ALREADY_TAKEN/.test(error.code)) return 'Это имя пользователя уже занято.';
  if (/EMAIL_ALREADY_TAKEN/.test(error.code)) return 'Этот адрес почты уже используется.';
  if (/PASSWORD_TOO_SHORT/.test(error.code)) return 'Пароль должен содержать не менее 10 символов.';
  if (/TOTP|BACKUP_CODE|INVALID_CODE/.test(error.code))
    return 'Код неверный или уже использован. Введите новый код.';
  if (/TWO_FACTOR|SECOND_FACTOR|VERIFICATION/.test(error.code))
    return 'Вход с кодом истёк. Введите имя и пароль заново.';
  if (error.status === 401 || /INVALID_(EMAIL|USERNAME)/.test(error.code))
    return 'Проверьте имя или почту и пароль.';
  if (/PASSWORD/.test(error.code)) return 'Пароль неверный. Попробуйте ещё раз.';
  if (error.status === 403) return 'Это действие недоступно. Проверьте вход и повторите.';
  return 'Не удалось выполнить действие. Попробуйте ещё раз.';
}
export function loginBody(login: string, password: string) {
  const value = login.trim();
  return value.includes('@')
    ? { path: 'auth/sign-in/email', body: { email: value, password } }
    : { path: 'auth/sign-in/username', body: { username: value, password } };
}
export function appURL(hash: string): string {
  return new URL(`${import.meta.env.BASE_URL}#${hash}`, window.location.origin).href;
}

/** Ссылки сервера без hash тоже работают. Токен удаляется из адреса и остаётся в памяти. */
export function consumeLink(url: URL) {
  const invitation = /\/invite\/([^/]+)\/?$/.exec(url.pathname);
  let hash: URL;
  try {
    hash = new URL(url.hash.slice(1) || '/', url.origin);
  } catch {
    return null;
  }
  const inviteHash = /^\/invite\/([^/]+)$/.exec(hash.pathname);
  const reset = /\/reset-password\/?$/.test(url.pathname) || hash.pathname === '/reset-password';
  if (invitation || inviteHash)
    return {
      kind: 'invite' as const,
      token: decodeLinkToken((invitation || inviteHash)?.[1] ?? ''),
    };
  if (reset || url.searchParams.has('token') || url.searchParams.has('error'))
    return {
      kind: 'reset' as const,
      token: url.searchParams.get('token') ?? hash.searchParams.get('token'),
    };
  return null;
}

function decodeLinkToken(value: string): string | null {
  try {
    const result = z
      .string()
      .max(256)
      .regex(/^[A-Za-z0-9_-]+$/)
      .safeParse(decodeURIComponent(value));
    return result.success ? result.data : null;
  } catch {
    // Испорченная ссылка — штатная ошибка экрана приглашения, а не исключение приложения.
    return null;
  }
}
