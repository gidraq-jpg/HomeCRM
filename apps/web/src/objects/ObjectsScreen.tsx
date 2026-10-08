import { Buildings, Plus } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { SCOPE_LABELS } from '../access/scope.ts';
import { VISIBILITY_LABELS } from '../access/visibility.ts';
import { Notice } from '../auth/components.tsx';
import { formatDay } from '../auth/dates.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { visibilityOf } from '../notes/abilities.ts';
import { PropertyStatusBadge } from '../property/PropertyStatusBadge.tsx';
import { EMPTY_SCOPE_EXPLANATION, EmptyState } from '../ui/EmptyState.tsx';
import { Page, Section } from '../ui/Page.tsx';
import { Row, RowList } from '../ui/Row.tsx';
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
  const { scope, setScope } = useScope();
  return (
    <EmptyState
      icon={<Buildings size={24} aria-hidden />}
      title="Объектов пока нет"
      actions={
        <>
          <Link className="btn btn--primary btn--block" to={NEW_OBJECT}>
            <Plus size={20} weight="bold" aria-hidden />
            Добавить объект
          </Link>
          {scope === 'all' ? null : (
            <button
              type="button"
              className="btn btn--secondary btn--block"
              onClick={() => setScope('all')}
            >
              Показать «{SCOPE_LABELS.all}»
            </button>
          )}
          <Link className="text-button" to="/more/spaces">
            Как устроены личное и общее
          </Link>
        </>
      }
    >
      <p>{EMPTY_SCOPE_EXPLANATION[scope]}</p>
      <p>
        Объект — это квартира, дача, машина или техника: к нему можно добавить свои поля, события в
        ленте и связи с заметками. Недвижимость, машину, технику и другое по умолчанию видят
        взрослые дома; при создании можно выбрать «Вся семья» или «Только я».
      </p>
    </EmptyState>
  );
}

/** «Дом» (OBJ-1…3): объекты по типам под переключателем «Всё · Общее · Личное». */
export function ObjectsScreen() {
  const query = useObjectsList(false);

  if (query.isPending) {
    return (
      <Page title="Дом">
        <Notice>Загружаем объекты…</Notice>
      </Page>
    );
  }
  if (query.data === undefined) {
    return (
      <Page title="Дом">
        <ObjectError error={query.error} action="load" />
        <button className="text-button" type="button" onClick={() => void query.refetch()}>
          Повторить загрузку объектов
        </button>
      </Page>
    );
  }

  const all = query.data.pages.flat();
  const groups = OBJECT_TYPES.map((type): [ObjectType, ObjectSummary[]] => [
    type,
    all.filter((object) => object.objectType === type),
  ]).filter(([, items]) => items.length > 0);

  return (
    <Page title="Дом" {...(all.length > 0 ? { eyebrow: objectCount(all.length) } : {})}>
      {all.length === 0 ? (
        <EmptyObjects />
      ) : (
        <>
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

          <Link className="btn btn--primary btn--block list-action" to={NEW_OBJECT}>
            <Plus size={20} weight="bold" aria-hidden />
            Добавить объект
          </Link>
        </>
      )}
    </Page>
  );
}
