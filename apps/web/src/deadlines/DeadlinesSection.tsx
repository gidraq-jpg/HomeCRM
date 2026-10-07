import { canWriteDeadline } from '@homecrm/shared';
import { PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';
import { Notice, useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { factsOf, type PlacedRecord, viewerOf } from '../notes/abilities.ts';
import { todayIn } from '../objects/dates.ts';
import { Section } from '../ui/Page.tsx';
import { Status } from '../ui/Row.tsx';
import { useToast } from '../ui/Toast.tsx';
import {
  createDeadline,
  type DeadlineItem,
  patchDeadline,
  type SourceKind,
  trashDeadline,
} from './api.ts';
import { DeadlineError } from './components.tsx';
import { DeadlineForm } from './DeadlineForm.tsx';
import { draftFromRule, emptyDraft } from './form.ts';
import {
  describeRule,
  describeWarnings,
  KIND_LABELS,
  nextOccurrence,
  occurrenceRelative,
  occurrenceWhen,
} from './labels.ts';
import { cancelTrash, scheduleTrash, UNDO_MS, usePendingTrash } from './pending.ts';
import { useRefreshDeadlines, useSourceDeadlines } from './queries.ts';

interface DeadlinesSectionProps {
  source: SourceKind;
  card: PlacedRecord & { id: string };
}

type Mode = { kind: 'idle' } | { kind: 'add' } | { kind: 'edit'; id: string };

/** Ближайшее наступление срока одной строкой: «Ближайшее: 5 окт., 9:00 · через 3 дня». */
function Upcoming({ item, timeZone }: { item: DeadlineItem; timeZone: string }) {
  const now = new Date();
  const next = nextOccurrence(item.rule, now, timeZone);
  if (next === null) {
    return (
      <p className="deadline-item__next muted">
        {item.rule.kind === 'after' && item.rule.eventDate === null
          ? 'Ждёт даты события: укажите её, когда событие случится.'
          : 'Ближайших наступлений нет.'}
      </p>
    );
  }
  const timing = { date: next.date, startsAt: next.startsAt, endsAt: next.endsAt };
  const overdue = next.endsAt < now;
  return (
    <p className="deadline-item__next">
      {overdue ? <Status tone="danger">Просрочено</Status> : null}
      <span>
        {overdue ? 'Было' : 'Ближайшее'}: {occurrenceWhen(timing, timeZone, now)} ·{' '}
        {occurrenceRelative(timing, timeZone, now)}
      </span>
    </p>
  );
}

/**
 * Блок «Сроки» в карточке записи (DEAD-1): список сроков с ближайшим наступлением, добавление,
 * правка и «В корзину» с отменой на 7 секунд. Кто может менять срок, решает `canWriteDeadline`
 * из общего пакета правил доступа; сервер и база проверяют то же самое.
 */
export function DeadlinesSection({ source, card }: DeadlinesSectionProps) {
  const { me, householdId } = useHousehold();
  const toast = useToast();
  const refresh = useRefreshDeadlines();
  const query = useSourceDeadlines(source, card.id);
  const hidden = usePendingTrash();
  const save = useAction();
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });

  const viewer = viewerOf(me);
  const trashed = card.deletedAt !== null;
  const canEdit =
    !trashed &&
    canWriteDeadline(viewer, factsOf(card, viewer, source === 'notes' ? 'note' : 'object'));
  const today = todayIn(me.timeZone);
  const items = (query.data ?? []).filter((item) => !hidden.has(item.id));

  function close() {
    save.setError(null);
    setMode({ kind: 'idle' });
  }

  function add(rule: Parameters<typeof createDeadline>[2]) {
    void save.run(async () => {
      await createDeadline(
        source,
        card.id,
        rule,
        card.spaceKind === 'personal' ? householdId : null,
      );
      await refresh();
      close();
      toast.show({ message: 'Срок добавлен' });
    });
  }

  function change(id: string, rule: Parameters<typeof createDeadline>[2]) {
    void save.run(async () => {
      await patchDeadline(id, rule);
      await refresh();
      close();
      toast.show({ message: 'Срок сохранён' });
    });
  }

  function trash(id: string) {
    scheduleTrash(
      id,
      async () => {
        await trashDeadline(id);
        await refresh();
      },
      () =>
        toast.show({
          message: 'Не удалось убрать срок в корзину',
          detail: 'Срок остался на месте. Повторите.',
        }),
    );
    toast.show({
      message: 'Срок в корзине',
      detail: 'Отменить можно в течение 7 секунд',
      durationMs: UNDO_MS,
      action: { label: 'Отменить', onClick: () => cancelTrash(id) },
    });
  }

  let body: ReactNode;
  if (query.isPending) {
    body = <Notice>Загружаем сроки…</Notice>;
  } else if (query.isError) {
    body = (
      <>
        <DeadlineError error={query.error} action="load" />
        <button className="text-button" type="button" onClick={() => void query.refetch()}>
          Повторить загрузку сроков
        </button>
      </>
    );
  } else {
    body = (
      <>
        {items.length === 0 ? (
          mode.kind === 'add' ? null : (
            <p className="muted">
              Сроков пока нет.
              {canEdit
                ? ' Добавьте дату, окно, повтор или срок «через N после события», и он попадёт в радар.'
                : ''}
            </p>
          )
        ) : (
          <ul className="deadline-list" aria-label="Сроки записи">
            {items.map((item) => {
              const label = describeRule(item.rule, today);
              const warnings = describeWarnings(item.rule.warnings);
              if (mode.kind === 'edit' && mode.id === item.id) {
                return (
                  <li className="deadline-item deadline-item--editing" key={item.id}>
                    <DeadlineForm
                      draft={draftFromRule(item.rule, today)}
                      today={today}
                      submitLabel="Сохранить срок"
                      pendingLabel="Сохраняем…"
                      action="save"
                      state={save}
                      onSubmit={(rule) => change(item.id, rule)}
                      onCancel={close}
                    />
                  </li>
                );
              }
              return (
                <li className="deadline-item" key={item.id}>
                  <p className="deadline-item__kind">{KIND_LABELS[item.rule.kind]}</p>
                  <p className="deadline-item__rule">{label}</p>
                  <Upcoming item={item} timeZone={me.timeZone} />
                  {warnings ? (
                    <p className="deadline-item__warn muted">Предупреждение: {warnings}</p>
                  ) : null}
                  {canEdit && mode.kind === 'idle' ? (
                    <div className="deadline-item__tools">
                      <button
                        type="button"
                        className="btn btn--secondary"
                        aria-label={`Править: ${label}`}
                        onClick={() => setMode({ kind: 'edit', id: item.id })}
                      >
                        <PencilSimple size={20} aria-hidden />
                        Править
                      </button>
                      <button
                        type="button"
                        className="btn btn--secondary"
                        aria-label={`В корзину: ${label}`}
                        onClick={() => trash(item.id)}
                      >
                        <Trash size={20} aria-hidden />В корзину
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {mode.kind === 'add' ? (
          <DeadlineForm
            draft={emptyDraft(today)}
            today={today}
            submitLabel="Добавить срок"
            pendingLabel="Добавляем…"
            action="create"
            state={save}
            onSubmit={add}
            onCancel={close}
          />
        ) : canEdit && mode.kind === 'idle' ? (
          <button
            type="button"
            className="btn btn--secondary btn--block deadline-add"
            onClick={() => setMode({ kind: 'add' })}
          >
            <Plus size={20} weight="bold" aria-hidden />
            Добавить срок
          </button>
        ) : null}
        {!canEdit && !trashed ? (
          <p className="muted">Сроки этой записи могут менять только взрослые участники дома.</p>
        ) : null}
      </>
    );
  }

  return (
    <Section
      title="Сроки"
      aside={
        query.isSuccess && items.length > 0 ? (
          <span className="muted">{items.length}</span>
        ) : undefined
      }
    >
      {body}
    </Section>
  );
}
