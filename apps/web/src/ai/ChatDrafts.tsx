import type { ChatItem } from '@homecrm/shared';
import { useState } from 'react';
import { z } from 'zod';
import { apiRequest } from '../auth/api.ts';
import { ErrorNotice, useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { Section } from '../ui/Page.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { CompactDraft } from './CompactDraft.tsx';

const Ok = z.object({ ok: z.boolean() });
const names: Record<string, string> = {
  task: 'Дело',
  note: 'Заметка',
  shopping: 'Покупка',
  object: 'Объект',
  contact: 'Контакт',
  meter: 'Показание',
  title: 'Название',
  body: 'Текст',
  date: 'Дата',
  time: 'Время',
  assigneeId: 'Ответственный',
  objectId: 'Объект',
  meterId: 'Счётчик',
  values: 'Показания',
  quantity: 'Количество',
  objectType: 'Вид объекта',
};
export function ChatDrafts({
  rows,
  refresh,
}: {
  rows: { id: string; chatDraft?: ChatItem | null }[];
  refresh: () => Promise<unknown>;
}) {
  const { householdId, me } = useHousehold();
  const [excluded, setExcluded] = useState<string[]>([]);
  const selected = rows.filter((r) => !excluded.includes(r.id)).map((r) => r.id);
  const [editing, setEditing] = useState<string | null>(null);
  const [space, setSpace] = useState('personal'),
    [edits, setEdits] = useState<Record<string, ChatItem>>({});
  const state = useAction();
  return (
    <Section title="Черновики от ИИ">
      <label className="auth-field">
        Куда сохранить
        <select value={space} onChange={(e) => setSpace(e.target.value)}>
          <option value="personal">Личное</option>
          {householdId && (
            <>
              <option value="household">Дом · Все</option>
              {me.roles.some((r) => r.householdId === householdId && r.role !== 'child') && (
                <option value="adults">Дом · Взрослые</option>
              )}
            </>
          )}
        </select>
      </label>
      {rows.map((row) => {
        const d = edits[row.id] ?? row.chatDraft;
        if (!d) return null;
        const edit = (patch: Partial<ChatItem>) =>
          setEdits((v) => ({ ...v, [row.id]: { ...d, ...patch } }));
        return (
          <div key={row.id} className="auth-form">
            <CompactDraft
              kind={d.kind}
              title={d.title}
              fields={Object.fromEntries(Object.entries(d).map(([key, value]) => [key, { value }]))}
              place={space === 'personal' ? 'Только я' : space === 'adults' ? 'Взрослые' : 'Семья'}
              review={d.uncertain.length > 0}
              selected={selected.includes(row.id)}
              onSelect={(value) =>
                setExcluded((v) => (value ? v.filter((id) => id !== row.id) : [...v, row.id]))
              }
              onEdit={() => setEditing(row.id)}
            />
            {editing === row.id ? (
              <Sheet
                open
                title="Изменить черновик"
                description="Проверьте все поля."
                onOpenChange={() => setEditing(null)}
              >
                <label className="auth-field">
                  Название
                  <input value={d.title} onChange={(e) => edit({ title: e.target.value })} />
                </label>
                <label className="auth-field">
                  Текст
                  <textarea value={d.body} onChange={(e) => edit({ body: e.target.value })} />
                </label>
                {d.uncertain.length > 0 && (
                  <p>Проверьте неуверенные поля: {d.uncertain.map((k) => names[k]).join(', ')}</p>
                )}
                <label className="auth-field">
                  Тип черновика
                  <select
                    value={d.kind}
                    onChange={(e) => edit({ kind: e.target.value as ChatItem['kind'] })}
                  >
                    {['task', 'note', 'shopping', 'object', 'contact', 'meter'].map((kind) => (
                      <option key={kind} value={kind}>
                        {names[kind]}
                      </option>
                    ))}
                  </select>
                </label>
                {(d.kind === 'task' || d.kind === 'meter') && (
                  <>
                    <label className="auth-field">
                      Дата в часовом поясе дома
                      <input
                        type="date"
                        value={d.date ?? ''}
                        onChange={(e) => edit({ date: e.target.value || null })}
                      />
                    </label>
                    <label className="auth-field">
                      Время
                      <input
                        type="time"
                        value={d.time ?? ''}
                        onChange={(e) => edit({ time: e.target.value || null })}
                      />
                    </label>
                  </>
                )}
                {d.kind === 'meter' && (
                  <label className="auth-field">
                    Точные показания через пробел
                    <input
                      value={d.values?.join(' ') ?? ''}
                      onChange={(e) => edit({ values: e.target.value.split(' ') })}
                    />
                  </label>
                )}
                {d.kind === 'shopping' && (
                  <label className="auth-field">
                    Количество
                    <input
                      value={d.quantity ?? ''}
                      onChange={(e) => edit({ quantity: e.target.value || null })}
                    />
                  </label>
                )}
                {d.kind === 'object' && (
                  <label className="auth-field">
                    Вид объекта
                    <select
                      value={d.objectType}
                      onChange={(e) =>
                        edit({ objectType: e.target.value as ChatItem['objectType'] })
                      }
                    >
                      <option value="other">Другое</option>
                      <option value="property">Недвижимость</option>
                      <option value="car">Автомобиль</option>
                      <option value="appliance">Техника</option>
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    edit({ uncertain: [] });
                    setEditing(null);
                  }}
                >
                  Готово
                </button>
              </Sheet>
            ) : null}
            <button
              className="text-button"
              type="button"
              disabled={state.disabled}
              onClick={() =>
                void state.run(async () => {
                  await apiRequest('POST', `inbox/${row.id}/trash`, Ok, {});
                  setExcluded((v) => v.filter((id) => id !== row.id));
                  await refresh();
                })
              }
            >
              Удалить черновик
            </button>
          </div>
        );
      })}
      <button
        className="btn btn--primary"
        type="button"
        disabled={
          !selected.length ||
          state.disabled ||
          rows.some(
            (r) => selected.includes(r.id) && (edits[r.id] ?? r.chatDraft)?.uncertain.length,
          )
        }
        onClick={() =>
          void state.run(async () => {
            await apiRequest('POST', 'inbox/chat/confirm', Ok, {
              ids: selected,
              edits,
              ...(space === 'personal' ? {} : { spaceId: householdId, audience: space }),
            });
            setExcluded([]);
            await refresh();
          })
        }
      >
        Сохранить все ({selected.length})
      </button>
      <ErrorNotice error={state.error} />
    </Section>
  );
}
