import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation } from 'react-router';
import { z } from 'zod';
import './chat.css';
import { apiRequest } from '../auth/api.ts';
import { AuthPage, ErrorNotice, useAction } from '../auth/components.tsx';
import { Section } from '../ui/Page.tsx';

const Ok = z.object({ ok: z.boolean() });

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
          host: z.string(),
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
            Доступ получит сайт <strong>{query.data.host}</strong>. Если это не сайт вашего чата
            (например, claude.ai или chatgpt.com), нажмите «Отказать».
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
