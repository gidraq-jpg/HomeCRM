import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import * as z from 'zod';
import { InstallApp } from '../pwa/InstallApp.tsx';
import { Page, Section } from '../ui/Page.tsx';
import { ApiError, action, api, BackupCodes, Events, isAdmin, type Me, Sessions } from './api.ts';
import {
  AuthForm,
  clearSecrets,
  ErrorNotice,
  formValues,
  Notice,
  PasswordField,
  useAction,
} from './components.tsx';
import { formatMoment } from './dates.ts';
import { RecoveryCodes } from './TwoFactorSetup.tsx';

function Devices({ onSignedOut, timeZone }: { onSignedOut: () => void; timeZone: string }) {
  const date = (value: string) => formatMoment(value, timeZone);
  const query = useQuery({
    queryKey: ['devices'],
    queryFn: ({ signal }) => api('auth/list-sessions', Sessions, undefined, signal),
  });
  const state = useAction();
  const [confirm, setConfirm] = useState(false);
  return (
    <Section title="Устройства">
      <p className="auth-hint">Сессия продлевается при использовании и живёт до 90 дней.</p>
      {query.isPending ? (
        <Notice>Загружаем устройства…</Notice>
      ) : query.isError ? (
        <>
          <ErrorNotice error={query.error} />
          <button className="text-button" type="button" onClick={() => void query.refetch()}>
            Повторить загрузку устройств
          </button>
        </>
      ) : (
        <ul className="security-list">
          {query.data.map((session) => (
            <li key={session.id}>
              <strong>{session.userAgent || 'Неизвестное устройство'}</strong>
              <p>{session.ipAddress || 'Адрес не указан'}</p>
              <p>Вход: {date(session.createdAt)}</p>
              <p>До: {date(session.expiresAt)}</p>
              <button
                className="text-button"
                disabled={state.disabled}
                type="button"
                onClick={() =>
                  void state.run(async () => {
                    await action('auth/revoke-session', { token: session.token });
                    const result = await query.refetch();
                    if (result.error instanceof ApiError && result.error.status === 401)
                      onSignedOut();
                  })
                }
              >
                Завершить сессию
              </button>
            </li>
          ))}
        </ul>
      )}
      <ErrorNotice error={state.error} />
      {!confirm ? (
        <button
          className="btn btn--secondary btn--block"
          type="button"
          onClick={() => setConfirm(true)}
        >
          Выйти на всех устройствах
        </button>
      ) : (
        <div className="auth-confirm">
          <p>Будут закрыты все сессии, включая эту. Потребуется войти заново.</p>
          <button
            className="btn btn--danger btn--block"
            disabled={state.disabled}
            type="button"
            onClick={() =>
              void state.run(async () => {
                await action('auth/revoke-sessions');
                await action('auth/sign-out');
                onSignedOut();
              })
            }
          >
            {state.pending ? 'Завершаем сессии…' : 'Подтвердить выход везде'}
          </button>
          <button className="text-button" type="button" onClick={() => setConfirm(false)}>
            Отмена
          </button>
        </div>
      )}
    </Section>
  );
}

