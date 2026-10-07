import { canWriteLink, type RecordFacts, type Viewer } from '@homecrm/shared';
import { Check, Note, Plus } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { Notice, useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { factsOf, viewerOf } from '../notes/abilities.ts';
import { fetchNotes } from '../notes/api.ts';
import {
  createLink,
  fetchObjects,
  MAX_ROLE,
  type RecordLink,
  type RecordRef,
  restoreLink,
  trashLink,
} from '../objects/api.ts';
import { ObjectError } from '../objects/components.tsx';
import { useLinks, useRefreshObjects } from '../objects/queries.ts';
import { OBJECT_TYPE_ICONS } from '../objects/types.ts';
import { normalizeText } from '../ui/format.ts';
import { RowContent, RowList } from '../ui/Row.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { useToast } from '../ui/Toast.tsx';
import { OTHER_LABELS, routeOf, useEnd } from './ends.ts';

// Связи записей (OBJ-2): «Связано с…» в карточке объекта и заметки. Связь видна только тем, кто
// видит оба конца; сервер скрывает остальные без следа, поэтому здесь ничего не угадывается.

function LinkItem({
  link,
  record,
  facts,
  viewer,
}: {
  link: RecordLink;
  record: RecordRef;
  facts: RecordFacts;
  viewer: Viewer;
}) {
  const toast = useToast();
  const refresh = useRefreshObjects();
  const state = useAction();
  const other =
    link.left.type === record.type && link.left.id === record.id ? link.right : link.left;
  const end = useEnd(other, viewer);
  const to = routeOf(other);
  const EndIcon = end.icon;
  const title = end.title ?? (end.loading ? 'Загружаем…' : (OTHER_LABELS[other.type] ?? 'Запись'));
  const canRemove = end.facts !== null && canWriteLink(viewer, facts, end.facts);

  const content = (
    <RowContent
      icon={<EndIcon size={22} aria-hidden />}
      title={title}
      meta={link.role === '' ? undefined : link.role}
      chevron={to !== null}
    />
  );

  return (
    <li className="link-item">
      {to === null ? (
        <div className="row">{content}</div>
      ) : (
        <Link className="row" to={to}>
          {content}
        </Link>
      )}
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

interface Candidate {
  ref: RecordRef;
  title: string;
  facts: RecordFacts;
  icon: typeof Note;
}

/** Видимые объекты и заметки, которые можно связать с записью. Сначала первая страница каждого списка. */
function useCandidates(enabled: boolean, viewer: Viewer) {
  return useQuery({
    queryKey: ['objects', 'link-candidates'],
    enabled,
    queryFn: async ({ signal }): Promise<Candidate[]> => {
      const [objects, notes] = await Promise.all([
        fetchObjects('all', { trash: false, offset: 0 }, signal),
        fetchNotes('all', { trash: false, offset: 0 }, signal),
      ]);
      return [
        ...objects.map((card) => ({
          ref: { type: 'object', id: card.id },
          title: card.title,
          facts: factsOf(card, viewer, 'object'),
          icon: OBJECT_TYPE_ICONS[card.objectType],
        })),
        ...notes.map((card) => ({
          ref: { type: 'note', id: card.id },
          title: card.title,
          facts: factsOf(card, viewer, 'note'),
          icon: Note,
        })),
      ];
    },
  });
}

function LinkSheet({
  record,
  facts,
  linked,
  viewer,
  onClose,
}: {
  record: RecordRef;
  facts: RecordFacts;
  linked: ReadonlySet<string>;
  viewer: Viewer;
  onClose: () => void;
}) {
  const toast = useToast();
  const refresh = useRefreshObjects();
  const state = useAction();
  const candidates = useCandidates(true, viewer);
  const [filter, setFilter] = useState('');
  const [role, setRole] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const ids = { filter: useId(), role: useId() };

  const needle = normalizeText(filter.trim());
  const available = (candidates.data ?? []).filter(
    (item) =>
      !(item.ref.type === record.type && item.ref.id === record.id) &&
      !linked.has(item.ref.id) &&
      canWriteLink(viewer, facts, item.facts),
  );
  const shown =
    needle === ''
      ? available
      : available.filter((item) => normalizeText(item.title).includes(needle));
  const selected = available.find((item) => item.ref.id === chosen);

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Связать с записью"
      description="Выберите объект или заметку, которые вы видите. Связь увидят только те, кто видит обе записи."
    >
      {candidates.isPending ? <Notice>Загружаем записи…</Notice> : null}
      {candidates.isError ? <ObjectError error={candidates.error} action="load" /> : null}
      {candidates.data && available.length === 0 ? (
        <p className="muted sheet__block">
          Нет записей, которые можно связать: все видимые объекты и заметки уже связаны или вам
          нельзя менять связь с ними.
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
            <p className="muted sheet__block">Ничего не нашли среди загруженных записей.</p>
          ) : (
            <ul className="row-list picker-list" aria-label="Записи, которые можно связать">
              {shown.map((item) => {
                const ItemIcon = item.icon;
                const on = item.ref.id === chosen;
                return (
                  <li key={`${item.ref.type}:${item.ref.id}`}>
                    <button
                      type="button"
                      className="row"
                      aria-pressed={on}
                      onClick={() => setChosen(on ? null : item.ref.id)}
                    >
                      <RowContent
                        icon={<ItemIcon size={22} aria-hidden />}
                        title={item.title}
                        meta={item.ref.type === 'note' ? 'Заметка' : 'Объект'}
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
              Подпись связи (необязательно)
            </label>
            <input
              id={ids.role}
              className="input"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              maxLength={MAX_ROLE}
              autoComplete="off"
              aria-describedby={`${ids.role}-hint`}
            />
            <p className="field__hint" id={`${ids.role}-hint`}>
              Например: «Договор», «Мастер», «Гарантия».
            </p>
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
            await createLink(record, selected.ref, role.trim());
            await refresh();
            toast.show({ message: 'Записи связаны' });
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

/**
 * «Связи» в карточке объекта или заметки. Показывает связанные записи с подписью роли,
 * позволяет связать с другой видимой записью и убрать связь. Корзина связи — отмена 7 секунд.
 */
export function LinksSection({ record, facts }: { record: RecordRef; facts: RecordFacts }) {
  const { me } = useHousehold();
  const viewer = viewerOf(me);
  const query = useLinks(record);
  const [open, setOpen] = useState(false);
  const links = query.data ?? [];
  const linked = new Set(
    links.map((link) =>
      link.left.type === record.type && link.left.id === record.id ? link.right.id : link.left.id,
    ),
  );

  return (
    <section className="section" aria-labelledby={`links-${record.id}`}>
      <div className="section__head">
        <h2 className="section__title" id={`links-${record.id}`}>
          Связи
        </h2>
        {links.length > 0 ? <span className="muted">{links.length}</span> : null}
      </div>
      {query.isPending ? <Notice>Загружаем связи…</Notice> : null}
      {query.isError ? <ObjectError error={query.error} action="load" /> : null}
      {query.data && links.length === 0 ? (
        <p className="muted">Связей пока нет. Свяжите, например, объект с заметкой о ремонте.</p>
      ) : null}
      {links.length > 0 ? (
        <RowList label="Связанные записи">
          {links.map((link) => (
            <LinkItem key={link.id} link={link} record={record} facts={facts} viewer={viewer} />
          ))}
        </RowList>
      ) : null}
      {facts.trashed === true ? null : (
        <button
          type="button"
          className="btn btn--secondary btn--block list-action"
          onClick={() => setOpen(true)}
        >
          <Plus size={20} weight="bold" aria-hidden />
          Связать…
        </button>
      )}
      {open ? (
        <LinkSheet
          record={record}
          facts={facts}
          linked={linked}
          viewer={viewer}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}
