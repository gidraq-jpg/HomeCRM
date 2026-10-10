import { ArrowCounterClockwise, PencilSimple, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AccessBadge } from '../access/AccessBadge.tsx';
import { Notice, useAction } from '../auth/components.tsx';
import { formatDay, formatMoment } from '../auth/dates.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { factsOf, viewerOf, visibilityOf } from '../notes/abilities.ts';
import { ObjectError } from '../objects/components.tsx';
import { usePersonName } from '../objects/context.ts';
import { organizationAbilities } from '../organizations/abilities.ts';
import { OrganizationView } from '../organizations/OrganizationScreen.tsx';
import { useOrganizationOptions } from '../organizations/queries.ts';
import { EXTERNAL_LINK } from '../ui/link.ts';
import { Page } from '../ui/Page.tsx';
import { useToast } from '../ui/Toast.tsx';
import { patchPerson, restorePerson, trashPerson } from './api.ts';
import { ContactObjects } from './ContactObjects.tsx';
import { PhoneRows, QuickActions } from './ContactParts.tsx';
import { personDraft } from './form.ts';
import { InteractionsSection } from './InteractionsSection.tsx';
import { birthdayLabel, categoriesLabel } from './labels.ts';
import { PersonForm } from './PersonForm.tsx';
import { useContact, useRefreshContacts } from './queries.ts';
import type { PersonCard } from './schema.ts';
import { TrashInteractions } from './TrashPeople.tsx';

export const PEOPLE_BACK = { to: '/people', label: 'Люди' } as const;
/** Название вкладки одинаковое для всех контактов: ФИО в историю браузера не попадает. */
const TAB_TITLE = 'Контакт';

/**
 * Карточка контакта «Люди → контакт» (CONT-1…5): по виду записи открывает карточку человека или
 * организации.
 */
export function ContactScreen() {
  const { contactId } = useParams();
  const query = useContact(contactId);

  if (query.isPending) {
    return (
      <Page title="Контакт" back={PEOPLE_BACK} documentTitle={TAB_TITLE}>
        <Notice>Загружаем контакт…</Notice>
      </Page>
    );
  }
  if (query.isError) {
    return (
      <Page title="Контакт" back={PEOPLE_BACK} documentTitle={TAB_TITLE}>
        <ObjectError error={query.error} action="person" />
        <button className="text-button" type="button" onClick={() => void query.refetch()}>
          Повторить загрузку контакта
        </button>
      </Page>
    );
  }
  const card = query.data;
  // Ключ: при переходе на другой контакт формы и черновики начинаются с чистого листа.
  return card.kind === 'person' ? (
    <PersonView key={card.id} card={card} />
  ) : (
    <OrganizationView key={card.id} card={card} back={PEOPLE_BACK} listPath="/people" />
  );
}

