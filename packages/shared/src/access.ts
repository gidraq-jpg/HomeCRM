// Правила доступа «личное и общее» — PRD, разделы 6.2 и 7.3 (SPACE-3, SPACE-4).
// Это эталон: политики RLS в базе и проверки на сервере обязаны давать тот же ответ,
// а матрица доступа в CI сравнивает их с этим модулем.

export const ROLES = ['admin', 'adult', 'child'] as const;
export type Role = (typeof ROLES)[number];

export const AUDIENCES = ['household', 'adults'] as const;
export type Audience = (typeof AUDIENCES)[number];

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  admin: 'Администратор',
  adult: 'Взрослый',
  child: 'Ребёнок',
};

export const AUDIENCE_LABELS: Readonly<Record<Audience, string>> = {
  household: 'Вся семья',
  adults: 'Взрослые',
};

/** Кто обращается: учётная запись и её роли в общих пространствах. */
export interface Viewer {
  accountId: string;
  /** id общего пространства → роль участника в нём. */
  memberships: ReadonlyMap<string, Role>;
}

/** Где лежит запись: личное пространство владельца или общее с аудиторией. */
export type Placement =
  | { kind: 'personal'; spaceId: string; ownerId: string }
  | { kind: 'household'; spaceId: string; audience: Audience };

/** Сведения о записи, от которых зависят права. */
export interface RecordFacts {
  placement: Placement;
  /** Вид записи: от него зависят права ребёнка. */
  type: string;
  authorId: string;
  assigneeId?: string | null;
}

const ADULT_ROLES: ReadonlySet<Role> = new Set(['admin', 'adult']);

export function roleIn(viewer: Viewer, spaceId: string): Role | undefined {
  return viewer.memberships.get(spaceId);
}

/** Видит ли участник запись. Личное — только владелец, администратор тоже не видит. */
export function canView(viewer: Viewer, placement: Placement): boolean {
  if (placement.kind === 'personal') return placement.ownerId === viewer.accountId;
  const role = roleIn(viewer, placement.spaceId);
  if (role === undefined) return false;
  return placement.audience === 'household' || ADULT_ROLES.has(role);
}

/**
 * Может ли участник создать или изменить запись.
 * В общем пространстве ребёнок пишет только покупки и дела, назначенные ему.
 */
export function canWrite(viewer: Viewer, record: RecordFacts): boolean {
  const { placement } = record;
  if (!canView(viewer, placement)) return false;
  if (placement.kind === 'personal') return true;
  if (roleIn(viewer, placement.spaceId) !== 'child') return true;
  if (record.type === 'shopping_item') return true;
  return record.type === 'task' && record.assigneeId === viewer.accountId;
}

/** Может ли участник убрать запись в корзину. В общем — только взрослые. */
export function canTrash(viewer: Viewer, record: RecordFacts): boolean {
  const { placement } = record;
  if (!canView(viewer, placement)) return false;
  if (placement.kind === 'personal') return true;
  const role = roleIn(viewer, placement.spaceId);
  return role !== undefined && ADULT_ROLES.has(role);
}

/** Может ли участник восстановить запись из корзины. В общем — администратор или взрослый-автор. */
export function canRestore(viewer: Viewer, record: RecordFacts): boolean {
  const { placement } = record;
  if (!canView(viewer, placement)) return false;
  if (placement.kind === 'personal') return true;
  const role = roleIn(viewer, placement.spaceId);
  return role === 'admin' || (role === 'adult' && record.authorId === viewer.accountId);
}

// Правила входа и учётных записей — PRD, раздел 10.1 (AUTH-2, AUTH-5, AUTH-8). Это не записи
// пользователя, а служебные сведения о входе, но правило «кто что видит и делает» то же:
// политики базы и проверки сервера обязаны совпадать с этими функциями (ADR-0005).

/** Может ли участник пригласить в дом с любой ролью: только администратор этого дома (AUTH-2). */
export function canInvite(viewer: Viewer, houseId: string): boolean {
  return roleIn(viewer, houseId) === 'admin';
}

/**
 * Может ли участник выдать ссылку сброса пароля участнику target (AUTH-5): администратор — только
 * ребёнку своего дома. Ребёнок — тот, кто во всех своих домах ребёнок: если где-то target взрослый
 * или администратор, его пароль сбросить нельзя. Свой пароль так не сбрасывают.
 */
export function canResetPassword(viewer: Viewer, target: Viewer): boolean {
  if (viewer.accountId === target.accountId) return false;
  const roles = [...target.memberships.values()];
  if (roles.length === 0 || roles.some((role) => role !== 'child')) return false;
  return [...target.memberships.keys()].some((houseId) => roleIn(viewer, houseId) === 'admin');
}

/** Обязателен ли второй фактор (AUTH-3): администратору любого дома — да; взрослым он лишь рекомендован. */
export function mustUseSecondFactor(viewer: Viewer): boolean {
  return [...viewer.memberships.values()].includes('admin');
}

/** Журнал входов и отметку о сбросе пароля видит только владелец учётной записи (AUTH-5, AUTH-8). */
export function canViewAccountJournal(viewer: Viewer, ownerAccountId: string): boolean {
  return viewer.accountId === ownerAccountId;
}
