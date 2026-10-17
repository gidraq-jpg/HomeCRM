import { ListChecks, Receipt } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { VISIBILITY_LABELS } from '../access/visibility.ts';
import { Notice } from '../auth/components.tsx';
import { formatDay } from '../auth/dates.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { visibilityOf } from '../notes/abilities.ts';
import { PropertyStatusBadge } from '../property/PropertyStatusBadge.tsx';
import { CompactEmptyState } from '../ui/EmptyState.tsx';
import { Section } from '../ui/Page.tsx';
import { Row, RowList } from '../ui/Row.tsx';
import { StudioPage } from '../ui/StudioPage.tsx';
import type { ObjectSummary } from './api.ts';
import { ObjectError } from './components.tsx';
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

/** «Дом» (OBJ-1…3): объекты по типам под переключателем «Всё · Общее · Личное». */
export function ObjectsScreen() {
  const query = useObjectsList(false);

  if (query.isPending) {
    return (
      <StudioPage title="Дом">
        <Notice>Загружаем объекты…</Notice>
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
      {all.length === 0 ? (
        <EmptyObjects />
      ) : (
        <>
          {all.some((object) => object.objectType === 'property') ? (
            <Link className="btn btn--secondary btn--block month-link" to={MONTH_SCREEN}>
              <Receipt size={20} aria-hidden />
              Коммуналка за месяц
            </Link>
          ) : null}
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
    </StudioPage>
  );
}
