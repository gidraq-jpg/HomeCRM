// Модуль входа: что получают маршруты всех модулей. Без маршрутов.
import type { AppDatabase, Database } from '@homecrm/db';
import { type Auth, type AuthOptions, createAuth } from './auth.ts';

export interface AuthModule {
  auth: Auth;
  /** Служба входа: роль homecrm_auth. */
  db: Database;
  /** Приложение: роль homecrm_app. */
  appDb: AppDatabase;
  baseURL: string;
  /** Откуда принимаются изменяющие запросы с cookie. */
  origins: ReadonlySet<string>;
  /** Часовой пояс дома (IANA): клиент показывает даты в нём. */
  homeTimeZone: string;
}

/** Сколько дней после сброса отметку не может закрыть никто (AUTH-5, решение владельца 6 октября). */
export const RESET_NOTICE_LOCK_DAYS = 7;
const DEFAULT_HOME_TIME_ZONE = 'Asia/Yekaterinburg';

export function createAuthModule(options: AuthOptions): AuthModule {
  const origin = new URL(options.baseURL).origin;
  return {
    auth: createAuth(options),
    db: options.db,
    appDb: options.appDb,
    baseURL: origin,
    origins: new Set([origin, ...(options.trustedOrigins ?? [])]),
    homeTimeZone: options.homeTimeZone ?? DEFAULT_HOME_TIME_ZONE,
  };
}
