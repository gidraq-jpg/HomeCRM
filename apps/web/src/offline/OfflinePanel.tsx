import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { Notice, useAction, useOnline } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { ReadingCard } from '../meters/api.ts';
import { Link } from '../shell/motion.tsx';
import { formatDateOnly } from '../tasks/fields.tsx';
import { Page, Section } from '../ui/Page.tsx';
import { localMessage, offlineEvents, ticket } from './identity.ts';
import { cancelIntent, enqueue, resolveConflict, retryIntent, synchronize } from './queue.ts';
import { snapshotRequest } from './snapshots.ts';
import { type Intent, offlineDB } from './store.ts';

export function useQueue() {
  const { me } = useHousehold();
  const [rows, setRows] = useState<Intent[]>([]);
  const [snapTime, setSnapTime] = useState<number | null>(null);
  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      const active = await ticket();
      if (active.owner !== me.id) {
        if (mounted) setRows([]);
        return;
      }
      const list = await offlineDB.outbox.where('owner').equals(me.id).sortBy('createdAt');
      const snaps = await offlineDB.snapshots.where('owner').equals(me.id).sortBy('capturedAt');
      if (mounted) {
        setRows(list);
        setSnapTime(snaps.at(-1)?.capturedAt ?? null);
      }
    };
    const update = () =>
      void refresh().catch(() => {
        offlineEvents.dispatchEvent(new Event('storage-error'));
      });
    update();
    offlineEvents.addEventListener('queue', update);
    offlineEvents.addEventListener('snapshot', update);
    offlineEvents.addEventListener('identity', update);
    return () => {
      mounted = false;
      offlineEvents.removeEventListener('queue', update);
      offlineEvents.removeEventListener('snapshot', update);
      offlineEvents.removeEventListener('identity', update);
    };
  }, [me.id]);
  return { rows, snapTime };
}
export function OfflineBridge() {
  const { rows, snapTime } = useQueue();
  const online = useOnline();
  const client = useQueryClient();
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    const update = () => setStorageError(true);
    const sync = () => {
      if (navigator.onLine)
        void synchronize().catch((error) => {
          if (!(error instanceof Error && error.message === 'ACCOUNT_CHANGED'))
            setStorageError(true);
        });
    };
    const confirmed = () => {
      void client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'me' });
    };
    window.addEventListener('online', sync);
    offlineEvents.addEventListener('storage-error', update);
    offlineEvents.addEventListener('queue', confirmed);
    const timer = window.setInterval(sync, 15000);
    sync();
    navigator.serviceWorker?.ready
      .then((registration) => {
        registration.active?.postMessage({ type: 'HOMECRM_SYNC' });
      })
      .catch(() => {});
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', sync);
      offlineEvents.removeEventListener('storage-error', update);
      offlineEvents.removeEventListener('queue', confirmed);
    };
  }, [client]);
  const pending = rows.filter((row) => row.state !== 'confirmed');
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (pending.length) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [pending.length]);
  return (
    <div className="offline-status">
      {!online && snapTime ? (
        <span>
          Последнее сохранение на устройстве: {new Date(snapTime).toLocaleString('ru-RU')}. Данные
          могут измениться на сервере.
        </span>
      ) : null}
      {pending.length || !online ? (
        <Link to="/more/offline">
          Очередь изменений{pending.length ? ` · ${pending.length}` : ''}
        </Link>
      ) : null}
      {storageError ? (
        <Notice error>
          Не удалось обновить данные на устройстве. Чтение без сети может быть недоступно.
        </Notice>
      ) : null}
    </div>
  );
}
const STATES: Record<Intent['state'], string> = {
  pending: 'В очереди',
  sending: 'Отправляется',
  unknown: 'Исход неизвестен',
  confirmed: 'Подтверждено',
  conflict: 'Нужно решение',
  error: 'Ошибка',
};
const KINDS: Record<string, string> = {
  task_create: 'Новое дело',
  task_patch: 'Правка дела',
  task_status: 'Выполнение дела',
  note_create: 'Новая заметка',
  note_patch: 'Правка заметки',
  file_upload: 'Фото показания',
  reading_create: 'Показание',
  readings_create: 'Показания',
};
export function OfflinePanel() {
  const { rows } = useQueue();
  const state = useAction(true);
  const online = useOnline();
  const [editing, setEditing] = useState<string | null>(null);
  const [current, setCurrent] = useState<Record<string, unknown> | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [serverReadings, setServerReadings] = useState<Record<string, ReadingCard[]>>({});
  function edit(row: Intent) {
    setEditing(row.id);
    setCurrent(null);
    setTitle(String(row.body.title ?? ''));
    setText(String(row.body.body ?? row.body.description ?? ''));
    if (row.state === 'conflict' && online)
      void state.run(async () => {
        const path = row.frozenPath ?? row.path;
        const base = path.replace(/\/status$/, '');
        setCurrent(await snapshotRequest(base, z.record(z.string(), z.unknown())));
      });
  }
  function save(row: Intent) {
    const changes = {
      title,
      ...(row.operation.startsWith('note') ? { body: text } : { description: text }),
    };
    void state.run(async () => {
      if (row.state === 'conflict') {
        if (!current || typeof current.updatedAt !== 'string') return;
        await resolveConflict(row.id, changes, current.updatedAt);
      } else {
        const create = row.operation.endsWith('_create');
        const base = create
          ? row
          : rows.find(
              (other) => other.entity === row.entity && other.operation.endsWith('_create'),
            );
        const entity = base?.id;
        const path = row.operation.startsWith('note') ? 'notes' : 'tasks';
        await enqueue(
          'PATCH',
          `${path}/${entity ? `local:${entity}` : row.path.split('/')[1]}`,
          changes,
          { ...(entity ? { idFrom: entity } : {}), baseFrom: row.id },
        );
      }
      setEditing(null);
      if (online) await synchronize();
    });
  }
  const pending = rows.filter((row) => row.state !== 'confirmed');
  const confirmed = rows.filter((row) => row.state === 'confirmed').slice(-10);
  return (
    <Page title="Очередь изменений" back={{ to: '/more', label: 'Ещё' }}>
      <Notice>Сохранено на устройстве. Сервер подтверждает каждое изменение отдельно.</Notice>
      <p className="muted">
        Сохранённое на устройстве станет серверной записью после подтверждения. Один конфликт не
        мешает другим записям.
      </p>
      <button
        className="btn btn--primary"
        type="button"
        disabled={state.pending || !online}
        onClick={() => void state.run(synchronize)}
      >
        Синхронизировать
      </button>
      {state.error ? (
        <Notice error>
          {localMessage(state.error) ?? 'Не удалось выполнить действие. Локальный ввод сохранён.'}
        </Notice>
      ) : null}
      <Section title="Ожидают подтверждения">
        {pending.length === 0 ? (
          <p className="muted">Неотправленных изменений нет.</p>
        ) : (
          pending.map((row) => {
            const blocked = row.dependencies.some(
              (id) => rows.find((dep) => dep.id === id)?.state !== 'confirmed',
            );
            const readingRows = (
              row.operation === 'readings_create'
                ? row.body.readings
                : row.operation === 'reading_create'
                  ? [{ ...row.body, meterId: row.path.split('/')[1] }]
                  : []
            ) as Record<string, unknown>[];
            const editable = ['task_create', 'task_patch', 'note_create', 'note_patch'].includes(
              row.operation,
            );
            return (
              <article className="offline-queue-item" key={row.id}>
                <h3>{String(row.body.title ?? KINDS[row.operation] ?? 'Изменение')}</h3>
                <p role="status">
                  {STATES[row.state]}
                  {blocked ? ' · Ожидает предыдущего изменения' : ''}
                </p>
                {row.house ? <p className="muted">Привязано к исходному дому.</p> : null}
                {row.code ? (
                  <p className="muted">
                    {row.code === 'SIGN_IN_REQUIRED'
                      ? 'Нужен вход в прежнюю учётную запись.'
                      : row.state === 'conflict'
                        ? 'Серверная версия или база показания изменилась.'
                        : row.state === 'error'
                          ? 'Запись, права или вложение недоступны. Локальное намерение сохранено.'
                          : 'Повтор сохранит тот же запрос и ключ.'}
                  </p>
                ) : null}
                {row.body.body || row.body.description ? (
                  <p className="offline-local">{String(row.body.body ?? row.body.description)}</p>
                ) : null}
                {Array.isArray(row.body.checklist) ? (
                  <ul>
                    {row.body.checklist.map((raw, index) => {
                      const item = raw as Record<string, unknown>;
                      return (
                        <li key={String(item.id ?? item.clientId ?? index)}>
                          <label>
                            <input
                              type="checkbox"
                              checked={!!item.done}
                              disabled={state.pending || !editable || row.attempted}
                              onChange={() =>
                                void state.run(async () => {
                                  const checklist = (
                                    row.body.checklist as Record<string, unknown>[]
                                  ).map((value, pos) =>
                                    pos === index ? { ...value, done: !value.done } : value,
                                  );
                                  const create = rows.find(
                                    (value) =>
                                      value.entity === row.entity &&
                                      value.operation.endsWith('_create'),
                                  );
                                  const collection = row.operation.startsWith('note')
                                    ? 'notes'
                                    : 'tasks';
                                  await enqueue(
                                    'PATCH',
                                    `${collection}/${create ? `local:${create.id}` : row.path.split('/')[1]}`,
                                    { checklist },
                                    { ...(create ? { idFrom: create.id } : {}), baseFrom: row.id },
                                  );
                                })
                              }
                            />
                            {String(item.title)}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {readingRows.length ? (
                  <div>
                    {readingRows.map((reading, index) => (
                      <p className="offline-local" key={String(reading.meterId)}>
                        Показание {index + 1}: {formatDateOnly(String(reading.occurredOn))} ·{' '}
                        {(reading.values as string[]).join(' / ')} · Фото:{' '}
                        {(row.photoFrom?.[String(reading.meterId)]?.length ?? 0) +
                          ((reading.photoIds as string[] | undefined)?.length ?? 0)}
                      </p>
                    ))}
                    {serverReadings[row.id]?.length ? (
                      <Notice>
                        Серверная версия:{' '}
                        {serverReadings[row.id]
                          ?.map(
                            (reading) =>
                              `${formatDateOnly(reading.occurredOn)}: ${reading.values.join(' / ')}`,
                          )
                          .join('; ')}
                      </Notice>
                    ) : null}
                    {row.state === 'conflict' || row.state === 'error' ? (
                      <>
                        <button
                          className="btn btn--secondary"
                          type="button"
                          disabled={!online || state.pending}
                          onClick={() =>
                            void state.run(async () => {
                              const data = await Promise.all(
                                readingRows.map((reading) =>
                                  snapshotRequest(
                                    `meters/${reading.meterId}/readings`,
                                    z.array(ReadingCard),
                                  ),
                                ),
                              );
                              setServerReadings((previous) => ({
                                ...previous,
                                [row.id]: data.flat(),
                              }));
                            })
                          }
                        >
                          Проверить показания сервера
                        </button>
                        <p className="muted">
                          Для новой версии отмените это намерение и откройте свежие показания
                          объекта. Уже отправленный запрос сохранит исходный ключ.
                        </p>
                        {row.path.startsWith('objects/') ? (
                          <Link
                            className="btn btn--secondary"
                            to={`/home/${row.path.split('/')[1]}/readings`}
                          >
                            Открыть показания объекта
                          </Link>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                ) : null}
                <div className="btn-row">
                  {editable && row.state !== 'sending' && row.state !== 'unknown' ? (
                    <button
                      type="button"
                      className="btn btn--secondary"
                      disabled={state.pending}
                      onClick={() => edit(row)}
                    >
                      {row.state === 'conflict' ? 'Сравнить и решить' : 'Править локальный ввод'}
                    </button>
                  ) : null}
                  {row.operation === 'task_create' && !row.attempted ? (
                    <button
                      type="button"
                      className="btn btn--secondary"
                      disabled={state.pending}
                      onClick={() =>
                        void state.run(async () => {
                          await enqueue(
                            'POST',
                            `tasks/local:${row.id}/status`,
                            { status: 'done' },
                            { idFrom: row.id, baseFrom: row.id },
                          );
                        })
                      }
                    >
                      Выполнить после создания
                    </button>
                  ) : null}
                  {row.state === 'error' || row.state === 'unknown' ? (
                    <button
                      type="button"
                      className="btn btn--secondary"
                      disabled={state.pending || !online}
                      onClick={() => void state.run(() => retryIntent(row.id))}
                    >
                      Повторить исходный запрос
                    </button>
                  ) : null}
                  {!row.attempted || row.state === 'conflict' || row.state === 'error' ? (
                    <button
                      type="button"
                      className="btn btn--secondary"
                      disabled={state.pending}
                      onClick={() => void state.run(() => cancelIntent(row.id))}
                    >
                      Отменить намерение
                    </button>
                  ) : null}
                </div>
                {editing === row.id ? (
                  <form
                    className="auth-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      save(row);
                    }}
                  >
                    {current ? (
                      <Notice>
                        Сервер: {String(current.title ?? '')};{' '}
                        {String(current.body ?? current.description ?? '')}. Примените правку
                        осознанно или отмените намерение.
                      </Notice>
                    ) : row.state === 'conflict' ? (
                      <Notice>Для сравнения нужна свежая версия с сервера.</Notice>
                    ) : null}
                    <label>
                      Название
                      <input
                        className="input"
                        value={title}
                        required
                        maxLength={200}
                        onChange={(event) => setTitle(event.target.value)}
                      />
                    </label>
                    <label>
                      {row.operation.startsWith('note') ? 'Текст' : 'Описание'}
                      <textarea
                        className="input"
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                      />
                    </label>
                    <button
                      className="btn btn--primary"
                      type="submit"
                      disabled={state.pending || (row.state === 'conflict' && !current)}
                    >
                      {row.state === 'conflict'
                        ? 'Применить мою правку'
                        : 'Сохранить зависимую правку'}
                    </button>
                    <button
                      className="btn btn--secondary"
                      type="button"
                      onClick={() => setEditing(null)}
                    >
                      Закрыть
                    </button>
                  </form>
                ) : null}
              </article>
            );
          })
        )}
      </Section>
      {confirmed.length ? (
        <Section title="Подтверждено">
          {confirmed.map((row) => (
            <p key={row.id}>{KINDS[row.operation]} · Подтверждено</p>
          ))}
        </Section>
      ) : null}
    </Page>
  );
}
