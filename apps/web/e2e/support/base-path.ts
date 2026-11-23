import { env } from 'node:process';

// Подпапка, из которой сквозные тесты открывают собранный клиент: так проверяется, что сборка
// не привязана к корню сайта (WEB_BASE в vite.config.ts) и абсолютный путь «/assets/…» не прячется.
export const E2E_PREFIX = env.E2E_PREFIX ?? '/homecrm/app/v1/';
