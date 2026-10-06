import {
  ArrowCounterClockwise,
  PencilSimple,
  PushPin,
  PushPinSlash,
  Trash,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AccessBadge } from '../access/AccessBadge.tsx';
import { Notice, useAction } from '../auth/components.tsx';
import { formatDay, formatMoment } from '../auth/dates.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { useMembers } from '../household/queries.ts';
import { CheckToggle } from '../ui/CheckToggle.tsx';
import { Page, Section } from '../ui/Page.tsx';
import { useToast } from '../ui/Toast.tsx';
import {
  creatableVisibilities,
  newPlacement,
  noteAbilities,
  viewerOf,
  visibilityOf,
} from './abilities.ts';
import {
  createNote,
  MAX_TITLE,
  type NoteCard,
  type NoteInput,
  patchNote,
  restoreNote,
  trashNote,
} from './api.ts';
import { fromCard, progress, toInput } from './checklist.ts';
import { NoteError } from './components.tsx';
import { isStaleVersion } from './errors.ts';
import { Markdown } from './markdown.tsx';
import { NoteAccess } from './NoteAccess.tsx';
import { NoteForm } from './NoteForm.tsx';
import { useNoteCard, useRefreshNotes } from './queries.ts';

const BACK = { to: '/more/notes', label: 'Заметки' } as const;
/** Название вкладки одинаковое для всех заметок: заголовок в историю браузера не попадает. */
const TAB_TITLE = 'Заметка';

const COPY_SUFFIX = ' (моя версия)';
function copyTitle(title: string): string {
  const base =
    title.length + COPY_SUFFIX.length > MAX_TITLE
      ? title.slice(0, MAX_TITLE - COPY_SUFFIX.length)
      : title;
  return `${base}${COPY_SUFFIX}`;
}

/** Карточка заметки: просмотр, правка, чек-лист, закрепление, корзина и «Кто видит». */
export function NoteScreen() {
  const { noteId } = useParams();
  const query = useNoteCard(noteId);

  if (query.isPending) {
    return (
      <Page title="Заметка" back={BACK} documentTitle={TAB_TITLE}>
        <Notice>Загружаем заметку…</Notice>
      </Page>
    );
  }
  if (query.isError) {
    return (
      <Page title="Заметка" back={BACK} documentTitle={TAB_TITLE}>
        <NoteError error={query.error} action="load" />
        <button className="text-button" type="button" onClick={() => void query.refetch()}>
          Повторить загрузку заметки
        </button>
      </Page>
    );
  }
  return <NoteView card={query.data} />;
}

