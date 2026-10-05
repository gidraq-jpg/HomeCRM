// SQL-двойник правил доступа из packages/shared/src/access.ts (ADR-0004).
// Каждая функция повторяет одноимённую функцию эталона в виде условия политики RLS.
// Матрица доступа (access-matrix.test.ts) сверяет ответы базы с эталоном на всех сочетаниях.
//
// Условия написаны для строки таблицы с общими полями доступа: space_id, space_kind, audience,
// author_id, assignee_id, deleted_at. Подзапросы не ссылаются на строку, поэтому PostgreSQL
// вычисляет каждый один раз на запрос, а не на каждую строку.
import { ROLES, type Role } from '@homecrm/shared';

export const RECORD_TYPES = ['note', 'shopping_item', 'task'] as const;
/** Вид записи из RecordFacts.type: у каждой таблицы-примера он свой. */
export type RecordType = (typeof RECORD_TYPES)[number];

/** Сколько запись лежит в корзине до окончательного удаления (PRD, DATA-1). */
export const TRASH_RETENTION = '30 days';

/** Учётная запись текущей транзакции: её задаёт withAccount, без контекста — NULL. */
export const CURRENT_ACCOUNT_SQL = 'app.current_account_id()';
const ME = CURRENT_ACCOUNT_SQL;

const ADULT_ROLES: readonly Role[] = ['admin', 'adult'];

const list = (roles: readonly Role[]): string => roles.map((role) => `'${role}'`).join(', ');

/** Общие пространства, где текущая учётная запись — участник с одной из ролей. */
const housesWhere = (roles: readonly Role[]): string =>
  `(SELECT m.space_id FROM space_members m WHERE m.account_id = ${ME} AND m.role IN (${list(roles)}))`;

/** Личное пространство текущей учётной записи. */
const MY_PERSONAL_SPACE = `(SELECT s.id FROM spaces s WHERE s.owner_account_id = ${ME})`;

/** canView: личное видит только владелец; «Вся семья» — участники дома; «Взрослые» — взрослые. */
export function canViewSql(): string {
  return `(
    (space_kind = 'personal' AND space_id IN ${MY_PERSONAL_SPACE})
    OR (space_kind = 'household' AND (
      space_id IN ${housesWhere(ADULT_ROLES)}
      OR (audience = 'household' AND space_id IN ${housesWhere(ROLES)})
    ))
  )`;
}

/** canWrite: видит и (личное, или не ребёнок, или ребёнку можно этот вид записи). */
export function canWriteSql(type: RecordType): string {
  // Ребёнок в общем пишет только покупки и дела, назначенные ему.
  if (type === 'shopping_item') return canViewSql();
  const notChild = `space_kind = 'personal' OR space_id IN ${housesWhere(ADULT_ROLES)}`;
  const childMayWrite = type === 'task' ? `\n    OR assignee_id = ${ME}` : '';
  return `(${canViewSql()} AND (
    ${notChild}${childMayWrite}
  ))`;
}

/** canTrash: видит и (личное или взрослый в доме). */
export function canTrashSql(): string {
  return `(${canViewSql()} AND (
    space_kind = 'personal' OR space_id IN ${housesWhere(ADULT_ROLES)}
  ))`;
}

/** canRestore: видит и (личное, или администратор, или взрослый — автор записи). */
export function canRestoreSql(): string {
  return `(${canViewSql()} AND (
    space_kind = 'personal'
    OR space_id IN ${housesWhere(['admin'])}
    OR (space_id IN ${housesWhere(['adult'])} AND author_id = ${ME})
  ))`;
}

/**
 * Условия политик таблицы-примера для роли приложения.
 * Корзина и восстановление — это UPDATE поля deleted_at, поэтому у UPDATE два случая:
 * старая строка живая — нужно canWrite, в корзине — canRestore;
 * новая строка живая — canWrite, в корзине — canTrash.
 * Физическое удаление приложению не выдано вовсе: очистку корзины делает обработчик.
 * Время в deleted_at ставит база (триггер app.guard_trash_time, миграция 0003): иначе
 * прошедшая дата сразу отдала бы запись обработчику в обход 30 дней корзины.
 */
export function recordPolicySql(type: RecordType): {
  select: string;
  insert: string;
  updateUsing: string;
  updateCheck: string;
} {
  const live = 'deleted_at IS NULL';
  const trashed = 'deleted_at IS NOT NULL';
  return {
    select: canViewSql(),
    insert: `${live} AND ${canWriteSql(type)}`,
    updateUsing: `(${live} AND ${canWriteSql(type)}) OR (${trashed} AND ${canRestoreSql()})`,
    updateCheck: `(${live} AND ${canWriteSql(type)}) OR (${trashed} AND ${canTrashSql()})`,
  };
}

/**
 * Узкая политика обработчика: только записи, пролежавшие в корзине дольше срока хранения.
 * Дате можно верить: её ставит база, а не приложение.
 */
export const EXPIRED_TRASH_SQL = `deleted_at < now() - interval '${TRASH_RETENTION}'`;

// Правила входа (ADR-0005): двойники canInvite, canResetPassword и canViewAccountJournal из access.ts.
// Их сверяет identity-matrix.test.ts.

/** Приглашение живёт 72 часа (PRD, AUTH-2); срок проверяет и CHECK таблицы invitations. */
export const INVITATION_TTL = '72 hours';

/** Строка привязана к учётной записи текущей транзакции: журнал входов и отметка о сбросе — только свои. */
export function ownAccountSql(column = 'account_id'): string {
  return `${column} = ${ME}`;
}

/** canInvite: приглашение в дом, где текущая учётная запись — администратор. Для строки с household_id. */
export function canInviteSql(): string {
  return `household_id IN ${housesWhere(['admin'])}`;
}

/**
 * canResetPassword для строки password_resets: requested_by — администратор дома, где account_id — ребёнок,
 * и account_id нигде не взрослый и не администратор. Службе входа контекст пользователя не задаётся,
 * поэтому условие смотрит на requested_by в самой строке, а не на current_account_id().
 * Имена колонок строки квалифицированы: в подзапросах у space_members есть свои account_id.
 */
export function canResetPasswordSql(): string {
  return `(
    password_resets.requested_by <> password_resets.account_id
    AND EXISTS (
      SELECT 1 FROM space_members admin_m
      JOIN space_members child_m ON child_m.space_id = admin_m.space_id
      WHERE admin_m.account_id = password_resets.requested_by AND admin_m.role = 'admin'
        AND child_m.account_id = password_resets.account_id AND child_m.role = 'child'
    )
    AND NOT EXISTS (
      SELECT 1 FROM space_members other
      WHERE other.account_id = password_resets.account_id AND other.role <> 'child'
    )
  )`;
}
