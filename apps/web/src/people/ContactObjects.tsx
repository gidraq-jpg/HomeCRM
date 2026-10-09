import { canWriteLink, type RecordFacts } from '@homecrm/shared';
import { Buildings, Check, Plus } from '@phosphor-icons/react';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { Notice, useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { factsOf, viewerOf } from '../notes/abilities.ts';
import { createLink, MAX_ROLE, type RecordLink, restoreLink, trashLink } from '../objects/api.ts';
import { ObjectError } from '../objects/components.tsx';
import { useLinks, useObjectCard } from '../objects/queries.ts';
import { normalizeText } from '../ui/format.ts';
import { RowContent, RowList } from '../ui/Row.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { useToast } from '../ui/Toast.tsx';
import { useObjectChoices } from './InteractionsSection.tsx';
import { useRefreshContacts } from './queries.ts';

// Связь контакта с объектами (CONT-3): в карточке контакта видны объекты с подписью роли, а новая
// связь добавляется отсюда же. С другой стороны то же самое видно в блоке «Люди и организации».

const CONTACT_TYPE = 'contact';
const ROLE_SUGGESTIONS = ['Мастер', 'Собственник', 'Арендатор', 'Сосед'] as const;

function LinkedObject({ link, contactFacts }: { link: RecordLink; contactFacts: RecordFacts }) {
  const { me } = useHousehold();
  const toast = useToast();
  const refresh = useRefreshContacts();
  const state = useAction();
  const end = link.left.type === 'object' ? link.left : link.right;
  const object = useObjectCard(end.id);
  const viewer = viewerOf(me);
  const canRemove =
    object.data !== undefined &&
    canWriteLink(viewer, contactFacts, factsOf(object.data, viewer, 'object'));

  // Объект, которого читатель не видит, в список не попадает: сервер скрывает такие связи.
  if (object.data === undefined) return null;
  return (
    <li className="link-item">
      <Link className="row" to={`/home/${end.id}`}>
        <RowContent
          icon={<Buildings size={22} aria-hidden />}
          title={object.data.title}
          meta={link.role === '' ? 'Без подписи' : link.role}
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
              await trashLink(link.id);
              await refresh();
              toast.show({
                message: 'Связь убрана',
                action: {
                  label: 'Вернуть',
                  onClick: () => {
                    restoreLink(link.id)
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

function LinkObjectSheet({
  contactId,
  contactFacts,
  linked,
  onClose,
}: {
  contactId: string;
  contactFacts: RecordFacts;
  linked: ReadonlySet<string>;
  onClose: () => void;
}) {
  const { me } = useHousehold();
  const toast = useToast();
  const refresh = useRefreshContacts();
  const state = useAction();
  const options = useObjectChoices(true);
  const [filter, setFilter] = useState('');
  const [role, setRole] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const ids = { filter: useId(), role: useId() };
  const viewer = viewerOf(me);

  const available = (options.data ?? []).filter(
    (item) =>
      !linked.has(item.id) && canWriteLink(viewer, contactFacts, factsOf(item, viewer, 'object')),
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
      title="Связать с объектом"
      description="Выберите объект и подпишите роль: мастер, собственник, арендатор. Связь увидят только те, кто видит и объект, и контакт."
    >
      {options.isPending ? <Notice>Загружаем объекты…</Notice> : null}
      {options.isError ? <ObjectError error={options.error} action="load" /> : null}
      {options.data && available.length === 0 ? (
        <p className="muted sheet__block">
          Нет объектов, которые можно связать: все видимые уже связаны с этим контактом или их ещё
          нет. <Link to="/home">Открыть «Дом»</Link>
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
            <p className="muted sheet__block">Ничего не нашли среди загруженных объектов.</p>
          ) : (
            <ul className="row-list picker-list" aria-label="Объекты, которые можно связать">
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
                        icon={<Buildings size={22} aria-hidden />}
                        title={item.title}
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
              { type: 'object', id: selected.id },
              { type: CONTACT_TYPE, id: contactId },
              role.trim(),
            );
            await refresh();
            toast.show({ message: 'Контакт связан с объектом' });
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

/** «Объекты» в карточке контакта: связанные объекты с подписью роли и «Связать с объектом…». */
export function ContactObjects({
  contactId,
  contactFacts,
  canLink,
}: {
  contactId: string;
  contactFacts: RecordFacts;
  canLink: boolean;
}) {
  const [open, setOpen] = useState(false);
  const links = useLinks({ type: CONTACT_TYPE, id: contactId });
  const items = (links.data ?? []).filter(
    (link) =>
      link.deletedAt === null && (link.left.type === 'object' || link.right.type === 'object'),
  );
  const linked = new Set(
    items.map((link) => (link.left.type === 'object' ? link.left.id : link.right.id)),
  );

  return (
    <section className="section" aria-labelledby={`objects-${contactId}`}>
      <div className="section__head">
        <h2 className="section__title" id={`objects-${contactId}`}>
          Объекты
        </h2>
        {items.length > 0 ? <span className="muted">{items.length}</span> : null}
      </div>
      {links.isPending ? <Notice>Загружаем связи…</Notice> : null}
      {links.isError ? <ObjectError error={links.error} action="load" /> : null}
      {links.data && items.length === 0 ? (
        <p className="muted">
          Пока ни с чем не связан. Свяжите контакт с квартирой, домом или машиной: он появится в
          блоке «Люди и организации» этого объекта.
        </p>
      ) : null}
      {items.length > 0 ? (
        <RowList label="Объекты контакта">
          {items.map((link) => (
            <LinkedObject key={link.id} link={link} contactFacts={contactFacts} />
          ))}
        </RowList>
      ) : null}
      {canLink ? (
        <button
          type="button"
          className="btn btn--secondary btn--block list-action"
          onClick={() => setOpen(true)}
        >
          <Plus size={20} weight="bold" aria-hidden />
          Связать с объектом…
        </button>
      ) : null}
      {open ? (
        <LinkObjectSheet
          contactId={contactId}
          contactFacts={contactFacts}
          linked={linked}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}