function NoteView({ card }: { card: NoteCard }) {
  const { me, householdId } = useHousehold();
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshNotes();
  const members = useMembers();
  const quick = useAction();
  const save = useAction();
  const [editing, setEditing] = useState(false);
  const [conflict, setConflict] = useState(false);

  const viewer = viewerOf(me);
  const abilities = noteAbilities(viewer, card, householdId);
  const visibility = visibilityOf(card);
  const trashed = card.deletedAt !== null;
  const items = fromCard(card.checklist);
  const done = progress(items);
  const author =
    card.authorId === me.id
      ? 'вы'
      : (members.data?.find((member) => member.accountId === card.authorId)?.displayName ??
        'участник дома');

  /** Быстрое действие над готовой заметкой. Если её успели изменить, показываем свежую версию. */
  async function patch(change: Parameters<typeof patchNote>[1]) {
    try {
      await patchNote(card.id, { ...change, expectedUpdatedAt: card.updatedAt });
    } catch (error) {
      if (!isStaleVersion(error)) throw error;
      await refresh();
      toast.show({
        message: 'Заметку изменили на другом устройстве',
        detail: 'Показана свежая версия. Повторите действие.',
      });
      return;
    }
    await refresh();
  }

  function toggleItem(key: string) {
    void quick.run(() =>
      patch({
        checklist: toInput(
          items.map((item) => (item.key === key ? { ...item, done: !item.done } : item)),
        ),
      }),
    );
  }

  function trash() {
    void quick.run(async () => {
      await trashNote(card.id);
      await refresh();
      navigate('/more/notes');
      toast.show(
        abilities.restore
          ? {
              message: 'Заметка в корзине',
              detail: 'Хранится 30 дней',
              action: {
                label: 'Отменить',
                onClick: () => {
                  restoreNote(card.id)
                    .then(() => refresh())
                    .then(() => toast.show({ message: 'Заметка возвращена' }))
                    .catch(() =>
                      toast.show({
                        message: 'Не удалось вернуть заметку',
                        detail: 'Откройте «Корзину» в разделе «Ещё» и восстановите её там.',
                      }),
                    );
                },
              },
            }
          : {
              message: 'Заметка в корзине',
              detail: 'Вернуть её сможет автор-взрослый или администратор. Хранится 30 дней.',
              durationMs: 10_000,
            },
      );
    });
  }

  function restore() {
    void quick.run(async () => {
      await restoreNote(card.id);
      await refresh();
      toast.show({ message: 'Заметка возвращена' });
    });
  }

  function saveEdited(values: NoteInput) {
    void save.run(async () => {
      try {
        await patchNote(card.id, { ...values, expectedUpdatedAt: card.updatedAt });
      } catch (error) {
        if (isStaleVersion(error)) {
          setConflict(true);
          return;
        }
        throw error;
      }
      await refresh();
      setEditing(false);
      setConflict(false);
      toast.show({ message: 'Заметка сохранена' });
    });
  }

  function saveAsCopy(values: NoteInput) {
    // Копия остаётся там же, где заметка, если там можно создавать; иначе — в личном.
    const options = creatableVisibilities(viewer, householdId);
    const place = options.includes(visibility) ? visibility : 'personal';
    void save.run(async () => {
      const copy = await createNote(
        { ...values, title: copyTitle(values.title) },
        newPlacement(place, householdId),
      );
      await refresh();
      setEditing(false);
      setConflict(false);
      toast.show({ message: 'Ваша версия сохранена отдельной заметкой' });
      navigate(`/more/notes/${copy.id}`);
    });
  }

  function reload() {
    save.setError(null);
    setConflict(false);
    setEditing(false);
    void refresh();
  }

  return (
    <Page
      title={card.title}
      documentTitle={TAB_TITLE}
      eyebrow={`Изменена ${formatMoment(card.updatedAt, me.timeZone)}`}
      back={BACK}
    >
      {editing ? (
        <NoteForm
          draft={{ title: card.title, body: card.body, pinned: card.pinned, checklist: items }}
          submitLabel="Сохранить"
          pendingLabel="Сохраняем…"
          action="save"
          state={save}
          onSubmit={saveEdited}
          onCancel={() => {
            save.setError(null);
            setConflict(false);
            setEditing(false);
          }}
          {...(conflict ? { conflict: { onReload: reload, onSaveCopy: saveAsCopy } } : {})}
        />
      ) : (
        <>
          <p className="property-meta">
            <AccessBadge visibility={visibility} showLabel />
            {card.pinned ? (
              <span className="access-badge access-badge--labeled">
                <PushPin size={18} weight="fill" aria-hidden />
                <span>Закреплена</span>
              </span>
            ) : null}
          </p>

          {trashed ? (
            <Notice>
              <strong>Заметка в корзине.</strong>{' '}
              {abilities.restore
                ? 'Её можно вернуть: менять заметку в корзине нельзя.'
                : 'Вернуть её сможет автор-взрослый или администратор. Менять заметку в корзине нельзя.'}
            </Notice>
          ) : null}

          {card.body.trim() === '' ? (
            <p className="muted">Текста нет.</p>
          ) : (
            <Markdown source={card.body} />
          )}

          {items.length > 0 ? (
            <Section
              title="Чек-лист"
              aside={
                <span className="muted">
                  Выполнено {done.done} из {done.total}
                </span>
              }
            >
              <ul className="task-list">
                {items.map((item) => (
                  <li key={item.key} className={item.done ? 'task-row task-row--done' : 'task-row'}>
                    <CheckToggle
                      checked={item.done}
                      label={item.title}
                      disabled={!abilities.edit || quick.disabled}
                      onChange={() => toggleItem(item.key)}
                    />
                    <span className="task-row__body task-row__body--static">
                      <span className="row__title">{item.title}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <NoteError error={quick.error} action="toggle" />

          {visibility !== 'personal' ? (
            <dl className="facts">
              <div className="facts__item">
                <dt>Автор</dt>
                <dd>{author === 'вы' ? 'Вы' : author}</dd>
              </div>
              <div className="facts__item">
                <dt>Создана</dt>
                <dd>{formatDay(card.createdAt, me.timeZone)}</dd>
              </div>
            </dl>
          ) : null}

          {!trashed ? (
            <div className="btn-row">
              {abilities.edit ? (
                <>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => setEditing(true)}
                  >
                    <PencilSimple size={20} aria-hidden />
                    Править
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    aria-pressed={card.pinned}
                    disabled={quick.disabled}
                    onClick={() => void quick.run(() => patch({ pinned: !card.pinned }))}
                  >
                    {card.pinned ? (
                      <PushPinSlash size={20} aria-hidden />
                    ) : (
                      <PushPin size={20} aria-hidden />
                    )}
                    {card.pinned ? 'Открепить' : 'Закрепить'}
                  </button>
                </>
              ) : (
                <p className="muted">Эту заметку могут править только взрослые участники дома.</p>
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

          {!trashed ? <NoteAccess card={card} abilities={abilities} /> : null}
        </>
      )}
    </Page>
  );
}
