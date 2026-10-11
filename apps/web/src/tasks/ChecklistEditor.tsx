import type { TaskChecklist } from '@homecrm/shared';
import { ArrowDown, ArrowUp, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { TextField } from './fields.tsx';
export function ChecklistEditor({
  value,
  onChange,
}: {
  value: TaskChecklist;
  onChange: (items: TaskChecklist) => void;
}) {
  const [title, setTitle] = useState('');
  function reorder(index: number, delta: number) {
    const next = [...value];
    const item = next.splice(index, 1)[0];
    if (item) next.splice(index + delta, 0, item);
    onChange(next.map((item, position) => ({ ...item, position })));
  }
  return (
    <fieldset className="task-checklist">
      <legend>Чек-лист</legend>
      <ul className="task-edit-list">
        {value.map((item, index) => (
          <li key={item.id}>
            <label className="task-weekday">
              <input
                type="checkbox"
                checked={item.done}
                onChange={(event) =>
                  onChange(
                    value.map((row) =>
                      row.id === item.id ? { ...row, done: event.target.checked } : row,
                    ),
                  )
                }
              />
              Выполнен
            </label>
            <TextField
              label={`Пункт ${index + 1}`}
              value={item.title}
              maxLength={500}
              required
              onChange={(title) =>
                onChange(value.map((row) => (row.id === item.id ? { ...row, title } : row)))
              }
            />
            <div className="btn-row">
              <button
                type="button"
                className="icon-button"
                aria-label={`Пункт ${index + 1} выше`}
                disabled={index === 0}
                onClick={() => reorder(index, -1)}
              >
                <ArrowUp size={20} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Пункт ${index + 1} ниже`}
                disabled={index === value.length - 1}
                onClick={() => reorder(index, 1)}
              >
                <ArrowDown size={20} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Удалить пункт ${index + 1}`}
                onClick={() =>
                  onChange(
                    value
                      .filter((row) => row.id !== item.id)
                      .map((row, position) => ({ ...row, position })),
                  )
                }
              >
                <Trash size={20} />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <TextField label="Новый пункт" value={title} maxLength={500} onChange={setTitle} />
      <button
        type="button"
        className="btn btn--secondary"
        disabled={!title.trim() || value.length >= 100}
        onClick={() => {
          onChange([
            ...value,
            { id: crypto.randomUUID(), title: title.trim(), done: false, position: value.length },
          ]);
          setTitle('');
        }}
      >
        Добавить пункт
      </button>
    </fieldset>
  );
}
