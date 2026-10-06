// Создание учётной записи службой входа (роль homecrm_auth): одна транзакция — учётная запись,
// пароль, личное пространство (SPACE-1) и членство в доме с ролью. Если что-то не получилось,
// не остаётся ничего: ни записи без пространства, ни израсходованного приглашения.
import { randomUUID } from 'node:crypto';
import {
  accounts,
  and,
  credentials,
  type Database,
  eq,
  isNull,
  spaceMembers,
  spaces,
  type Transaction,
} from '@homecrm/db';
import type { Role, Viewer } from '@homecrm/shared';
import {
  normalizeUsername,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  placeholderEmail,
} from './identity.ts';
import { hashPassword } from './password.ts';

export interface NewAccount {
  /** Имя для входа, как ввели; в базе — в нормализованном виде. */
  username: string;
  displayName: string;
  /** Хэш Argon2id: считается до транзакции, чтобы не держать её открытой. */
  passwordHash: string;
  /** Настоящий адрес; у ребёнка его нет — тогда служебный (identity.ts). */
  email?: string | undefined;
  householdId: string;
  role: Role;
}

export interface CreatedAccount {
  id: string;
  personalSpaceId: string;
}

/** Разбор ошибки PostgreSQL, в том числе обёрнутой Drizzle: код SQLSTATE и имя ограничения. */
export function pgError(error: unknown): { code?: string; constraint?: string } {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const { code, constraint, cause } = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (typeof code === 'string') {
      return { code, ...(typeof constraint === 'string' ? { constraint } : {}) };
    }
    current = cause;
  }
  return {};
}

/** Записывает учётную запись внутри чужой транзакции: вызывающий сам решает, что ещё должно в ней уместиться. */
export async function insertAccount(tx: Transaction, input: NewAccount): Promise<CreatedAccount> {
  const [account] = await tx
    .insert(accounts)
    .values({
      displayName: input.displayName,
      email: input.email?.toLowerCase() ?? placeholderEmail(randomUUID()),
      username: normalizeUsername(input.username),
      displayUsername: input.username,
    })
    .returning({ id: accounts.id });
  if (account === undefined) throw new Error('insertAccount: no row returned');

  // Так библиотека хранит пароль: способ входа credential, accountId равен id учётной записи.
  await tx.insert(credentials).values({
    userId: account.id,
    accountId: account.id,
    providerId: 'credential',
    password: input.passwordHash,
  });
  const [space] = await tx
    .insert(spaces)
    .values({ kind: 'personal', name: `Личное: ${input.displayName}`, ownerAccountId: account.id })
    .returning({ id: spaces.id });
  if (space === undefined) throw new Error('insertAccount: no personal space returned');
  await tx
    .insert(spaceMembers)
    .values({ spaceId: input.householdId, accountId: account.id, role: input.role });
  return { id: account.id, personalSpaceId: space.id };
}

/**
 * Создаёт участника без приглашения: первый администратор при первой настройке (SPACE-2) и
 * вымышленная семья в тестах. Тот же путь, что у приглашения: insertAccount в одной транзакции.
 */
export async function provisionAccount(
  db: Database,
  input: Omit<NewAccount, 'passwordHash'> & { password: string },
): Promise<CreatedAccount> {
  const { password, ...rest } = input;
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new RangeError(
      `Password must be ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters`,
    );
  }
  const passwordHash = await hashPassword(password);
  return db.transaction((tx) => insertAccount(tx, { ...rest, passwordHash }));
}

/** Общее пространство дома: его создаёт администратор при первой настройке (SPACE-2). */
export async function createHousehold(db: Database, name: string): Promise<string> {
  const [house] = await db
    .insert(spaces)
    .values({ kind: 'household', name })
    .returning({ id: spaces.id });
  if (house === undefined) throw new Error('createHousehold: no row returned');
  return house.id;
}

/** Участник глазами эталона access.ts: id и роли во всех домах, где он действующий участник (не ушёл и не исключён). */
export async function loadViewer(db: Database | Transaction, accountId: string): Promise<Viewer> {
  const rows = await db
    .select({ spaceId: spaceMembers.spaceId, role: spaceMembers.role })
    .from(spaceMembers)
    .where(and(eq(spaceMembers.accountId, accountId), isNull(spaceMembers.leftAt)));
  return { accountId, memberships: new Map(rows.map((row) => [row.spaceId, row.role])) };
}
