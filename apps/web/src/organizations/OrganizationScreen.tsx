import { ArrowCounterClockwise, PencilSimple, Phone, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AccessBadge } from '../access/AccessBadge.tsx';
import { Notice, useAction } from '../auth/components.tsx';
import { formatDay, formatMoment } from '../auth/dates.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { viewerOf, visibilityOf } from '../notes/abilities.ts';
import { ObjectError } from '../objects/components.tsx';
import { usePersonName } from '../objects/context.ts';
import { CopyButton } from '../ui/CopyButton.tsx';
import { toTelHref } from '../ui/format.ts';
import { EXTERNAL_LINK } from '../ui/link.ts';
import { Page } from '../ui/Page.tsx';
import { Status } from '../ui/Row.tsx';
import { useToast } from '../ui/Toast.tsx';
import { organizationAbilities } from './abilities.ts';
import {
  type ContactCard,
  patchOrganization,
  restoreOrganization,
  trashOrganization,
} from './api.ts';
import { ORGANIZATION_TYPE_LABELS, organizationDraft } from './form.ts';
import { OrganizationForm } from './OrganizationForm.tsx';
import { useOrganization, useRefreshOrganizations } from './queries.ts';

const BACK = { to: '/more/organizations', label: 'Организации' } as const;
/** Название вкладки одинаковое для всех организаций: название в историю браузера не попадает. */
const TAB_TITLE = 'Организация';

