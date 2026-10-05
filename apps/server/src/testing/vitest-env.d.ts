// Тесты сервера получают подключение к одноразовой PostgreSQL из общей подготовки пакета db
// (packages/db/src/testing/global-setup.ts) через inject('pgAdminUrl').
import 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Подключение суперпользователя к одноразовому серверу PostgreSQL. */
    pgAdminUrl: string;
  }
}
