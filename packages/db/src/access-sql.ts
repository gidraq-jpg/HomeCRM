// SQL-двойник правил доступа из packages/shared/src/access.ts (ADR-0004).
// Каждая функция повторяет одноимённую функцию эталона в виде условия политики RLS.
// Матрица доступа (access-matrix.test.ts) сверяет ответы базы с эталоном на всех сочетаниях.
//
// Условия написаны для строки таблицы с общими полями доступа: space_id, space_kind, audience,
// author_id, assignee_id, deleted_at. Подзапросы не ссылаются на строку, поэтому PostgreSQL
// вычисляет каждый один раз на запрос, а не на каждую строку.
import { ROLES, type Role } from '@homecrm/shared';

export const RECORD_TYPES = [
  'note',
  'note_item',
  'shopping_item',
  'task',
  'object',
  'object_field',
  'object_event',
  'note_file',
  'object_file',
  'contact',
  'utility_account',
  'meter',
  'meter_reading',
  'utility_charge',
  'utility_payment',
] as const;
/** Вид записи из RecordFacts.type: у каждой таблицы-примера он свой. */
export type RecordType = (typeof RECORD_TYPES)[number];

/** Сколько запись лежит в корзине до окончательного удаления (PRD, DATA-1). */
export const TRASH_RETENTION = '30 days';

/** Учётная запись текущей транзакции: её задаёт withAccount, без контекста — NULL. */
export const CURRENT_ACCOUNT_SQL = 'app.current_account_id()';
const ME = CURRENT_ACCOUNT_SQL;

const ADULT_ROLES: readonly Role[] = ['admin', 'adult'];

const list = (roles: readonly Role[]): string => roles.map((role) => `'${role}'`).join(', ');

/**
 * Общие пространства, где текущая учётная запись — действующий участник с одной из ролей.
 * Вышедший из дома или исключённый (left_at) доступ к нему теряет сразу (SPACE-8, SPACE-9).
 */
const housesWhere = (roles: readonly Role[]): string =>
  `(SELECT m.space_id FROM space_members m WHERE m.account_id = ${ME} AND m.left_at IS NULL AND m.role IN (${list(roles)}))`;

/** Личное пространство текущей учётной записи. */
const MY_PERSONAL_SPACE = `(SELECT s.id FROM spaces s WHERE s.owner_account_id = ${ME})`;

/** DATA-2: SQL-двойники прав запуска экспорта; имена колонок задаёт только код. */
export function canExportHouseSql(spaceId = 'space_id'): string {
  return `${spaceId} IN ${housesWhere(['admin'])}`;
}
export function canExportPersonalSql(ownerId = 'owner_account_id'): string {
  return `${ownerId} = ${ME}`;
}

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
 * Условия политик таблицы записей для роли приложения.
 * Создание — canCreate: автор — текущий участник, запись не в корзине.
 * Корзина и восстановление — это UPDATE поля deleted_at, поэтому у UPDATE два случая:
 * старая строка живая — нужно canWrite, в корзине — canRestore;
 * новая строка живая — canWrite, в корзине — canTrash.
 * Правку и перенос записи, остающейся в корзине, политика не видит (WITH CHECK не знает старой
 * строки): их запрещает триггер `<таблица>_guard` (миграция 0002), а права на колонки не дают
 * менять автора, id и время создания.
 * Физическое удаление приложению не выдано вовсе: очистку корзины делает обработчик.
 * Время в deleted_at ставит база (триггер `<таблица>_trash_time`): иначе прошедшая дата сразу
 * отдала бы запись обработчику в обход 30 дней корзины.
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
    insert: `${live} AND author_id = ${ME} AND ${canWriteSql(type)}`,
    updateUsing: `(${live} AND ${canWriteSql(type)}) OR (${trashed} AND ${canRestoreSql()})${['note_item', 'object_field', 'object_event', 'note_file', 'object_file', 'utility_account', 'meter', 'meter_reading', 'utility_charge', 'utility_payment'].includes(type) ? ` OR (${trashed} AND pg_trigger_depth() > 0 AND ${canWriteSql(type)})` : ''}`,
    updateCheck: `(${live} AND ${canWriteSql(type)}) OR (${trashed} AND ${canTrashSql()})`,
  };
}

/**
 * Узкая политика обработчика: только записи, пролежавшие в корзине дольше срока хранения.
 * Дате можно верить: её ставит база, а не приложение.
 */
export const EXPIRED_TRASH_SQL = `deleted_at < now() - interval '${TRASH_RETENTION}'`;

/**
 * Ответственный за запись ушёл из дома (PRD 7.3.12): обработчик передаёт её администратору.
 * Условия квалифицированы именем таблицы: в подзапросах у space_members есть свои space_id.
 */