function LoginEvents({ timeZone }: { timeZone: string }) {
  const date = (value: string) => formatMoment(value, timeZone);
  const query = useQuery({
    queryKey: ['login-events'],
    queryFn: ({ signal }) => api('login-events', Events, undefined, signal),
  });
  const outcomes = {
    success: 'Успешно',
    failure: 'Неудачная попытка',
    locked: 'Блокировка',
    second_factor_required: 'Ожидание второго фактора',
  };
  const kinds = { sign_in: 'Вход', second_factor: 'Второй фактор', password_reset: 'Сброс пароля' };
  return (
    <Section title="Журнал входов">
      {query.isPending ? (
        <Notice>Загружаем журнал…</Notice>
      ) : query.isError ? (
        <>
          <ErrorNotice error={query.error} />
          <button className="text-button" type="button" onClick={() => void query.refetch()}>
            Повторить загрузку журнала
          </button>
        </>
      ) : query.data.length ? (
        <ul className="security-list">
          {query.data.map((event, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: журнал — снимок списка без локального состояния строк; API не возвращает id события.
            <li key={`${event.createdAt}-${index}`}>
              <strong>
                {kinds[event.kind]} · {outcomes[event.outcome]}
              </strong>
              <p>
                {date(event.createdAt)} · {event.ipAddress || 'Адрес не указан'}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">В журнале пока нет записей.</p>
      )}
    </Section>
  );
}

function ChangePassword() {
  const state = useAction();
  return (
    <Section title="Сменить пароль">
      <AuthForm
        state={state}
        submit="Сменить пароль"
        onSubmit={(event) => {
          const { form, text } = formValues(event);
          const body = {
            currentPassword: text('password'),
            newPassword: text('newPassword'),
            revokeOtherSessions: true,
          };
          clearSecrets(form);
          void state.run(async () => {
            await action('auth/change-password', body);
            state.setDone('Пароль изменён. Остальные сессии завершены.');
          });
        }}
      >
        <PasswordField label="Текущий пароль" />
        <PasswordField label="Новый пароль" name="newPassword" newPassword />
      </AuthForm>
    </Section>
  );
}

function FactorSettings({ me, reload }: { me: Me; reload: () => Promise<void> }) {
  const state = useAction();
  const [codes, setCodes] = useState<string[]>([]);
  const [mode, setMode] = useState<'codes' | 'disable' | null>(null);
  return (
    <Section title="Второй фактор">
      <p>
        {me.twoFactorEnabled ? 'Второй фактор включён.' : 'Второй фактор пока не включён.'}{' '}
        {isAdmin(me)
          ? 'Администратору он обязателен при каждом входе.'
          : 'Рекомендуем включить для защиты учётной записи.'}
      </p>
      {!me.twoFactorEnabled ? (
        <Link className="btn btn--secondary btn--block" to="/setup-two-factor">
          Настроить второй фактор
        </Link>
      ) : (
        <>
          <button type="button" className="text-button" onClick={() => setMode('codes')}>
            Получить новые резервные коды
          </button>
          {!isAdmin(me) && (
            <button type="button" className="text-button" onClick={() => setMode('disable')}>
              Выключить второй фактор
            </button>
          )}
          {mode && (
            <AuthForm
              key={mode}
              state={state}
              submit={mode === 'codes' ? 'Заменить резервные коды' : 'Выключить второй фактор'}
              onSubmit={(event) => {
                const { form, text } = formValues(event);
                const password = text('password');
                clearSecrets(form);
                void state.run(async () => {
                  if (mode === 'codes') {
                    const result = await api('auth/two-factor/generate-backup-codes', BackupCodes, {
                      password,
                    });
                    setCodes(result.backupCodes);
                  } else {
                    await action('auth/two-factor/disable', { password });
                    await reload();
                  }
                  setMode(null);
                });
              }}
            >
              <p className="auth-hint">
                {mode === 'codes'
                  ? 'Прежние резервные коды перестанут работать.'
                  : 'Для входа останется только пароль.'}
              </p>
              <PasswordField label="Подтвердите пароль" />
            </AuthForm>
          )}
          {codes.length > 0 && <RecoveryCodes codes={codes} onClose={() => setCodes([])} />}
        </>
      )}
    </Section>
  );
}

function InviteParticipant({ me }: { me: Me }) {
  const state = useAction();
  const [link, setLink] = useState('');
  const house = me.roles.find(({ role }) => role === 'admin');
  if (!house) return null;
  return (
    <Section title="Пригласить участника">
      <AuthForm
        state={state}
        submit="Создать приглашение"
        onSubmit={(event) => {
          const { text } = formValues(event);
          void state.run(async () => {
            const result = await api('invitations', z.object({ url: z.string() }), {
              householdId: house.householdId,
              role: text('role'),
            });
            setLink(result.url);
          });
        }}
      >
        <label className="auth-field">
          <span>Роль участника</span>
          <select name="role" defaultValue="adult">
            <option value="adult">Взрослый</option>
            <option value="child">Ребёнок</option>
            <option value="admin">Администратор</option>
          </select>
        </label>
      </AuthForm>
      {link && (
        <>
          <Notice>Ссылка действует 72 часа, только один раз. Передайте её участнику лично.</Notice>
          <label className="auth-field">
            <span>Ссылка-приглашение</span>
            <textarea value={link} readOnly rows={3} />
          </label>
          <button className="text-button" type="button" onClick={() => setLink('')}>
            Скрыть ссылку
          </button>
        </>
      )}
    </Section>
  );
}

export function SecurityScreen({
  me,
  reload,
  onSignedOut,
}: {
  me: Me;
  reload: () => Promise<void>;
  onSignedOut: () => void;
}) {
  const state = useAction();
  return (
    <Page title="Настройки" eyebrow={me.displayName} back={{ to: '/more', label: 'Ещё' }}>
      <Section title="Учётная запись">
        <p>
          {me.username}
          {me.email ? ` · ${me.email}` : ' · Без почты'}
        </p>
        <button
          className="text-button"
          type="button"
          disabled={state.disabled}
          onClick={() =>
            void state.run(async () => {
              await action('auth/sign-out');
              onSignedOut();
            })
          }
        >
          {state.pending ? 'Выходим…' : 'Выйти'}
        </button>
        <ErrorNotice error={state.error} />
      </Section>
      <FactorSettings me={me} reload={reload} />
      <ChangePassword />
      <Devices onSignedOut={onSignedOut} timeZone={me.timeZone} />
      <LoginEvents timeZone={me.timeZone} />
      <InviteParticipant me={me} />
      <InstallApp inline />
    </Page>
  );
}
