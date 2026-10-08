import { canWrite, canWriteLink, type RecordFacts } from '@homecrm/shared';
import { AddressBook, Check, Plus } from '@phosphor-icons/react';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { Notice, useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { factsOf, viewerOf } from '../notes/abilities.ts';
import { CONTACT_TYPE } from '../organizations/abilities.ts';
import { ORGANIZATION_TYPE_LABELS } from '../organizations/form.ts';
import { useOrganizationOptions } from '../organizations/queries.ts';
import { normalizeText } from '../ui/format.ts';
import { RowContent, RowList } from '../ui/Row.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { useToast } from '../ui/Toast.tsx';
import { createLink, MAX_ROLE, type ObjectCard, restoreLink, trashLink } from './api.ts';
import { ObjectError } from './components.tsx';
import { useRefreshObjects } from './queries.ts';

// «Люди и организации» в «Обзоре» объекта (CONT-3). Блок приходит вместе с карточкой объекта:
// сервер отдаёт только живые организации и только связи, у которых виден каждый конец.

/** Типичные подписи связи: нажатие подставляет текст в поле. */
const ROLE_SUGGESTIONS = ['УК', 'Аварийная служба', 'Поставщик', 'Собственник'] as const;

function PersonItem({
  item,
  objectFacts,
}: {
  item: ObjectCard['peopleAndOrganizations'][number];
  objectFacts: RecordFacts;
}) {
  const { me } = useHousehold();
  const toast = useToast();
  const refresh = useRefreshObjects();
  const state = useAction();
  const viewer = viewerOf(me);
  const canRemove = canWriteLink(viewer, objectFacts, factsOf(item.contact, viewer, CONTACT_TYPE));

  return (
    <li className="link-item">
      <Link className="row" to={`/more/organizations/${item.contact.id}`}>
        <RowContent
          icon={<AddressBook size={22} aria-hidden />}
          title={item.contact.title}
          meta={
            item.role === ''
              ? ORGANIZATION_TYPE_LABELS[item.contact.data.organizationType]
              : item.role
          }
          chevron
        />
      </Link>
      {canRemove ? (
        <button
          type="button"
          className="btn btn--secondary"
          disabled={state.disabled}
          onClick={() =>
            void state.run(async () => {
              await trashLink(item.linkId);
              await refresh();
              toast.show({
                message: 'Связь убрана',
                action: {
                  label: 'Вернуть',
                  onClick: () => {
                    restoreLink(item.linkId)
                      .then(() => refresh())
                      .then(() => toast.show({ message: 'Связь возвращена' }))
                      .catch(() => toast.show({ message: 'Не удалось вернуть связь' }));
                  },
                },
              });
            })
          }
        >
          {state.pending ? 'Убираем…' : 'Убрать связь'}
        </button>
      ) : null}
      <ObjectError error={state.error} action="link" />
    </li>
  );
}

function LinkOrganizationSheet({
  card,
  objectFacts,
  linked,
  onClose,
}: {
  card: ObjectCard;
  objectFacts: RecordFacts;
  linked: ReadonlySet<string>;
  onClose: () => void;
}) {
  const { me } = useHousehold();
  const toast = useToast();
  const refresh = useRefreshObjects();
  const state = useAction();
  const options = useOrganizationOptions();
  const [filter, setFilter] = useState('');
  const [role, setRole] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const ids = { filter: useId(), role: useId() };
  const viewer = viewerOf(me);

  const available = (options.data ?? []).filter(
    (item) =>
      !linked.has(item.id) &&
      canWriteLink(viewer, objectFacts, factsOf(item, viewer, CONTACT_TYPE)),
  );
  const needle = normalizeText(filter.trim());
  const shown =
    needle === ''
      ? available
      : available.filter((item) => normalizeText(item.title).includes(needle));
  const selected = available.find((item) => item.id === chosen);

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Связать с организацией"
      description="Выберите организацию и подпишите роль: УК, поставщик, аварийная служба. Связь увидят только те, кто видит и объект, и организацию."
    >
      {options.isPending ? <Notice>Загружаем организации…</Notice> : null}
      {options.isError ? <ObjectError error={options.error} action="load" /> : null}
      {options.data && available.length === 0 ? (
        <p className="muted sheet__block">
          Нет организаций, которые можно связать: все видимые уже связаны с этим объектом или их ещё
          нет. <Link to="/more/organizations">Открыть «Организации»</Link>
        </p>
      ) : null}
      {available.length > 0 ? (
        <>
          <div className="field">
            <label className="field__label" htmlFor={ids.filter}>
              Найти по названию
            </label>
            <input
              id={ids.filter}
              className="input"
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              autoComplete="off"
              maxLength={200}
            />
          </div>
          {shown.length === 0 ? (
            <p className="muted sheet__block">Ничего не нашли среди загруженных организаций.</p>
          ) : (
            <ul className="row-list picker-list" aria-label="Организации, которые можно связать">
              {shown.map((item) => {
                const on = item.id === chosen;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="row"
                      aria-pressed={on}
                      onClick={() => setChosen(on ? null : item.id)}
                    >
                      <RowContent
                        icon={<AddressBook size={22} aria-hidden />}
                        title={item.title}
                        meta={ORGANIZATION_TYPE_LABELS[item.data.organizationType]}
                        aside={on ? <Check size={20} weight="bold" aria-hidden /> : undefined}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="field">
            <label className="field__label" htmlFor={ids.role}>
              Подпись связи (роль)
            </label>
            <input
              id={ids.role}
              className="input"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              maxLength={MAX_ROLE}
              autoComplete="off"
            />
            <fieldset className="role-suggestions">
              <legend className="visually-hidden">Частые подписи</legend>
              {ROLE_SUGGESTIONS.map((suggestion) => (
                <button
                  type="button"
                  className="chip-button"
                  key={suggestion}
                  onClick={() => setRole(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </fieldset>
          </div>
        </>
      ) : null}
      <ObjectError error={state.error} action="link" />
      <button
        type="button"
        className="btn btn--primary btn--block sheet__next"
        disabled={state.disabled || selected === undefined}
        onClick={() =>
          void state.run(async () => {
            if (!selected) return;
            await createLink(
              { type: 'object', id: card.id },
              { type: CONTACT_TYPE, id: selected.id },
              role.trim(),
            );
            await refresh();
            toast.show({ message: 'Организация связана с объектом' });
            onClose();
          })
        }
      >
        {state.pending ? 'Связываем…' : 'Связать'}
      </button>
      <button type="button" className="btn btn--secondary btn--block sheet__next" onClick={onClose}>
        Отмена
      </button>
    </Sheet>
  );
}

/** Блок «Люди и организации» карточки объекта: связанные организации с подписью роли. */
export function PeopleBlock({ card }: { card: ObjectCard }) {
  const { me } = useHousehold();
  const [open, setOpen] = useState(false);
  const viewer = viewerOf(me);
  const objectFacts = factsOf(card, viewer, 'object');
  const items = card.peopleAndOrganizations;
  const linked = new Set(items.map((item) => item.contact.id));
  const trashed = card.deletedAt !== null;
  const options = useOrganizationOptions(!trashed);
  // Кнопка только тем, кто может связать: пишет в объект или в одну из видимых организаций.
  const canLink =
    !trashed &&
    (canWrite(viewer, objectFacts) ||
      (options.data ?? []).some(
        (item) =>
          !linked.has(item.id) &&
          canWriteLink(viewer, objectFacts, factsOf(item, viewer, CONTACT_TYPE)),
      ));

  return (
    <section className="section" aria-labelledby={`people-${card.id}`}>
      <div className="section__head">
        <h2 className="section__title" id={`people-${card.id}`}>
          Люди и организации
        </h2>
        {items.length > 0 ? <span className="muted">{items.length}</span> : null}
      </div>
      {items.length === 0 ? (
        <p className="muted">
          Пока никого нет. Свяжите, например, управляющую компанию и аварийную службу: их телефоны
          будут под рукой.
        </p>
      ) : (
        <RowList label="Люди и организации">
          {items.map((item) => (
            <PersonItem key={item.linkId} item={item} objectFacts={objectFacts} />
          ))}
        </RowList>
      )}
      {canLink ? (
        <button
          type="button"
          className="btn btn--secondary btn--block list-action"
          onClick={() => setOpen(true)}
        >
          <Plus size={20} weight="bold" aria-hidden />
          Связать с организацией…
        </button>
      ) : null}
      {open ? (
        <LinkOrganizationSheet
          card={card}
          objectFacts={objectFacts}
          linked={linked}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}
