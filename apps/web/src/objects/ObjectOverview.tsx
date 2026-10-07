import { ArrowCounterClockwise, PencilSimple, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AccessBadge } from '../access/AccessBadge.tsx';
import { Notice, useAction } from '../auth/components.tsx';
import { formatDay, formatMoment } from '../auth/dates.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { useMembers } from '../household/queries.ts';
import { LinksSection } from '../links/LinksSection.tsx';
import { factsOf, newPlacement, viewerOf, visibilityOf } from '../notes/abilities.ts';
import { useToast } from '../ui/Toast.tsx';
import { assigneeChoices, creatableObjectVisibilities } from './abilities.ts';
import { createObject, MAX_TITLE, patchObject, restoreObject, trashObject } from './api.ts';
import { ObjectError } from './components.tsx';
import { useObjectContext, usePersonName } from './context.ts';
import { isStaleVersion } from './errors.ts';
import { fromCard, withoutIds } from './fields.ts';
import { ObjectAccess } from './ObjectAccess.tsx';
import { ObjectForm, type ObjectValues } from './ObjectForm.tsx';
import { useRefreshObjects } from './queries.ts';
import { OBJECT_TYPE_LABELS } from './types.ts';

const COPY_SUFFIX = ' (моя версия)';
function copyTitle(title: string): string {
  const base =
    title.length + COPY_SUFFIX.length > MAX_TITLE
      ? title.slice(0, MAX_TITLE - COPY_SUFFIX.length)
      : title;
  return `${base}${COPY_SUFFIX}`;
}

/** «Обзор»: тип, свои поля, автор, ответственный, «Кто видит», связи, правка и корзина. */
export function ObjectOverview() {
  const { card, abilities } = useObjectContext();
  const { me, householdId } = useHousehold();
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshObjects();
  const members = useMembers();
  const nameOf = usePersonName();
  const quick = useAction();
  const save = useAction();
  const [editing, setEditing] = useState(false);
  const [conflict, setConflict] = useState(false);

  const viewer = viewerOf(me);
  const visibility = visibilityOf(card);
  const trashed = card.deletedAt !== null;
  const fields = fromCard(card.fields);
  const assignees = assigneeChoices(viewer, card, members.data ?? []);

  function trash() {
    void quick.run(async () => {
      await trashObject(card.id);
      await refresh();
      navigate('/home');
      toast.show(
        abilities.restore
          ? {
              message: 'Объект в корзине',
              detail: 'Хранится 30 дней',
              action: {
                label: 'Отменить',
                onClick: () => {
                  restoreObject(card.id)
                    .then(() => refresh())
                    .then(() => toast.show({ message: 'Объект возвращён' }))
                    .catch(() =>
                      toast.show({
                        message: 'Не удалось вернуть объект',
                        detail: 'Откройте «Корзину» в разделе «Ещё» и восстановите его там.',
                      }),
                    );
                },
              },
            }
          : {
              message: 'Объект в корзине',
              detail: 'Вернуть его сможет автор-взрослый или администратор. Хранится 30 дней.',
              durationMs: 10_000,
            },
      );
    });
  }

  function restore() {
    void quick.run(async () => {
      await restoreObject(card.id);
      await refresh();
      toast.show({ message: 'Объект возвращён', detail: 'Вместе с полями и событиями ленты.' });
    });
  }

  function saveEdited(values: ObjectValues) {
    void save.run(async () => {
      try {
        await patchObject(card.id, {
          title: values.title,
          objectType: values.objectType,
          fields: values.fields,
          ...(values.assigneeId !== null && values.assigneeId !== card.assigneeId
            ? { assigneeId: values.assigneeId }
            : {}),
          expectedUpdatedAt: card.updatedAt,
        });
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
      toast.show({ message: 'Объект сохранён' });
    });
  }

  function saveAsCopy(values: ObjectValues) {
    // Копия остаётся там же, где объект, если там можно создавать; иначе — в личном.
    const options = creatableObjectVisibilities(viewer, householdId);
    const place = options.includes(visibility) ? visibility : 'personal';
    void save.run(async () => {
      const copy = await createObject(
        {
          title: copyTitle(values.title),
          objectType: values.objectType,
          fields: withoutIds(values.fields),
        },
        newPlacement(place, householdId),
      );
      await refresh();
      setEditing(false);
      setConflict(false);
      toast.show({ message: 'Ваша версия сохранена отдельным объектом' });
      navigate(`/home/${copy.id}`);
    });
  }

  function reload() {
    save.setError(null);
    setConflict(false);
    setEditing(false);
    void refresh();
  }

  if (editing) {
    return (
      <ObjectForm
        draft={{
          title: card.title,
          objectType: card.objectType,
          assigneeId: card.assigneeId,
          fields,
        }}
        mode="edit"
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
        assignees={assignees}
        {...(conflict ? { conflict: { onReload: reload, onSaveCopy: saveAsCopy } } : {})}
      />
    );
  }

  return (
    <>
      <p className="property-meta">
        <AccessBadge visibility={visibility} showLabel />
      </p>

      {trashed ? (
        <Notice>
          <strong>Объект в корзине.</strong>{' '}
          {abilities.restore
            ? 'Его можно вернуть вместе с полями и событиями ленты: менять объект в корзине нельзя.'
            : 'Вернуть его сможет автор-взрослый или администратор. Менять объект в корзине нельзя.'}
        </Notice>
      ) : null}

      <dl className="facts">
        <div className="facts__item">
          <dt>Тип</dt>
          <dd>{OBJECT_TYPE_LABELS[card.objectType]}</dd>
        </div>
        <div className="facts__item">
          <dt>Ответственный</dt>
          <dd>{nameOf(card.assigneeId ?? card.authorId)}</dd>
        </div>
        <div className="facts__item">
          <dt>Автор</dt>
          <dd>{nameOf(card.authorId)}</dd>
        </div>
        <div className="facts__item">
          <dt>Создан</dt>
          <dd>{formatDay(card.createdAt, me.timeZone)}</dd>
        </div>
        <div className="facts__item">
          <dt>Изменён</dt>
          <dd>{formatMoment(card.updatedAt, me.timeZone)}</dd>
        </div>
      </dl>

      <section className="section" aria-labelledby={`fields-${card.id}`}>
        <div className="section__head">
          <h2 className="section__title" id={`fields-${card.id}`}>
            Свои поля
          </h2>
          {fields.length > 0 ? <span className="muted">{fields.length}</span> : null}
        </div>
        {fields.length === 0 ? (
          <p className="muted">
            Своих полей пока нет.
            {abilities.edit && !trashed
              ? ' Нажмите «Править», чтобы добавить, например, «Площадь — 54 м²».'
              : ''}
          </p>
        ) : (
          <dl className="facts facts--fields">
            {fields.map((field) => (
              <div className="facts__item" key={field.key}>
                <dt>{field.name}</dt>
                <dd>{field.value === '' ? '—' : field.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <LinksSection
        record={{ type: 'object', id: card.id }}
        facts={factsOf(card, viewer, 'object')}
      />

      <ObjectError error={quick.error} action="trash" />
      {!trashed ? (
        <div className="btn-row">
          {abilities.edit ? (
            <button type="button" className="btn btn--primary" onClick={() => setEditing(true)}>
              <PencilSimple size={20} aria-hidden />
              Править
            </button>
          ) : (
            <p className="muted">Этот объект могут править только взрослые участники дома.</p>
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

      {!trashed ? <ObjectAccess card={card} abilities={abilities} /> : null}
    </>
  );
}
