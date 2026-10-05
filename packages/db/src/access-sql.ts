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

/** Узкая политика обработчика: только записи, пролежавшие в корзине дольше срока хранения. */
export const EXPIRED_TRASH_SQL = `deleted_at < now() - interval '${TRASH_RETENTION}'`;
