import { CaretLeft, DotsThree, PencilSimple } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link, Outlet, useNavigate, useParams } from 'react-router';
import { AccessBadge } from '../access/AccessBadge.tsx';
import { Notice } from '../auth/components.tsx';
import { formatMoment } from '../auth/dates.ts';
import { useSourceDeadlines } from '../deadlines/queries.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { useMeters } from '../meters/queries.ts';
import { viewerOf, visibilityOf } from '../notes/abilities.ts';
import { PropertyStatusBadge } from '../property/PropertyStatusBadge.tsx';
import { formatArea } from '../property/property.ts';
import { FormHeading } from '../ui/FormHeading.tsx';
import { LinkTabs } from '../ui/LinkTabs.tsx';
import { Page } from '../ui/Page.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { objectAbilities } from './abilities.ts';
import type { ObjectCard } from './api.ts';
import { ObjectError } from './components.tsx';
import { ObjectAccess } from './ObjectAccess.tsx';
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
  return <ObjectView key={query.data.id} card={query.data} />;
}

function ObjectView({ card }: { card: ObjectCard }) {
  const { me, householdId } = useHousehold();
  const abilities = objectAbilities(viewerOf(me), card, householdId);
  const base = `/home/${card.id}`;
  const trashed = card.deletedAt !== null;
  const property = card.objectType === 'property';
  const navigate = useNavigate();
  const [panel, setPanel] = useState<'edit' | 'more' | null>(null);
  const [accessOpen, setAccessOpen] = useState(false);
  const meters = useMeters(card.id, 'active', property && !trashed);
  const deadlines = useSourceDeadlines('objects', card.id);
  const eyebrow = `${OBJECT_TYPE_LABELS[card.objectType]} · изменён ${formatMoment(card.updatedAt, me.timeZone)}`;

  return (
    <Page
      title={card.title}
      className={`object-page ${panel === 'edit' ? 'ui7-fullscreen-form' : ''}`}
      documentTitle={TAB_TITLE}
      eyebrow={trashed ? `${eyebrow} · в корзине` : eyebrow}
      heading={
        panel === 'edit' ? (
          <FormHeading title={card.title} back={BACK} />
        ) : (
          <div className="object-hero">
            <div className="object-hero__actions">
              <Link className="back-link" to="/home">
                <CaretLeft size={20} aria-hidden />
                Дом
              </Link>
              {abilities.edit && !trashed ? (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Править"
                  onClick={() => {
                    setPanel('edit');
                    navigate(base);
                  }}
                >
                  <PencilSimple size={22} aria-hidden />
                </button>
              ) : null}
              <button
                type="button"
                className="icon-button"
                aria-label="Ещё: действия с объектом"
                onClick={() => {
                  setPanel('more');
                  navigate(base);
                }}
              >
                <DotsThree size={24} aria-hidden />
              </button>
            </div>
            <p className="object-hero__type">
              {OBJECT_TYPE_LABELS[card.objectType]}
              {trashed ? ' · в корзине' : ''}
            </p>
            <h1>{card.title}</h1>
            <div className="object-hero__meta">
              {card.typeData.address ? <span>{card.typeData.address}</span> : null}
              {!trashed ? (
                <button
                  type="button"
                  className="object-access-trigger"
                  aria-label="Кто видит объект"
                  onClick={() => setAccessOpen(true)}
                >
                  <AccessBadge visibility={visibilityOf(card)} showLabel />
                </button>
              ) : null}
              {property && card.typeData.status ? (
                <PropertyStatusBadge status={card.typeData.status} />
              ) : null}
            </div>
            <dl className="object-facts">
              {card.typeData.areaHundredths !== undefined ? (
                <div>
                  <dt>Площадь</dt>
                  <dd>{formatArea(card.typeData.areaHundredths)}</dd>
                </div>
              ) : null}
              {property && meters.data && !meters.error ? (
                <div>
                  <dt>Счётчики</dt>
                  <dd>{meters.data.length}</dd>
                </div>
              ) : null}
              {deadlines.data && !deadlines.error ? (
                <div>
                  <dt>Сроки</dt>
                  <dd>{deadlines.data.length}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        )
      }
      {...(property && card.typeData.status
        ? { status: <PropertyStatusBadge status={card.typeData.status} /> }
        : {})}
    >
      <div className={`studio-panel object-panel ${panel === 'edit' ? 'ui6-panel' : ''}`}>
        {panel !== 'edit' ? (
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
        ) : null}
        <Outlet context={{ card, abilities, panel, setPanel }} />
      </div>
      {accessOpen ? (
        <Sheet
          open
          onOpenChange={setAccessOpen}
          title="Доступ к объекту"
          description="Доступ к объекту и его записям"
        >
          <ObjectAccess card={card} abilities={abilities} onComplete={() => setAccessOpen(false)} />
        </Sheet>
      ) : null}
    </Page>
  );
}
