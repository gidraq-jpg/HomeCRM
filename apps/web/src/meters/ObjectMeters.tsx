import { ArrowsClockwise, Gauge, PencilLine, PencilSimple, Plus } from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import type { AccountCard } from '../accounts/api.ts';
import { useAccounts } from '../accounts/queries.ts';
import { Notice, useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { ObjectError } from '../objects/components.tsx';
import { useObjectContext } from '../objects/context.ts';
import { todayIn } from '../objects/dates.ts';
import { CopyButton } from '../ui/CopyButton.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import {
  type DateOnly,
  daysBetween,
  formatFullDate,
  formatRelativeDays,
  formatShortDate,
} from '../ui/format.ts';
import { Status } from '../ui/Row.tsx';
import { useToast } from '../ui/Toast.tsx';
import { createMeter, type MeterListItem, patchMeter } from './api.ts';
import { showDecimal } from './decimal.ts';
import { meterCount, RESOURCE_LABELS, RESOURCE_UNITS, STATE_LABELS } from './labels.ts';
import { CreateMeterForm, EditMeterForm, ReplaceSheet } from './MeterForms.tsx';
import { useMeters, useRefreshMeters } from './queries.ts';

/** Показание по зонам одной строкой: «123,456» или «День 100,0 · Ночь 50,0». */
export function readingText(item: MeterListItem): string | null {
  const reading = item.previousReading;
  if (reading === null) return null;
  const unit = item.data.unit ?? RESOURCE_UNITS[item.data.resource];
  const values = reading.values.map((value, index) => {
    const zone = item.data.zones.length > 1 ? `${item.data.zones[index] ?? ''} ` : '';
    return `${zone}${showDecimal(value)}`;
  });
  return `${values.join(' · ')} ${unit}`;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="facts__item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Состояние поверки: просрочена или скоро. Дальше двух месяцев — просто дата. */
function VerificationStatus({ next, today }: { next: string; today: DateOnly }) {
  const days = daysBetween(today, next as DateOnly);
  if (days < 0) return <Status tone="danger">Поверка просрочена</Status>;
  if (days <= 60) return <Status tone="warning">Поверка {formatRelativeDays(days)}</Status>;
  return null;
}

function MeterItem({
  item,
  all,
  accounts,
  canEdit,
  busy,
  objectId,
  onBusy,
}: {
  item: MeterListItem;
  all: readonly MeterListItem[];
  accounts: readonly AccountCard[];
  canEdit: boolean;
  busy: boolean;
  objectId: string;
  onBusy: (busy: boolean) => void;
}) {
  const { me } = useHousehold();
  const toast = useToast();
  const refresh = useRefreshMeters();
  const save = useAction();
  const [editing, setEditing] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const today = todayIn(me.timeZone);
  const { data } = item;
  const active = data.status === 'active';
  const account = accounts.find((candidate) => candidate.id === item.utilityAccountId);
  const successor = all.find((candidate) => candidate.previousMeterId === item.id);
  const reading = readingText(item);

  function submit(patch: Parameters<typeof patchMeter>[1]) {
    void save.run(async () => {
      await patchMeter(item.id, { ...patch, expectedUpdatedAt: item.updatedAt });
      await refresh();
      setEditing(false);
      onBusy(false);
      toast.show({ message: 'Счётчик сохранён' });
    });
  }

  if (editing) {
    return (
      <li className="card meter-card">
        <h3 className="card__title">Правка: {item.title}</h3>
        <EditMeterForm
          card={item}
          hasReadings={item.previousReading !== null}
          accounts={accounts}
          state={save}
          submitLabel="Сохранить"
          pendingLabel="Сохраняем…"
          onSubmit={submit}
          onCancel={() => {
            save.setError(null);
            setEditing(false);
            onBusy(false);
          }}
        />
      </li>
    );
  }

  return (
    <li className="card meter-card">
      <div className="meter-card__head">
        <h3 className="card__title">{item.title}</h3>
        {active ? null : <Status tone="neutral">{STATE_LABELS[data.status]}</Status>}
        {active && data.nextVerificationOn ? (
          <VerificationStatus next={data.nextVerificationOn} today={today} />
        ) : null}
      </div>
      <dl className="facts facts--fields">
        <Fact label="Ресурс">{RESOURCE_LABELS[data.resource]}</Fact>
        {data.installationPlace === '' ? null : <Fact label="Место">{data.installationPlace}</Fact>}
        {data.serialNumber === '' ? null : (
          <Fact label="Заводской номер">
            <span className="mono">{data.serialNumber}</span>
            <CopyButton value={data.serialNumber} what="заводской номер" />
          </Fact>
        )}
        {data.model === '' ? null : <Fact label="Модель">{data.model}</Fact>}
        {data.zones.length > 1 ? <Fact label="Зоны">{data.zones.join(', ')}</Fact> : null}
        <Fact label="Лицевой счёт">
          {account === undefined ? (
            'не указан'
          ) : (
            <>
              {account.title}
              {account.data.number === '' ? '' : `, ${account.data.number}`}
            </>
          )}
        </Fact>
        <Fact label="Последнее показание">
          {reading === null || item.previousReading === null ? (
            'ещё не вводили'
          ) : (
            <span>
              {reading}
              <span className="muted">
                {' · '}
                {formatShortDate(item.previousReading.occurredOn as DateOnly, today)}
              </span>
            </span>
          )}
        </Fact>
        <Fact label="Следующая поверка">
          {data.nextVerificationOn
            ? formatFullDate(data.nextVerificationOn as DateOnly)
            : 'не указана'}
        </Fact>
        {data.status === 'replaced' && successor !== undefined ? (
          <Fact label="Заменён на">{successor.title}</Fact>
        ) : null}
      </dl>
      <ObjectError error={save.error} action="meter" />
      {canEdit && active ? (
        <div className="btn-row">
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={() => {
              onBusy(true);
              setEditing(true);
            }}
          >
            <PencilSimple size={20} aria-hidden />
            Править
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={() => setReplacing(true)}
          >
            <ArrowsClockwise size={20} aria-hidden />
            Заменить счётчик
          </button>
        </div>
      ) : null}
      {replacing ? (
        <ReplaceSheet objectId={objectId} old={item} onClose={() => setReplacing(false)} />
      ) : null}
    </li>
  );
}

/**
 * Вкладка «Счётчики» карточки недвижимости (UTIL-3, UTIL-6, UTIL-14): работающие счётчики с
 * последним показанием и поверкой; заменённые и снятые — в свёрнутой группе.
 */
export function ObjectMeters() {
  const { card, abilities } = useObjectContext();
  const toast = useToast();
  const refresh = useRefreshMeters();
  const query = useMeters(card.id, 'all');
  const accounts = useAccounts(card.id);
  const create = useAction();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const trashed = card.deletedAt !== null;
  const canEdit = abilities.edit && !trashed;

  if (card.objectType !== 'property') {
    return <Notice>Счётчики есть только у недвижимости.</Notice>;
  }

  const all = query.data ?? [];
  const active = all.filter((item) => item.data.status === 'active');
  const archived = all.filter((item) => item.data.status !== 'active');
  const accountList = accounts.data ?? [];

  function submit(input: Parameters<typeof createMeter>[1]) {
    void create.run(async () => {
      await createMeter(card.id, input);
      await refresh();
      setAdding(false);
      toast.show({ message: 'Счётчик сохранён' });
    });
  }

  return (
    <section className="section" aria-labelledby={`meters-${card.id}`}>
      <div className="section__head">
        <h2 className="section__title" id={`meters-${card.id}`}>
          Счётчики
        </h2>
        {active.length > 0 ? <span className="muted">{meterCount(active.length)}</span> : null}
      </div>

      {trashed ? (
        <Notice>
          Объект в корзине: счётчики можно только смотреть. Они вернутся вместе с ним.
        </Notice>
      ) : null}
      {query.isPending ? <Notice>Загружаем счётчики…</Notice> : null}
      {query.isError ? (
        <>
          <ObjectError error={query.error} action="load" />
          <button className="text-button" type="button" onClick={() => void query.refetch()}>
            Повторить загрузку счётчиков
          </button>
        </>
      ) : null}

      {active.length > 0 && !trashed ? (
        <Link className="btn btn--primary btn--block" to={`/home/${card.id}/readings`}>
          <PencilLine size={20} aria-hidden />
          {canEdit ? 'Ввести показания' : 'Показания'}
        </Link>
      ) : null}

      {adding ? (
        <div className="card meter-card">
          <h3 className="card__title">Новый счётчик</h3>
          <CreateMeterForm
            accounts={accountList}
            state={create}
            submitLabel="Сохранить"
            pendingLabel="Сохраняем…"
            onSubmit={submit}
            onCancel={() => {
              create.setError(null);
              setAdding(false);
            }}
          />
        </div>
      ) : null}

      {query.data && all.length === 0 && !adding ? (
        <EmptyState
          icon={<Gauge size={24} aria-hidden />}
          title="Счётчиков пока нет"
          actions={
            canEdit ? (
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={() => setAdding(true)}
              >
                <Plus size={20} weight="bold" aria-hidden />
                Добавить счётчик
              </button>
            ) : null
          }
        >
          <p>
            Достаточно ресурса и последнего показания: заводской номер, место и поверку можно
            добавить позже. Счётчики видят те же люди, что и объект.
          </p>
        </EmptyState>
      ) : null}

      {active.length > 0 ? (
        <ul className="card-list" aria-label="Счётчики">
          {active.map((item) => (
            <MeterItem
              key={item.id}
              item={item}
              all={all}
              accounts={accountList}
              canEdit={canEdit && !adding}
              busy={busy}
              objectId={card.id}
              onBusy={setBusy}
            />
          ))}
        </ul>
      ) : null}

      {canEdit && !adding && all.length > 0 ? (
        <button
          type="button"
          className="btn btn--secondary btn--block list-action"
          disabled={busy}
          onClick={() => setAdding(true)}
        >
          <Plus size={20} weight="bold" aria-hidden />
          Добавить счётчик
        </button>
      ) : null}

      {archived.length > 0 ? (
        <details className="meter-archive">
          <summary>Заменённые и снятые ({archived.length})</summary>
          <ul className="card-list" aria-label="Заменённые и снятые счётчики">
            {archived.map((item) => (
              <MeterItem
                key={item.id}
                item={item}
                all={all}
                accounts={accountList}
                canEdit={false}
                busy={busy}
                objectId={card.id}
                onBusy={setBusy}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
