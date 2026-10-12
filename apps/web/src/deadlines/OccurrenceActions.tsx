import type { RadarActionInput } from '@homecrm/shared';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../auth/api.ts';
import { Notice } from '../auth/components.tsx';
import { todayIn } from '../objects/dates.ts';
import { formatShortDate } from '../ui/format.ts';
import { fetchRadar, saveRadarAction } from './api.ts';
import { useRefreshDeadlines } from './queries.ts';
import type { RadarRow } from './radar.ts';

export function OccurrenceActions({ row }: { row: RadarRow }) {
  const item = row.item;
  const [mode, setMode] = useState<'snooze' | 'dismiss' | null>(null);
  const [date, setDate] = useState(''),
    [time, setTime] = useState('09:00'),
    [reason, setReason] = useState('');
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const [version, setVersion] = useState<number | null>(null);
  const lock = useRef(false),
    attempt = useRef<{ hash: string; key: string } | null>(null);
  const refresh = useRefreshDeadlines();
  if (!item) return null;
  const state = item.actionState;
  const hidden =
    state &&
    (state.status === 'dismissed' ||
      (state.status === 'snoozed' && new Date(state.snoozedUntil ?? 0) > new Date()));
  async function save(action: RadarActionInput['action']) {
    if (!item?.calendarKey || lock.current) return;
    const input = {
      action,
      expectedVersion: version ?? item.actionState?.version ?? 0,
      calendarKey: item.calendarKey,
      ...(action === 'snooze' ? { date, time } : {}),
      ...(action === 'dismiss' ? { reason } : {}),
    };
    const hash = JSON.stringify(input);
    if (attempt.current?.hash !== hash) attempt.current = { hash, key: crypto.randomUUID() };
    lock.current = true;
    setPending(true);
    setError('');
    try {
      await saveRadarAction(item.id, {
        ...input,
        idempotencyKey: attempt.current.key,
      } as RadarActionInput);
      await refresh();
      setMode(null);
      attempt.current = null;
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 409
          ? 'Состояние изменилось. Действие не подтверждено. Введённые данные сохранены.'
          : 'Не удалось сохранить. Введённые данные сохранены.',
      );
      if (caught instanceof ApiError && caught.status === 409) {
        try {
          const current = await fetchRadar('0001-01-01', '9999-12-31', undefined, { state: 'all' });
          const latest = current.items.find((x) => x.id === item.id);
          if (latest?.actionState) {
            setVersion(latest.actionState.version);
            setError(
              `Состояние изменилось. Текущая версия: ${latest.actionState.version}. Проверьте действие и повторите. Введённые данные сохранены.`,
            );
          }
        } catch {
          setError(
            'Состояние изменилось; актуальную версию загрузить не удалось. Введённые данные сохранены.',
          );
        }
      }
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <div className="radar-actions">
      {hidden ? (
        <p className="muted">
          {state.status === 'dismissed'
            ? `Не актуально: ${state.reason}`
            : `Отложено до ${localMoment(state.snoozedUntil ?? '', item.timeZone)}`}{' '}
          · {item.timeZone}
          {state.changedAt ? (
            <>
              <br />
              Автор отметки: {state.actorName ?? 'Участник'} ·{' '}
              {localMoment(state.changedAt, item.timeZone)}
            </>
          ) : null}
        </p>
      ) : null}
      {item.primaryAction?.kind === 'renew_document' && item.documentId && !hidden ? (
        <Link className="btn btn--primary" to={`/documents/${item.documentId}?action=renew`}>
          Продлить
        </Link>
      ) : null}
      {item.taskId && !hidden ? (
        <Link className="text-button" to={`/today/tasks/${item.taskId}`}>
          Открыть дело
        </Link>
      ) : null}
      {item.canWrite ? (
        <>
          {hidden ? (
            <button
              type="button"
              className="btn btn--secondary"
              disabled={pending}
              onClick={() => void save('restore')}
            >
              Вернуть в радар
            </button>
          ) : (
            <>
              <button type="button" className="text-button" onClick={() => setMode('snooze')}>
                Отложить до…
              </button>
              <button type="button" className="text-button" onClick={() => setMode('dismiss')}>
                Не актуально
              </button>
              {item.sourceKind === 'record' ? (
                <button
                  className="text-button"
                  type="button"
                  disabled={pending}
                  onClick={() => void save('complete')}
                >
                  Срок выполнен
                </button>
              ) : null}
            </>
          )}
          {mode ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save(mode);
              }}
            >
              {mode === 'snooze' ? (
                <>
                  <label className="field">
                    Дата · {item.timeZone}
                    <input
                      className="input"
                      type="date"
                      value={date}
                      min={todayIn(item.timeZone)}
                      required
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    Время дома
                    <input
                      className="input"
                      type="time"
                      value={time}
                      required
                      onChange={(e) => setTime(e.target.value)}
                    />
                  </label>
                </>
              ) : (
                <label className="field">
                  Причина
                  <textarea
                    className="input"
                    value={reason}
                    maxLength={2000}
                    required
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              )}
              <div className="btn-row">
                <button className="btn btn--primary" disabled={pending} type="submit">
                  Сохранить
                </button>
                <button
                  className="btn btn--secondary"
                  type="button"
                  disabled={pending}
                  onClick={() => setMode(null)}
                >
                  Отмена
                </button>
              </div>
            </form>
          ) : null}
        </>
      ) : null}
      {error ? <Notice error>{error}</Notice> : null}
    </div>
  );
}
function localMoment(value: string, zone: string) {
  const at = new Date(value);
  return `${formatShortDate(todayIn(zone, at), todayIn(zone))} · ${at.toLocaleTimeString('ru-RU', { timeZone: zone, hour: '2-digit', minute: '2-digit' })}`;
}
