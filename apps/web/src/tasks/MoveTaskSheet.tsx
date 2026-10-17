import { shiftTaskDate } from '@homecrm/shared';
import { useState } from 'react';
import { Notice, useOnline } from '../auth/components.tsx';
import { todayIn } from '../objects/dates.ts';
import { Sheet } from '../ui/Sheet.tsx';
import type { TaskCard } from './api.ts';
import { taskError } from './errors.ts';
import { TextField } from './fields.tsx';
import { nextWeekday } from './plan.ts';

export function MoveTaskSheet({
  card,
  timeZone,
  pending,
  error,
  close,
  move,
}: {
  card: TaskCard;
  timeZone: string;
  pending: boolean;
  error: unknown;
  close: () => void;
  move: (date: string | null, scope: 'this' | 'following') => void;
}) {
  const online = useOnline();
  const [scope, setScope] = useState<'this' | 'following' | null>(card.repeatRule ? null : 'this');
  const [picking, setPicking] = useState(false);
  const [date, setDate] = useState('');
  const today = todayIn(timeZone);
  const title = card.planOn ? 'Перенести' : 'Назначить день';
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !pending) close();
      }}
      title={title}
      description={card.title}
    >
      {error ? <Notice error>{taskError(error)}</Notice> : null}
      {scope === null ? (
        <div className="plan-move-options">
          <button className="btn btn--secondary" type="button" onClick={() => setScope('this')}>
            Только этот раз
          </button>
          <button
            className="btn btn--secondary"
            type="button"
            disabled={!online}
            onClick={() => setScope('following')}
          >
            Этот и следующие{!online ? ' · Нужна сеть' : ''}
          </button>
        </div>
      ) : (
        <div className="plan-move-options">
          {scope === 'following' && !online ? <p className="muted">Нужна сеть</p> : null}
          {[
            ['Завтра', shiftTaskDate(today, 1)],
            ['В субботу', nextWeekday(today, 6)],
            ['В понедельник', nextWeekday(today, 1)],
            ['Через неделю', shiftTaskDate(today, 7)],
          ].map(([label, value]) => (
            <button
              className="btn btn--secondary"
              type="button"
              key={label}
              disabled={pending || (scope === 'following' && !online)}
              onClick={() => move(value ?? '', scope)}
            >
              {label}
            </button>
          ))}
          <button
            className="btn btn--secondary"
            type="button"
            disabled={pending}
            onClick={() => setPicking(true)}
          >
            Выбрать дату…
          </button>
          {picking ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (date) move(date, scope);
              }}
            >
              <TextField
                label="Дата переноса"
                type="date"
                value={date}
                onChange={setDate}
                required
                disabled={pending}
              />
              <button
                className="btn btn--primary"
                disabled={pending || !date || (scope === 'following' && !online)}
                type="submit"
              >
                {title}
              </button>
            </form>
          ) : null}
          {card.planOn && !card.repeatRule ? (
            <button
              className="btn btn--secondary"
              type="button"
              disabled={pending}
              onClick={() => move(null, scope)}
            >
              Без даты
            </button>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
