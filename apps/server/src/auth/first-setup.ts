// Первая настройка (SPACE-2, сценарий S1): администратор и дом в одной транзакции. Вызывается
// командой deploy/scripts/first-setup.ts; пароль в базу попадает только хэшем и нигде не хранится.
import { type Database, sql } from '@homecrm/db';
import {
  isValidUsername,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX,
  USERNAME_MIN,
} from './identity.ts';
import { hashPassword } from './password.ts';
import { insertAccount } from './provision.ts';

export interface FirstSetupInput {
  householdName: string;
  username: string;
  displayName: string;
  password: string;
  /** Настоящий адрес администратора; нужен для восстановления по почте, когда она настроена. */
  email?: string | undefined;
}

export class FirstSetupError extends Error {
  readonly code: 'ALREADY_SET_UP' | 'INVALID_INPUT';
  constructor(code: FirstSetupError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

/** Ключ рекомендательной блокировки: две одновременные первые настройки не создадут двух администраторов. */
const SETUP_LOCK_KEY = 8_310_001;

/** Разбор введённого; возвращает текст ошибки по-русски или null. Самого пароля в тексте нет. */
export function validateFirstSetup(input: FirstSetupInput): string | null {
  if (input.householdName.trim() === '') return 'Название дома не должно быть пустым.';
  if (input.displayName.trim() === '') return 'Имя не должно быть пустым.';
  if (
    input.username.length < USERNAME_MIN ||
    input.username.length > USERNAME_MAX ||
    !isValidUsername(input.username)
  ) {
    return `Логин: от ${USERNAME_MIN} до ${USERNAME_MAX} символов, буквы, цифры, точка, дефис и подчёркивание.`;
  }
  if (input.password.length < PASSWORD_MIN_LENGTH || input.password.length > PASSWORD_MAX_LENGTH) {
    return `Пароль: от ${PASSWORD_MIN_LENGTH} до ${PASSWORD_MAX_LENGTH} символов.`;
  }
  return null;
}

/**
 * Создаёт дом и его первого администратора. Работает, только пока в базе нет ни одной учётной
 * записи: потом участников добавляют приглашения. Политики базы это дополнительно держат:
 * первым участником пустого дома может стать только администратор (миграция 0004).
 */
export async function runFirstSetup(
  db: Database,
  input: FirstSetupInput,
): Promise<{ accountId: string; householdId: string }> {
  const problem = validateFirstSetup(input);
  if (problem !== null) throw new FirstSetupError('INVALID_INPUT', problem);
  // Хэш считается до транзакции: 64 МиБ и десятки миллисекунд не держат блокировку.
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SETUP_LOCK_KEY})`);
    const existing = await tx.execute<{ found: boolean }>(
      sql`SELECT EXISTS (SELECT 1 FROM accounts) AS found`,
    );
    if (existing.rows[0]?.found === true) {
      throw new FirstSetupError(
        'ALREADY_SET_UP',
        'Первая настройка уже выполнена: в базе есть учётные записи. Новых участников добавляют приглашения.',
      );
    }
    const house = await tx.execute<{ id: string }>(
      sql`INSERT INTO spaces (kind, name) VALUES ('household', ${input.householdName.trim()}) RETURNING id`,
    );
    const householdId = house.rows[0]?.id;
    if (householdId === undefined) throw new Error('First setup: the household was not created');
    const account = await insertAccount(tx, {
      username: input.username,
      displayName: input.displayName.trim(),
      passwordHash,
      email: input.email,
      householdId,
      role: 'admin',
    });
    return { accountId: account.id, householdId };
  });
}
