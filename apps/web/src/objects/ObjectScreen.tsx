import { Outlet, useParams } from 'react-router';
import { Notice } from '../auth/components.tsx';
import { formatMoment } from '../auth/dates.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { viewerOf } from '../notes/abilities.ts';
import { PropertyStatusBadge } from '../property/PropertyStatusBadge.tsx';
import { LinkTabs } from '../ui/LinkTabs.tsx';
import { Page } from '../ui/Page.tsx';
import { objectAbilities } from './abilities.ts';
import type { ObjectCard } from './api.ts';
import { ObjectError } from './components.tsx';
import { useObjectCard } from './queries.ts';
import { OBJECT_TYPE_LABELS } from './types.ts';

const BACK = { to: '/home', label: 'Дом' } as const;
/** Название вкладки одинаковое для всех объектов: название объекта в историю браузера не попадает. */
const TAB_TITLE = 'Объект';

/**
 * Карточка объекта (PRD, раздел 14): вкладки «Обзор», «Лента», «Файлы» и, у недвижимости, «Счета» и «Счётчики»
 * на второй строке под названием; статус недвижимости стоит рядом с названием.
 */
export function ObjectScreen() {
  const { objectId } = useParams();
  const query = useObjectCard(objectId);

  if (query.isPending) {
    return (
      <Page title="Объект" back={BACK} documentTitle={TAB_TITLE}>
        <Notice>Загружаем объект…</Notice>
      </Page>
    );
  }
  if (query.isError) {
    return (
      <Page title="Объект" back={BACK} documentTitle={TAB_TITLE}>
        <ObjectError error={query.error} action="load" />
        <button className="text-button" type="button" onClick={() => void query.refetch()}>
          Повторить загрузку объекта
        </button>
      </Page>
    );
  }
  return <ObjectView card={query.data} />;
}

function ObjectView({ card }: { card: ObjectCard }) {
  const { me, householdId } = useHousehold();
  const abilities = objectAbilities(viewerOf(me), card, householdId);
  const base = `/home/${card.id}`;
  const trashed = card.deletedAt !== null;
  const property = card.objectType === 'property';
  const eyebrow = `${OBJECT_TYPE_LABELS[card.objectType]} · изменён ${formatMoment(card.updatedAt, me.timeZone)}`;

  return (
    <Page
      title={card.title}
      documentTitle={TAB_TITLE}
      eyebrow={trashed ? `${eyebrow} · в корзине` : eyebrow}
      back={BACK}
      {...(property && card.typeData.status
        ? { status: <PropertyStatusBadge status={card.typeData.status} /> }
        : {})}
      tabs={
        <LinkTabs
          label="Разделы объекта"
          items={[
            { to: base, label: 'Обзор', end: true },
            { to: `${base}/timeline`, label: 'Лента' },
            { to: `${base}/files`, label: 'Файлы' },
            ...(property ? [{ to: `${base}/accounts`, label: 'Счета' }] : []),
            ...(property ? [{ to: `${base}/meters`, label: 'Счётчики' }] : []),
          ]}
        />
      }
    >
      <Outlet context={{ card, abilities }} />
    </Page>
  );
}
