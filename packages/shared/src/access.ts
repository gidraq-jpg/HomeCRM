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

/**
 * Кто обращается: учётная запись и её роли в общих пространствах.
 * Роли — только действующие: вышедший из дома или исключённый (SPACE-8, SPACE-9) в `memberships` не входит.
 */
export interface Viewer {
  accountId: string;
  /** id общего пространства → роль участника в нём. */
  memberships: ReadonlyMap<string, Role>;
}

/** Где лежит запись: личное пространство владельца или общее с аудиторией. */
export type Placement =
  | { kind: 'personal'; spaceId: string; ownerId: string }
  | { kind: 'household'; spaceId: string; audience: Audience };

/**
 * Сведения о записи, от которых зависят права. Ответственный — итоговый, после правила 9
 * (`defaultAssignee`): так его видят и сервер, и база.
 */
export interface RecordFacts {
  placement: Placement;
  /** Вид записи: от него зависят права ребёнка. */
  type: string;
  authorId: string;
  assigneeId?: string | null;
  /** Запись в корзине: менять и переносить её нельзя, можно только восстановить (DATA-1). */
  trashed?: boolean;
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

/** OBJ-4, OBJ-5: выдача файла требует видимости файла и его родителя. */
export function canViewFile(viewer: Viewer, file: RecordFacts, parent: RecordFacts): boolean {
  return canView(viewer, file.placement) && canView(viewer, parent.placement);
}

/** OBJ-2: связь не раскрывает ни один из концов, включая записи в корзине. */
export function canViewLink(viewer: Viewer, left: RecordFacts, right: RecordFacts): boolean {
  return canView(viewer, left.placement) && canView(viewer, right.placement);
}

/** Подписать, создать или убрать связь может читатель обоих концов с правом правки хотя бы одного. */
export function canWriteLink(viewer: Viewer, left: RecordFacts, right: RecordFacts): boolean {
  return canViewLink(viewer, left, right) && (canWrite(viewer, left) || canWrite(viewer, right));
}

/** OBJ-3, OBJ-6: событие требует доступа сейчас и к месту, зафиксированному при его создании. */
export function canViewTimelineEvent(
  viewer: Viewer,
  record: RecordFacts,
  original: Placement,
): boolean {
  return canView(viewer, record.placement) && canView(viewer, original);
}

/**
 * Может ли участник изменить запись. Перенос проверяет отдельно `canMove`.
 * В общем пространстве ребёнок пишет только покупки и дела, назначенные ему.
 * Запись в корзине не меняют и не переносят: её можно только восстановить (`canRestore`).
 */
export function canWrite(viewer: Viewer, record: RecordFacts): boolean {
  const { placement } = record;
  if (record.trashed === true) return false;
  if (!canView(viewer, placement)) return false;
  if (placement.kind === 'personal') return true;
  if (roleIn(viewer, placement.spaceId) !== 'child') return true;
  if (record.type === 'shopping_item') return true;
  return record.type === 'task' && record.assigneeId === viewer.accountId;
}

/**
 * Может ли участник создать запись. Автор записи — всегда тот, кто её создаёт: от чужого имени
 * записи не создают, а новая запись не бывает сразу в корзине (PRD 6.2).
 */
export function canCreate(viewer: Viewer, record: RecordFacts): boolean {
  return record.authorId === viewer.accountId && canWrite(viewer, record);
}

/** SPACE-7: перенос — отдельное действие, права обычной правки недостаточно. */
export function canMove(
  viewer: Viewer,
  record: RecordFacts,
  target: Placement,
  hasOtherContributions = true,
): boolean {
  if (!canWrite(viewer, record)) return false;
  if (record.placement.kind === 'personal' && target.kind === 'household')
    return (
      record.placement.ownerId === viewer.accountId &&
      canWrite(viewer, { ...record, placement: target })
    );
  if (record.placement.kind === 'household' && target.kind === 'personal')
    return (
      target.ownerId === viewer.accountId &&
      record.authorId === viewer.accountId &&
      !hasOtherContributions
    );
  return false;
}

/** Копия доступна любому читателю, включая ребёнка; автор новой записи — он сам. */
export function canCopyToPersonal(viewer: Viewer, record: RecordFacts): boolean {
  return record.trashed !== true && canView(viewer, record.placement);
}

/** Правило 7: аудиторию меняет взрослый; ответственный должен видеть новое место. */
export function canChangeAudience(viewer: Viewer, record: RecordFacts, target: Placement): boolean {
  return (
    record.placement.kind === 'household' &&
    target.kind === 'household' &&
    record.placement.spaceId === target.spaceId &&
    ADULT_ROLES.has(roleIn(viewer, target.spaceId) as Role) &&
    canWrite(viewer, record)
  );
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

/**
 * Ответственный по умолчанию — правило 9 (PRD 7.3). В личном — всегда владелец, кого бы ни назвали.
 * В общем — назначенный участник, а если не назначен, то автор.
 */
export function defaultAssignee(
  placement: Placement,
  authorId: string,
  assigneeId?: string | null,
): string {
  return placement.kind === 'personal' ? placement.ownerId : (assigneeId ?? authorId);
}

/**
 * Может ли участник быть ответственным за запись в этом месте: он должен её видеть (PRD 7.3.4).
 * Для «Взрослых» это значит — только взрослый или администратор (правило 9). Если ответственного
 * нет, им становится администратор: так при уходе участника из дома (правило 12) база передаёт ему дела.
 */
export function canBeAssignee(target: Viewer, placement: Placement): boolean {
  return canView(target, placement);
}

// Состав дома и видимость пространств (SPACE-1, SPACE-2, SPACE-8, SPACE-9, PRD 7.3.12).

/** Пространство глазами правил доступа: личное — с владельцем, дом — без него. */
export type SpaceFacts =
  | { kind: 'personal'; id: string; ownerId: string }
  | { kind: 'household'; id: string };

/** Видит ли участник пространство: личное — только владелец, дом — его действующие участники. */
export function canViewSpace(viewer: Viewer, space: SpaceFacts): boolean {
  return space.kind === 'personal'
    ? space.ownerId === viewer.accountId
    : roleIn(viewer, space.id) !== undefined;
}

/** Закрытые сведения учётной записи видит только её владелец. */
export function canViewAccount(viewer: Viewer, ownerAccountId: string): boolean {
  return viewer.accountId === ownerAccountId;
}

/** Состав своего действующего дома, включая бывших участников, и собственные членства. */
export function canViewMembership(
  viewer: Viewer,
  memberAccountId: string,
  houseId?: string,
): boolean {
  return (
    viewer.accountId === memberAccountId ||
    (houseId !== undefined && viewer.memberships.has(houseId))
  );
}

/** Семейные поля профиля видят владелец и участники домов, где владелец профиля ещё состоит. */
export function canViewProfile(
  viewer: Viewer,
  ownerAccountId: string,
  houseIds: readonly string[],
): boolean {
  return (
    viewer.accountId === ownerAccountId ||
    houseIds.some((houseId) => viewer.memberships.has(houseId))
  );
}

/** Роль меняет администратор; последнего администратора понизить нельзя. */
export function canChangeRole(
  viewer: Viewer,
  houseId: string,
  target: Viewer,
  role: Role,
  adminIds: readonly string[],
): boolean {
  return (
    roleIn(viewer, houseId) === 'admin' &&
    roleIn(target, houseId) !== undefined &&
    (roleIn(target, houseId) !== 'admin' ||
      role === 'admin' ||
      adminIds.some((id) => id !== target.accountId))
  );
}

/**
 * Может ли участник исключить другого из дома (SPACE-8): только администратор этого дома и только
 * действующего участника, не себя. Личное пространство исключённого остаётся с ним.
 */
export function canExclude(viewer: Viewer, houseId: string, target: Viewer): boolean {
  return (
    roleIn(viewer, houseId) === 'admin' &&
    viewer.accountId !== target.accountId &&
    roleIn(target, houseId) !== undefined
  );
}

/**
 * Может ли участник покинуть дом (SPACE-9): любой действующий. Последний администратор — нет:
 * без него некому принять ответственность за записи, поэтому ему сначала назначают преемника.
 * `adminIds` — все действующие администраторы дома.
 */
export function canLeave(viewer: Viewer, houseId: string, adminIds: readonly string[]): boolean {
  const role = roleIn(viewer, houseId);
  if (role === undefined) return false;
  return role !== 'admin' || adminIds.some((id) => id !== viewer.accountId);
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
