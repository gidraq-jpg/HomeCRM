// «Устройство» для тестов: клиент HTTP с собственным хранилищем cookie, User-Agent и адресом.
// Запросы идут через app.inject: порты не занимаются.
import type { FastifyInstance } from 'fastify';

export const BASE_URL = 'http://homecrm.test';

export interface SetCookie {
  name: string;
  value: string;
  /** Все атрибуты как есть, с именами в нижнем регистре: httponly, secure, samesite, max-age, path. */
  attributes: Map<string, string | true>;
  raw: string;
}

export interface Reply {
  status: number;
  headers: Record<string, string | string[] | number | undefined>;
  text: string;
  json<T = Record<string, unknown>>(): T;
  setCookies: SetCookie[];
}

export function parseSetCookie(raw: string): SetCookie {
  const [pair = '', ...rest] = raw.split(';').map((part) => part.trim());
  const eq = pair.indexOf('=');
  const attributes = new Map<string, string | true>();
  for (const part of rest) {
    const index = part.indexOf('=');
    if (index < 0) attributes.set(part.toLowerCase(), true);
    else attributes.set(part.slice(0, index).toLowerCase(), part.slice(index + 1));
  }
  return { name: pair.slice(0, eq), value: pair.slice(eq + 1), attributes, raw };
}

export interface RequestOptions {
  json?: unknown;
  headers?: Record<string, string>;
  /** Происхождение запроса. По умолчанию — само приложение; null — без заголовка Origin. */
  origin?: string | null;
  /** Не посылать cookie этого устройства. */
  withoutCookies?: boolean;
}

// У каждого устройства свой адрес из диапазона 198.18.0.0/15 (RFC 2544): ограничения запросов по адресу не
// переходят от теста к тесту. Тесты, которым нужен общий адрес, задают его сами.
let nextAddress = 0;
function uniqueAddress(): string {
  nextAddress++;
  return `198.18.${(nextAddress >> 8) & 255}.${nextAddress & 255}`;
}

export interface DeviceOptions {
  userAgent?: string;
  ip?: string;
  /** Вызывается перед каждым запросом: мир тестов снимает отметки об использованных кодах TOTP. */
  beforeRequest?: (url: string) => Promise<void>;
}

export class Device {
  readonly cookies = new Map<string, string>();
  userAgent: string;
  ip: string;
  private readonly app: FastifyInstance;
  private readonly beforeRequest: ((url: string) => Promise<void>) | undefined;

  constructor(app: FastifyInstance, options: DeviceOptions = {}) {
    this.app = app;
    this.beforeRequest = options.beforeRequest;
    this.userAgent = options.userAgent ?? 'TestBrowser/1.0';
    this.ip = options.ip ?? uniqueAddress();
  }

  async request(method: 'GET' | 'POST', url: string, options: RequestOptions = {}): Promise<Reply> {
    await this.beforeRequest?.(url);
    const headers: Record<string, string> = {
      'user-agent': this.userAgent,
      ...(options.origin === null ? {} : { origin: options.origin ?? BASE_URL }),
      ...options.headers,
    };
    if (!options.withoutCookies && this.cookies.size > 0) {
      headers.cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }
    if (options.json !== undefined) headers['content-type'] = 'application/json';
    const response = await this.app.inject({
      method,
      url,
      headers,
      remoteAddress: this.ip,
      ...(options.json !== undefined ? { payload: JSON.stringify(options.json) } : {}),
    });
    const setCookies = response.cookies.length === 0 ? [] : this.rawSetCookies(response.headers);
    for (const cookie of setCookies) this.store(cookie);
    return {
      status: response.statusCode,
      headers: response.headers,
      text: response.body,
      json: <T>() => JSON.parse(response.body) as T,
      setCookies,
    };
  }

  get(url: string, options?: RequestOptions): Promise<Reply> {
    return this.request('GET', url, options);
  }

  post(url: string, json?: unknown, options: RequestOptions = {}): Promise<Reply> {
    return this.request('POST', url, { ...options, ...(json !== undefined ? { json } : {}) });
  }

  /** Вход по имени пользователя. */
  signIn(username: string, password: string): Promise<Reply> {
    return this.post('/api/auth/sign-in/username', { username, password });
  }

  private rawSetCookies(headers: Reply['headers']): SetCookie[] {
    const value = headers['set-cookie'];
    const list = value === undefined ? [] : Array.isArray(value) ? value : [String(value)];
    return list.map(parseSetCookie);
  }

  private store(cookie: SetCookie): void {
    const maxAge = cookie.attributes.get('max-age');
    if (cookie.value === '' || maxAge === '0') this.cookies.delete(cookie.name);
    else this.cookies.set(cookie.name, cookie.value);
  }
}