function PersonView({ card }: { card: PersonCard }) {
  const { me, householdId } = useHousehold();
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshContacts();
  const nameOf = usePersonName();
  const organizations = useOrganizationOptions();
  const quick = useAction();
  const save = useAction();
  const [editing, setEditing] = useState(false);

  const viewer = viewerOf(me);
  const abilities = organizationAbilities(viewer, card, householdId);
  const visibility = visibilityOf(card);
  const trashed = card.deletedAt !== null;
  const { data } = card;
  const categories = categoriesLabel(data.categories);
  const eyebrow = `${categories === '' ? 'Человек' : categories} · изменён ${formatMoment(card.updatedAt, me.timeZone)}`;

  function trash() {
    void quick.run(async () => {
      await trashPerson(card.id);
      await refresh();
      navigate('/people');
      toast.show(
        abilities.restore
          ? {
              message: 'Контакт в корзине',
              detail: 'Хранится 30 дней',
              action: {
                label: 'Отменить',
                onClick: () => {
                  restorePerson(card.id)
                    .then(() => refresh())
                    .then(() => toast.show({ message: 'Контакт возвращён' }))
                    .catch(() =>
                      toast.show({
                        message: 'Не удалось вернуть контакт',
                        detail: 'Откройте «Корзину» в разделе «Ещё» и восстановите его там.',
                      }),
                    );
                },
              },
            }
          : {
              message: 'Контакт в корзине',
              detail: 'Вернуть его сможет автор-взрослый или администратор. Хранится 30 дней.',
              durationMs: 10_000,
            },
      );
    });
  }

  function restore() {
    void quick.run(async () => {
      await restorePerson(card.id);
      await refresh();
      toast.show({ message: 'Контакт возвращён' });
    });
  }

  if (editing) {
    return (
      <Page
        title={card.title}
        documentTitle={TAB_TITLE}
        eyebrow="Правка контакта"
        back={PEOPLE_BACK}
      >
        <PersonForm
          draft={personDraft(card)}
          organizations={(organizations.data ?? []).map(({ id, title }) => ({ id, title }))}
          submitLabel="Сохранить"
          pendingLabel="Сохраняем…"
          state={save}
          onCancel={() => {
            save.setError(null);
            setEditing(false);
          }}
          onSubmit={(values) =>
            void save.run(async () => {
              await patchPerson(card.id, {
                ...values,
                ...(card.organizationId === null && values.organizationId === null
                  ? { organizationId: undefined }
                  : {}),
                expectedUpdatedAt: card.updatedAt,
              });
              await refresh();
              setEditing(false);
              toast.show({ message: 'Контакт сохранён' });
            })
          }
        />
      </Page>
    );
  }

  const facts = factsOf(card, viewer, 'contact');
  return (
    <Page
      title={card.title}
      documentTitle={TAB_TITLE}
      eyebrow={trashed ? `${eyebrow} · в корзине` : eyebrow}
      back={PEOPLE_BACK}
    >
      <p className="property-meta">
        <AccessBadge visibility={visibility} showLabel />
      </p>

      {trashed ? (
        <Notice>
          <strong>Контакт в корзине.</strong>{' '}
          {abilities.restore
            ? 'Его можно вернуть: менять контакт в корзине нельзя.'
            : 'Вернуть его сможет автор-взрослый или администратор. Менять контакт в корзине нельзя.'}
        </Notice>
      ) : null}

      {trashed ? null : <QuickActions phones={data.phones} actions={card.actions} />}

      <section className="section" aria-labelledby={`phones-${card.id}`}>
        <div className="section__head">
          <h2 className="section__title" id={`phones-${card.id}`}>
            Телефоны
          </h2>
          {data.phones.length > 0 ? <span className="muted">{data.phones.length}</span> : null}
        </div>
        <PhoneRows phones={data.phones} actions={card.actions} />
      </section>

      <dl className="facts facts--fields">
        {categories === '' ? null : (
          <div className="facts__item">
            <dt>Категории</dt>
            <dd>{categories}</dd>
          </div>
        )}
        {card.organization === null ? null : (
          <div className="facts__item">
            <dt>Организация</dt>
            <dd>
              <Link to={`/people/contacts/${card.organization.id}`}>{card.organization.title}</Link>
            </dd>
          </div>
        )}
        {card.actions.emails.length === 0 ? null : (
          <div className="facts__item">
            <dt>Почта</dt>
            <dd>
              <span className="facts__stack">
                {data.emails.map((email, index) => (
                  <a key={email} href={card.actions.emails[index]?.href ?? `mailto:${email}`}>
                    {email}
                  </a>
                ))}
              </span>
            </dd>
          </div>
        )}
        {data.messengers.length === 0 ? null : (
          <div className="facts__item">
            <dt>Мессенджеры</dt>
            <dd>
              <span className="facts__stack">
                {data.messengers.map((item) => (
                  <a key={item.url} href={item.url} {...EXTERNAL_LINK}>
                    {item.label === '' ? item.url.replace(/^https?:\/\//, '') : item.label}
                  </a>
                ))}
              </span>
            </dd>
          </div>
        )}
        {data.address === '' ? null : (
          <div className="facts__item">
            <dt>Адрес</dt>
            <dd>{data.address}</dd>
          </div>
        )}
        {data.birthday === null ? null : (
          <div className="facts__item">
            <dt>День рождения</dt>
            <dd>
              {birthdayLabel(data.birthday)}
              {data.birthdayEnabled ? ' · Напоминание включено' : ''}
            </dd>
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
          <dt>Создан</dt>
          <dd>{formatDay(card.createdAt, me.timeZone)}</dd>
        </div>
      </dl>

      <ContactObjects contactId={card.id} contactFacts={facts} canLink={!trashed} />

      <InteractionsSection contactId={card.id} canAdd={abilities.edit && !trashed} />
      {!trashed ? <TrashInteractions contactId={card.id} /> : null}

      <ObjectError error={quick.error} action="person" />
      {!trashed ? (
        <div className="btn-row">
          {abilities.edit ? (
            <button type="button" className="btn btn--primary" onClick={() => setEditing(true)}>
              <PencilSimple size={20} aria-hidden />
              Править
            </button>
          ) : (
            <p className="muted">Этот контакт могут править только взрослые участники дома.</p>
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