export function PhoneList({ phones }: { phones: ContactCard['data']['phones'] }) {
  if (phones.length === 0) {
    return <p className="muted">Телефонов пока нет.</p>;
  }
  // У телефона нет собственного идентификатора: порядок в списке и номер различают строки.
  const rows = phones.map((phone, position) => ({ phone, key: `${position}-${phone.number}` }));
  return (
    <ul className="phone-list" aria-label="Телефоны">
      {rows.map(({ phone, key }) => (
        <li className="phone-item" key={key}>
          <div className="phone-item__main">
            <span className="phone-item__number mono">{phone.number}</span>
            {phone.label === '' ? null : <span className="phone-item__label">{phone.label}</span>}
            {phone.emergency ? <Status tone="danger">Аварийный</Status> : null}
          </div>
          <div className="phone-item__actions">
            <a
              className="btn btn--secondary"
              href={toTelHref(phone.number)}
              aria-label={`Позвонить: ${phone.label === '' ? phone.number : phone.label}`}
            >
              <Phone size={20} aria-hidden />
              Позвонить
            </a>
            <CopyButton value={phone.number} what="номер телефона" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Карточка организации (CONT-2): телефоны, сайт, адрес, часы работы, заметка; правка и корзина. */
export function OrganizationScreen() {
  const { organizationId } = useParams();
  const query = useOrganization(organizationId);

  if (query.isPending) {
    return (
      <Page title="Организация" back={BACK} documentTitle={TAB_TITLE}>
        <Notice>Загружаем организацию…</Notice>
      </Page>
    );
  }
  if (query.isError) {
    return (
      <Page title="Организация" back={BACK} documentTitle={TAB_TITLE}>
        <ObjectError error={query.error} action="contact" />
        <button className="text-button" type="button" onClick={() => void query.refetch()}>
          Повторить загрузку организации
        </button>
      </Page>
    );
  }
  return <OrganizationView card={query.data} />;
}

function OrganizationView({ card }: { card: ContactCard }) {
  const { me, householdId } = useHousehold();
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshOrganizations();
  const nameOf = usePersonName();
  const quick = useAction();
  const save = useAction();
  const [editing, setEditing] = useState(false);

  const abilities = organizationAbilities(viewerOf(me), card, householdId);
  const visibility = visibilityOf(card);
  const trashed = card.deletedAt !== null;
  const { data } = card;
  const eyebrow = `${ORGANIZATION_TYPE_LABELS[data.organizationType]} · изменена ${formatMoment(card.updatedAt, me.timeZone)}`;

  function trash() {
    void quick.run(async () => {
      await trashOrganization(card.id);
      await refresh();
      navigate('/more/organizations');
      toast.show(
        abilities.restore
          ? {
              message: 'Организация в корзине',
              detail: 'Хранится 30 дней',
              action: {
                label: 'Отменить',
                onClick: () => {
                  restoreOrganization(card.id)
                    .then(() => refresh())
                    .then(() => toast.show({ message: 'Организация возвращена' }))
                    .catch(() =>
                      toast.show({
                        message: 'Не удалось вернуть организацию',
                        detail: 'Откройте «Корзину» в разделе «Ещё» и восстановите её там.',
                      }),
                    );
                },
              },
            }
          : {
              message: 'Организация в корзине',
              detail: 'Вернуть её сможет автор-взрослый или администратор. Хранится 30 дней.',
              durationMs: 10_000,
            },
      );
    });
  }

  function restore() {
    void quick.run(async () => {
      await restoreOrganization(card.id);
      await refresh();
      toast.show({ message: 'Организация возвращена' });
    });
  }

  if (editing) {
    return (
      <Page title={card.title} documentTitle={TAB_TITLE} eyebrow="Правка организации" back={BACK}>
        <OrganizationForm
          draft={organizationDraft(card.title, data)}
          submitLabel="Сохранить"
          pendingLabel="Сохраняем…"
          state={save}
          onCancel={() => {
            save.setError(null);
            setEditing(false);
          }}
          onSubmit={(values) =>
            void save.run(async () => {
              await patchOrganization(card.id, { ...values, expectedUpdatedAt: card.updatedAt });
              await refresh();
              setEditing(false);
              toast.show({ message: 'Организация сохранена' });
            })
          }
        />
      </Page>
    );
  }

  return (
    <Page
      title={card.title}
      documentTitle={TAB_TITLE}
      eyebrow={trashed ? `${eyebrow} · в корзине` : eyebrow}
      back={BACK}
    >
      <p className="property-meta">
        <AccessBadge visibility={visibility} showLabel />
      </p>

      {trashed ? (
        <Notice>
          <strong>Организация в корзине.</strong>{' '}
          {abilities.restore
            ? 'Её можно вернуть: менять организацию в корзине нельзя.'
            : 'Вернуть её сможет автор-взрослый или администратор. Менять организацию в корзине нельзя.'}
        </Notice>
      ) : null}

      <section className="section" aria-labelledby={`phones-${card.id}`}>
        <div className="section__head">
          <h2 className="section__title" id={`phones-${card.id}`}>
            Телефоны
          </h2>
          {data.phones.length > 0 ? <span className="muted">{data.phones.length}</span> : null}
        </div>
        <PhoneList phones={data.phones} />
      </section>

      <dl className="facts facts--fields">
        <div className="facts__item">
          <dt>Тип</dt>
          <dd>{ORGANIZATION_TYPE_LABELS[data.organizationType]}</dd>
        </div>
        {data.website === null ? null : (
          <div className="facts__item">
            <dt>Сайт</dt>
            <dd>
              <a href={data.website} {...EXTERNAL_LINK}>
                {data.website.replace(/^https?:\/\//, '')}
              </a>
            </dd>
          </div>
        )}
        {data.address === '' ? null : (
          <div className="facts__item">
            <dt>Адрес</dt>
            <dd>{data.address}</dd>
          </div>
        )}
        {data.openingHours === '' ? null : (
          <div className="facts__item">
            <dt>Часы работы</dt>
            <dd>{data.openingHours}</dd>
          </div>
        )}
        {data.note === '' ? null : (
          <div className="facts__item">
            <dt>Заметка</dt>
            <dd>{data.note}</dd>
          </div>
        )}
        <div className="facts__item">
          <dt>Автор</dt>
          <dd>{nameOf(card.authorId)}</dd>
        </div>
        <div className="facts__item">
          <dt>Создана</dt>
          <dd>{formatDay(card.createdAt, me.timeZone)}</dd>
        </div>
      </dl>

      <ObjectError error={quick.error} action="contact" />
      {!trashed ? (
        <div className="btn-row">
          {abilities.edit ? (
            <button type="button" className="btn btn--primary" onClick={() => setEditing(true)}>
              <PencilSimple size={20} aria-hidden />
              Править
            </button>
          ) : (
            <p className="muted">Эту организацию могут править только взрослые участники дома.</p>
          )}
          {abilities.trash ? (
            <button
              type="button"
              className="btn btn--secondary"
              disabled={quick.disabled}
              onClick={trash}
            >
              <Trash size={20} aria-hidden />В корзину
            </button>
          ) : null}
        </div>
      ) : abilities.restore ? (
        <div className="btn-row">
          <button
            type="button"
            className="btn btn--primary"
            disabled={quick.disabled}
            onClick={restore}
          >
            <ArrowCounterClockwise size={20} aria-hidden />
            Восстановить
          </button>
        </div>
      ) : null}
    </Page>
  );
}
