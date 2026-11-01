import type { ChatItem } from '@homecrm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation } from 'react-router';
import { z } from 'zod';
import './chat.css';
import { apiRequest } from '../auth/api.ts';
import { AuthPage, ErrorNotice, useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { Section } from '../ui/Page.tsx';

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

export function ChatConsent() {
  const { search } = useLocation();
  const authorization = Object.fromEntries(new URLSearchParams(search));
  const query = useQuery({
    queryKey: ['chat-consent', search],
    queryFn: () =>
      apiRequest(
        'GET',
        `chat/consent${search}`,
        z.object({
          name: z.string(),
          houses: z.array(z.object({ id: z.string(), name: z.string() })),
        }),
      ),
  });
  const [house, setHouse] = useState('');
  const state = useAction();
  async function decide(approve: boolean) {
    await state.run(async () => {
      const result = await apiRequest('POST', 'chat/consent', z.object({ redirect: z.url() }), {
        authorization,
        houseId: house || query.data?.houses[0]?.id,
        approve,
      });
      sessionStorage.removeItem('homecrm-chat-return');
      window.location.assign(result.redirect);
    });
  }
  return (
    <AuthPage title="Подключение ИИ через чат">
      {query.data ? (
        <>
          <p>
            <strong>{query.data.name}</strong> просит: создавать черновики во «Входящих», видеть
            названия ваших объектов и имена людей.
          </p>
          <p>
            Сохранять записи будете вы. Названия видимых объектов, людей и счётчиков получит
            выбранный чат.
          </p>
          <label className="auth-field">
            Дом
            <select
              value={house || query.data.houses[0]?.id || ''}
              onChange={(e) => setHouse(e.target.value)}
            >
              {query.data.houses.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          {!query.data.houses.length && (
            <p>Администратор должен включить «ИИ через чат» в настройках дома.</p>
          )}
          <button
            className="btn btn--primary"
            type="button"
            disabled={state.disabled || !query.data.houses.length}
            onClick={() => void decide(true)}
          >
            Разрешить
          </button>
          <button
            className="btn btn--secondary"
            type="button"
            disabled={state.disabled || !query.data.houses.length}
            onClick={() => void decide(false)}
          >
            Отказать
          </button>
        </>
      ) : (
        <p role="status">Проверяем подключение…</p>
      )}
      <ErrorNotice error={query.error || state.error} />
    </AuthPage>
  );
}
export function ChatDevices() {
  const query = useQuery({
    queryKey: ['chat-devices'],
    queryFn: () =>
      apiRequest(
        'GET',
        'chat/devices',
        z.array(z.object({ id: z.string(), name: z.string(), lastUsedAt: z.string() })),
      ),
  });
  const events = useQuery({
    queryKey: ['chat-events'],
    queryFn: () =>
      apiRequest(
        'GET',
        'chat/events',
        z.array(
          z.object({
            id: z.string(),
            createdAt: z.string(),
            action: z.string(),
            kind: z.string().nullable(),
          }),
        ),
      ),
  });
  const state = useAction();
  return (
    <Section title="Устройства ИИ">
      <p>Ключ отключается после 90 дней без использования.</p>
      <ul className="security-list">
        {query.data?.map((d) => (
          <li key={d.id}>
            <strong>{d.name}</strong>
            <p>Последнее использование: {new Date(d.lastUsedAt).toLocaleString('ru-RU')}</p>
            <button
              className="text-button"
              type="button"
              disabled={state.disabled}
              onClick={() =>
                void state.run(async () => {
                  await apiRequest('POST', 'chat/revoke', Ok, { id: d.id });
                  await query.refetch();
                })
              }
            >
              Отключить
            </button>
          </li>
        ))}
      </ul>
      <h3>Журнал действий ИИ</h3>
      <ul>
        {events.data?.map((e) => (
          <li key={e.id}>
            {new Date(e.createdAt).toLocaleString('ru-RU')} ·{' '}
            {(
              {
                find_objects: 'Поиск объектов',
                find_people: 'Поиск людей',
                list_meters: 'Счётчики',
                create_drafts: 'Черновик',
              } as Record<string, string>
            )[e.action] ?? e.action}
            {e.kind ? ` · ${e.kind}` : ''}
          </li>
        ))}
      </ul>
      <ErrorNotice error={query.error || events.error || state.error} />
    </Section>
  );
}
export function ChatSettings({ spaceId, isAdmin }: { spaceId: string; isAdmin: boolean }) {
  const query = useQuery({
    queryKey: ['chat-settings', spaceId],
    queryFn: () =>
      apiRequest('GET', `chat/settings/${spaceId}`, z.object({ enabled: z.boolean() })),
  });
  const state = useAction();
  return (
    <Section title="ИИ через чат">
      <p>Claude и ChatGPT получают только данные для привязки и создают личные черновики.</p>
      <label className="chat-choice">
        <input
          className="chat-checkbox"
          type="checkbox"
          checked={query.data?.enabled ?? false}
          disabled={!isAdmin || state.disabled || !query.data}
          onChange={(e) => {
            const enabled = e.target.checked;
            void state.run(async () => {
              await apiRequest('POST', 'chat/settings', Ok, { id: spaceId, enabled });
              await query.refetch();
            });
          }}
        />
        Включить ИИ через чат
      </label>
      <ErrorNotice error={query.error || state.error} />
    </Section>
  );
}
export function ChatDrafts({
  rows,
  refresh,
}: {
  rows: { id: string; chatDraft?: ChatItem | null }[];
  refresh: () => Promise<unknown>;
}) {
  const { householdId, me } = useHousehold();
  const [selected, setSelected] = useState<string[]>([]),
    [space, setSpace] = useState('personal'),
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
            <label className="chat-choice">
              <input
                className="chat-checkbox"
                type="checkbox"
                checked={selected.includes(row.id)}
                onChange={(e) =>
                  setSelected((v) =>
                    e.target.checked ? [...v, row.id] : v.filter((id) => id !== row.id),
                  )
                }
              />
              От ИИ · {names[d.kind]}
            </label>
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
                  onChange={(e) => edit({ objectType: e.target.value as ChatItem['objectType'] })}
                >
                  <option value="other">Другое</option>
                  <option value="property">Недвижимость</option>
                  <option value="car">Автомобиль</option>
                  <option value="appliance">Техника</option>
                </select>
              </label>
            )}
            <button
              className="text-button"
              type="button"
              disabled={state.disabled}
              onClick={() =>
                void state.run(async () => {
                  await apiRequest('POST', `inbox/${row.id}/trash`, Ok, {});
                  setSelected((v) => v.filter((id) => id !== row.id));
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
        disabled={!selected.length || state.disabled}
        onClick={() =>
          void state.run(async () => {
            await apiRequest('POST', 'inbox/chat/confirm', Ok, {
              ids: selected,
              edits,
              ...(space === 'personal' ? {} : { spaceId: householdId, audience: space }),
            });
            setSelected([]);
            await refresh();
          })
        }
      >
        Сохранить выбранные
      </button>
      <ErrorNotice error={state.error} />
    </Section>
  );
}
