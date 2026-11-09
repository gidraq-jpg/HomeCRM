import { ListChecks, Receipt } from '@phosphor-icons/react';
import { VISIBILITY_LABELS } from '../access/visibility.ts';
import { formatDay } from '../auth/dates.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { visibilityOf } from '../notes/abilities.ts';
import { PropertyStatusBadge } from '../property/PropertyStatusBadge.tsx';
import { Link } from '../shell/motion.tsx';
import { ContentMotion } from '../ui/ContentMotion.tsx';
import { CompactEmptyState } from '../ui/EmptyState.tsx';
import { type DateOnly, formatRub, formatShortDate } from '../ui/format.ts';
import { ListSkeleton } from '../ui/ListSkeleton.tsx';
import { Section } from '../ui/Page.tsx';
import { Row, RowList } from '../ui/Row.tsx';
import { StudioPage } from '../ui/StudioPage.tsx';
import { monthName, monthOf } from '../utilities/months.ts';
import { useMonth } from '../utilities/queries.ts';
import type { ObjectSummary } from './api.ts';
import { ObjectError } from './components.tsx';
import { todayIn } from './dates.ts';
import { useObjectsList } from './queries.ts';
import {
  OBJECT_TYPE_GROUPS,
  OBJECT_TYPE_ICONS,
  OBJECT_TYPES,
  type ObjectType,
  objectCount,
} from './types.ts';

export const NEW_OBJECT = '/home/new';
export const FROM_TEMPLATE = '/home/from-template';
export const MONTH_SCREEN = '/home/month';

export function ObjectRows({
  objects,
  label,
}: {
  objects: readonly ObjectSummary[];
  label: string;
}) {
  const { me } = useHousehold();
  return (
    <RowList label={label}>
      {objects.map((object) => {
        const visibility = visibilityOf(object);
        const TypeIcon = OBJECT_TYPE_ICONS[object.objectType];
        return (
          <Row
            key={object.id}
            to={`/home/${object.id}`}
            icon={<TypeIcon size={22} aria-hidden />}
            title={
              <>
                {object.title}
                {object.objectType === 'property' && object.typeData.status ? (
                  <span className="row__status">
                    <PropertyStatusBadge status={object.typeData.status} />
                  </span>
                ) : null}
              </>
            }
            meta={[
              object.objectType === 'property' ? object.typeData.address : undefined,
              VISIBILITY_LABELS[visibility],
              formatDay(object.updatedAt, me.timeZone),
            ]
              .filter((part) => part !== undefined && part !== '')
              .join(' · ')}
            clampMeta
            badge={visibility}
          />
        );
      })}
    </RowList>
  );
}

/** Пустой «Дом» объясняет разницу личного и общего и предлагает первое действие — TPL-4, PRD 7.4. */
function EmptyObjects() {
  return <CompactEmptyState title="Объектов пока нет" />;
}

/**
 * Сводка вместо текстовой кнопки (D48): тот же переход на «Коммуналку за месяц», в строке — сумма
 * к оплате и срок из ответа API. Пока ответа нет или начислений нет, строка без чисел.
 */
function MonthCard() {
  const { me } = useHousehold();
  const query = useMonth();
  const month = query.data?.month ?? monthOf(todayIn(me.timeZone));
  const totals = query.data?.totals;
  const name = monthName(month).split(' ')[0]?.toLowerCase() ?? '';
  let meta: string | null = null;
  if (totals && totals.chargedCents > 0) {
    meta =
      totals.remainingCents > 0
        ? `${totals.overdue ? 'Долг' : 'К оплате'} ${formatRub(totals.remainingCents)}${
            totals.dueOn
              ? `${totals.overdue ? ', срок был' : ' до'} ${formatShortDate(totals.dueOn as DateOnly)}`
              : ''
          }`
        : 'Всё оплачено';
  }
  return (
    <div className="month-card">
      <RowList label="Коммуналка">
        <Row
          key="month"
          to={MONTH_SCREEN}
          icon={<Receipt size={22} aria-hidden />}
          title={`Коммуналка за ${name}`}
          {...(meta ? { meta } : {})}
          chevron
        />
      </RowList>
    </div>
  );
}

/** «Дом» (OBJ-1…3): объекты по типам под переключателем «Всё · Общее · Личное». */
export function ObjectsScreen() {
  const query = useObjectsList(false);

  if (query.isPending) {
    return (
      <StudioPage title="Дом">
        <ListSkeleton label="Загружаем объекты…" />
      </StudioPage>
    );
  }
  if (query.data === undefined) {
    return (
      <StudioPage title="Дом">
        <ObjectError error={query.error} action="load" />
        <button className="text-button" type="button" onClick={() => void query.refetch()}>
          Повторить загрузку объектов
        </button>
      </StudioPage>
    );
  }

  const all = query.data.pages.flat();
  const groups = OBJECT_TYPES.map((type): [ObjectType, ObjectSummary[]] => [
    type,
    all.filter((object) => object.objectType === type),
  ]).filter(([, items]) => items.length > 0);

  return (
    <StudioPage title="Дом" {...(all.length > 0 ? { eyebrow: objectCount(all.length) } : {})}>
      <ContentMotion version={all.map((card) => card.id).join(',')}>
        {all.length === 0 ? (
          <EmptyObjects />
        ) : (
          <>
            {all.some((object) => object.objectType === 'property') ? <MonthCard /> : null}
            {groups.map(([type, items]) => (
              <Section
                key={type}
                title={OBJECT_TYPE_GROUPS[type]}
                aside={<span className="muted">{items.length}</span>}
              >
                <ObjectRows objects={items} label={OBJECT_TYPE_GROUPS[type]} />
              </Section>
            ))}

            {query.hasNextPage ? (
              <button
                type="button"
                className="btn btn--secondary btn--block list-action"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? 'Загружаем…' : 'Показать ещё'}
              </button>
            ) : null}
            {query.isError ? <ObjectError error={query.error} action="load" /> : null}

            <Link className="btn btn--secondary btn--block list-action" to={FROM_TEMPLATE}>
              <ListChecks size={20} aria-hidden />
              Создать из шаблона
            </Link>
          </>
        )}
      </ContentMotion>
    </StudioPage>
  );
}