export function leftAssigneeSql(table: string): string {
  return `${table}.space_kind = 'household' AND ${table}.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM space_members l
    WHERE l.space_id = ${table}.space_id AND l.account_id = ${table}.assignee_id AND l.left_at IS NOT NULL
  )`;
}

/**
 * Что обработчик вправе видеть при передаче записей: строки с ушедшим ответственным и те, что уже
 * переданы администратору. Вторая часть нужна самой передаче: PostgreSQL проверяет по политикам
 * чтения и новую строку после UPDATE.
 */
export function reassignSelectSql(table: string): string {
  return `(${leftAssigneeSql(table)}) OR (${table}.space_kind = 'household' AND ${table}.deleted_at IS NULL AND ${adminAssigneeSql(table)})`;
}

/** Новый ответственный — действующий администратор того же дома. */
export function adminAssigneeSql(table: string): string {
  return `EXISTS (
    SELECT 1 FROM space_members a
    WHERE a.space_id = ${table}.space_id AND a.account_id = ${table}.assignee_id
      AND a.role = 'admin' AND a.left_at IS NULL
  )`;
}

/**
 * История изменений пишется только триггером записи (OBJ-6): прямая вставка проходит лишь изнутри
 * триггера (`pg_trigger_depth() > 0`). Автор события — участник, от чьего имени идёт запрос.
 */
export const HISTORY_APP_INSERT_SQL = `pg_trigger_depth() > 0 AND actor_id IS NOT DISTINCT FROM ${ME}`;
/**
 * Чтение истории: событие видно, если видно его место (оно записано в момент события и не меняется)
 * И видна сама запись сейчас — подзапрос идёт под политикой чтения таблицы записей. Расширили
 * аудиторию или перенесли запись — прошлое видят только те, кто видел его тогда.
 */
export function historySelectSql(table: string): string {
  return `${canViewSql()} AND EXISTS (SELECT 1 FROM ${table} r WHERE r.id = ${table}_history.record_id)`;
}

/** То же для обработчика, который передаёт записи ушедшего администратору: события — «от системы». */
export const HISTORY_WORKER_INSERT_SQL = 'pg_trigger_depth() > 0 AND actor_id IS NULL';

// Состав дома читается через индекс своих действующих членств, без рекурсии space_members.

/** canViewSpace: своё личное пространство и дома, где он действующий участник. */
export const SPACES_SELECT_SQL = `owner_account_id = ${ME} OR id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = ${ME} AND m.left_at IS NULL)`;
/** canViewMembership: собственные членства и состав своего действующего дома, включая бывших. */
export const MEMBERS_SELECT_SQL = `account_id = ${ME} OR space_id IN (SELECT space_id FROM household_access WHERE account_id = ${ME})`;
/** canViewProfile: только семейные поля отдельной таблицы; accounts сохраняет собственную RLS. */
export const PROFILES_SELECT_SQL = `account_id = ${ME} OR EXISTS (
  SELECT 1 FROM space_members m WHERE m.account_id = member_profiles.account_id AND m.left_at IS NULL
    AND m.space_id IN (SELECT space_id FROM household_access WHERE account_id = ${ME})
)`;
/** Действующий администратор своего дома; завершённое членство менять нельзя. */
export const MEMBERS_APP_ADMIN_SQL = `left_at IS NULL AND space_id IN (
  SELECT space_id FROM household_access WHERE account_id = ${ME} AND role = 'admin'
)`;
/** canViewAccount: только своя учётная запись. */
export const ACCOUNTS_SELECT_SQL = `id = ${ME}`;

/**
 * Уход из дома и исключение (SPACE-8, SPACE-9) записывает служба входа: left_by — кто это сделал.
 * Участник уходит сам (left_by = он сам) или его исключает администратор этого дома. Последнего
 * администратора не отпускает триггер `space_members_guard`.
 */
export const MEMBER_LEAVE_CHECK_SQL = `left_at IS NOT NULL AND (
    left_by = account_id
    OR EXISTS (
      SELECT 1 FROM space_members a
      WHERE a.space_id = space_members.space_id AND a.account_id = space_members.left_by
        AND a.role = 'admin' AND a.left_at IS NULL
    )
  )`;

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
 * Учитываются только действующие участники: ушедший взрослый ребёнка «взрослым» не делает.
 */
export function canResetPasswordSql(): string {
  return `(
    password_resets.requested_by <> password_resets.account_id
    AND EXISTS (
      SELECT 1 FROM space_members admin_m
      JOIN space_members child_m ON child_m.space_id = admin_m.space_id
      WHERE admin_m.account_id = password_resets.requested_by AND admin_m.role = 'admin'
        AND admin_m.left_at IS NULL
        AND child_m.account_id = password_resets.account_id AND child_m.role = 'child'
        AND child_m.left_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM space_members other
      WHERE other.account_id = password_resets.account_id AND other.role <> 'child'
        AND other.left_at IS NULL
    )
  )`;
}
