import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import * as z from 'zod';
import { App } from '../App.tsx';
import { InstallApp } from '../pwa/InstallApp.tsx';
import { ApiError, action, api, appURL, consumeLink, Me } from './api.ts';
import { AuthPage, ErrorNotice, Notice, OfflineBanner, useAction } from './components.tsx';
import { formatDay } from './dates.ts';
import {
  type Challenge,
  ChallengeScreen,
  ForgotScreen,
  InvitationScreen,
  LoginScreen,
  ResetScreen,
} from './screens.tsx';
import { TwoFactorSetup } from './TwoFactorSetup.tsx';

async function currentMe(signal?: AbortSignal) {
  // Отсутствие сессии — штатный ответ 200/null, без ошибки ресурса в консоли браузера.
  const session = await api(
    'auth/get-session',
    z.object({ user: z.object({ id: z.string() }) }).nullable(),
    undefined,
    signal,
  );
  if (!session) return null;
  try {
    return await api('me', Me, undefined, signal);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

function ResetNotice({
  reset,
  timeZone,
  reload,
}: {
  reset: NonNullable<Me['passwordReset']>;
  timeZone: string;
  reload: () => Promise<void>;
}) {
  const state = useAction();
  // Первые 7 дней отметку не закрыть никому: сервер отклонит, кнопки нет (AUTH-5).
  const locked = Date.now() < Date.parse(reset.ackAllowedAt);
  return (
    <section className="reset-notice" aria-label="Сброс пароля">
      <Notice>
        <strong>Ваш пароль сбросил администратор.</strong>
        <p>
          По ссылке он мог задать новый пароль и войти от вашего имени, в том числе в личное
          пространство.
        </p>
        {locked ? (
          <p>Закрыть её можно будет с {formatDay(reset.ackAllowedAt, timeZone)}.</p>
        ) : (
          <button
            className="text-button"
            type="button"
            disabled={state.disabled}
            onClick={() =>
              void state.run(async () => {
                await action('me/password-reset/ack');
                await reload();
              })
            }
          >
            {state.pending ? 'Сохраняем…' : 'Я прочитал'}
          </button>
        )}
        <ErrorNotice error={state.error} />
      </Notice>
    </section>
  );
}

export function AuthRoot() {
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [link, setLink] = useState(() => consumeLink(new URL(window.location.href)));
  const linkConsumed = useRef(false);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const query = useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) => currentMe(signal),
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (!link || linkConsumed.current) return;
    linkConsumed.current = true;
    // Убираем токен также из истории браузера и Referer, не записывая его в хранилища.
    window.history.replaceState(
      null,
      '',
      appURL(link.kind === 'invite' ? '/invite' : '/reset-password'),
    );
    navigate(link.kind === 'invite' ? '/invite' : '/reset-password', { replace: true });
  }, [link, navigate]);
  async function reload() {
    await query.refetch({ throwOnError: true });
  }
  async function signedIn(setup = false) {
    setChallenge(null);
    setLink(null);
    await reload();
    navigate(setup ? '/setup-two-factor' : '/today', { replace: true });
  }
  function signedOut() {
    client.clear();
    client.setQueryData(['me'], null);
    setChallenge(null);
    setLink(null);
    navigate('/sign-in', { replace: true });
  }
  let screen: ReactNode;
  // Установку предлагаем там, где человек её ищет: на входе, в приглашении и при сбросе пароля.
  // Пока проверяется сессия, на экране кода и внутри приложения её нет: внутри — только в настройках.
  let installable = false;
  if (location.pathname === '/invite' || location.pathname.startsWith('/invite/')) {
    installable = true;
    screen = (
      <InvitationScreen
        token={link?.kind === 'invite' ? link.token : null}
        onAccepted={() => signedIn(true)}
      />
    );
  } else if (location.pathname === '/reset-password') {
    installable = true;
    screen = <ResetScreen token={link?.kind === 'reset' ? link.token : null} />;
  } else if (location.pathname === '/forgot-password') {
    installable = true;
    screen = <ForgotScreen />;
  } else if (location.pathname === '/two-factor')
    screen = <ChallengeScreen challenge={challenge} onSignedIn={() => signedIn()} />;
  else if (query.isPending)
    screen = (
      <AuthPage title="Открываем HomeCRM">
        <Notice>Проверяем вход…</Notice>
      </AuthPage>
    );
  else if (query.isError)
    screen = (
      <AuthPage title="Не удалось проверить вход">
        <ErrorNotice error={query.error} />
        <button className="btn btn--secondary" type="button" onClick={() => void query.refetch()}>
          Повторить
        </button>
      </AuthPage>
    );
  else if (!query.data) {
    installable = true;
    screen = <LoginScreen onChallenge={setChallenge} onSignedIn={() => signedIn()} />;
  } else if (query.data.secondFactorRequired || location.pathname === '/setup-two-factor')
    screen = (
      <TwoFactorSetup required={query.data.secondFactorRequired} onComplete={() => signedIn()} />
    );
  else {
    screen = (
      <>
        {query.data.passwordReset && (
          <ResetNotice
            reset={query.data.passwordReset}
            timeZone={query.data.timeZone}
            reload={reload}
          />
        )}
        <App me={query.data} reloadMe={reload} signOut={signedOut} />
      </>
    );
  }
  return (
    <>
      <OfflineBanner />
      {screen}
      {installable && <InstallApp />}
    </>
  );
}
