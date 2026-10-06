import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError, action, api, appURL, loginBody, SignIn } from './api.ts';
import {
  AuthForm,
  AuthPage,
  BackToLogin,
  clearSecrets,
  formValues,
  Notice,
  PasswordField,
  useAction,
} from './components.tsx';

export interface Challenge {
  trustDeviceAllowed: boolean;
}

export function LoginScreen({
  onChallenge,
  onSignedIn,
}: {
  onChallenge: (challenge: Challenge) => void;
  onSignedIn: () => Promise<void>;
}) {
  const state = useAction();
  const navigate = useNavigate();
  return (
    <AuthPage title="Войти в HomeCRM" lead="Ваши дела, документы и дом — под рукой.">
      <AuthForm
        state={state}
        submit="Войти"
        onSubmit={(event) => {
          const { form, text } = formValues(event);
          const login = loginBody(text('login'), text('password'));
          clearSecrets(form);
          void state.run(async () => {
            const result = await api(login.path, SignIn, login.body);
            if (result.twoFactorRedirect) {
              onChallenge({ trustDeviceAllowed: result.trustDeviceAllowed === true });
              navigate('/two-factor');
            } else await onSignedIn();
          });
        }}
      >
        <label className="auth-field">
          <span>Имя пользователя или почта</span>
          <input
            name="login"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={254}
          />
        </label>
        <PasswordField />
      </AuthForm>
      <Link className="text-button auth-link" to="/forgot-password">
        Не помню пароль
      </Link>
      <p className="auth-footnote">
        Новый участник входит по приглашению администратора дома. Детям почта не нужна.
      </p>
    </AuthPage>
  );
}

export function ChallengeScreen({
  challenge,
  onSignedIn,
}: {
  challenge: Challenge | null;
  onSignedIn: () => Promise<void>;
}) {
  const [backup, setBackup] = useState(false);
  const state = useAction();
  return (
    <AuthPage
      title={backup ? 'Резервный код' : 'Код подтверждения'}
      lead={
        backup
          ? 'Каждый резервный код можно использовать один раз.'
          : 'Введите шестизначный код из приложения-аутентификатора.'
      }
    >
      {!challenge ? (
        <>
          <Notice>
            Сначала введите имя и пароль. Незавершённый вход не сохраняется после перезагрузки
            страницы.
          </Notice>
          <BackToLogin />
        </>
      ) : (
        <>
          <AuthForm
            key={String(backup)}
            state={state}
            submit="Подтвердить вход"
            onSubmit={(event) => {
              const { form, text } = formValues(event);
              const code = text('code').trim();
              const trustDevice = challenge.trustDeviceAllowed && text('trust') === 'on';
              clearSecrets(form);
              void state.run(async () => {
                await action(
                  backup ? 'auth/two-factor/verify-backup-code' : 'auth/two-factor/verify-totp',
                  { code, trustDevice },
                );
                await onSignedIn();
              });
            }}
          >
            <label className="auth-field">
              <span>{backup ? 'Резервный код' : 'Код из приложения'}</span>
              <input
                key={String(backup)}
                name="code"
                className="auth-code"
                autoComplete="one-time-code"
                inputMode={backup ? 'text' : 'numeric'}
                autoCapitalize="none"
                spellCheck={false}
                required
                pattern={backup ? undefined : '[0-9]{6}'}
                minLength={backup ? 1 : 6}
                maxLength={backup ? 32 : 6}
              />
            </label>
            {challenge.trustDeviceAllowed ? (
              <label className="auth-checkbox">
                <input type="checkbox" name="trust" />
                <span>
                  Доверять этому устройству 30 дней
                  <small>Только на своём телефоне или компьютере</small>
                </span>
              </label>
            ) : (
              <p className="auth-hint">Администратор подтверждает каждый вход кодом.</p>
            )}
          </AuthForm>
          <div className="auth-links">
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setBackup(!backup);
                state.setError(null);
              }}
            >
              {backup ? 'Ввести код из приложения' : 'Использовать резервный код'}
            </button>
            <BackToLogin />
          </div>
        </>
      )}
    </AuthPage>
  );
}

export function ForgotScreen() {
  const state = useAction();
  const [sent, setSent] = useState(false);
  return (
    <AuthPage
      title="Восстановить доступ"
      lead="Восстановление по почте работает, если на сервере настроена отправка писем."
    >
      {sent ? (
        <Notice>
          Если этот адрес связан с учётной записью, письмо придёт со ссылкой. Ссылка действует один
          час.
        </Notice>
      ) : (
        <AuthForm
          state={state}
          submit="Отправить ссылку"
          onSubmit={(event) => {
            const { text } = formValues(event);
            void state.run(async () => {
              await action('auth/request-password-reset', {
                email: text('email').trim(),
                redirectTo: appURL('/reset-password'),
              });
              setSent(true);
            });
          }}
        >
          <label className="auth-field">
            <span>Почта</span>
            <input name="email" type="email" autoComplete="email" required maxLength={254} />
          </label>
        </AuthForm>
      )}
      <p className="auth-footnote">
        Ребёнку без почты ссылку выдаёт администратор дома. Пароль взрослого администратор сбросить
        не может.
      </p>
      <BackToLogin />
    </AuthPage>
  );
}

export function ResetScreen({ token }: { token: string | null }) {
  const state = useAction();
  const [done, setDone] = useState(false);
  return (
    <AuthPage
      title={done ? 'Пароль изменён' : 'Новый пароль'}
      lead={
        done
          ? 'На других устройствах нужно войти заново.'
          : 'Задайте пароль для своей учётной записи.'
      }
    >
      {done ? (
        <Notice>Теперь можно войти с новым паролем.</Notice>
      ) : !token ? (
        <Notice error>
          Ссылка недействительна. Откройте ссылку из письма или попросите новую у администратора.
        </Notice>
      ) : (
        <AuthForm
          state={state}
          submit="Сохранить пароль"
          onSubmit={(event) => {
            const { form, text } = formValues(event);
            const newPassword = text('password');
            if (newPassword !== text('repeatPassword')) {
              state.setError(new ApiError(400, 'PASSWORD_MISMATCH'));
              return;
            }
            clearSecrets(form);
            void state.run(async () => {
              await action('auth/reset-password', { token, newPassword });
              setDone(true);
            });
          }}
        >
          <PasswordField label="Новый пароль" newPassword />
          <PasswordField name="repeatPassword" label="Повторите новый пароль" newPassword />
          <p className="auth-hint">Если пароли отличаются, введите их одинаково.</p>
        </AuthForm>
      )}
      <BackToLogin />
    </AuthPage>
  );
}

export function InvitationScreen({
  token,
  onAccepted,
}: {
  token: string | null;
  onAccepted: () => Promise<void>;
}) {
  const state = useAction();
  return (
    <AuthPage
      title="Приглашение в дом"
      lead="Создайте свою учётную запись. Роль уже указал администратор в приглашении."
    >
      {!token ? (
        <Notice error>
          Откройте ссылку-приглашение. Она действует 72 часа и используется один раз.
        </Notice>
      ) : (
        <AuthForm
          state={state}
          submit="Принять приглашение"
          onSubmit={(event) => {
            const { form, text } = formValues(event);
            const body = {
              token,
              displayName: text('displayName').trim(),
              username: text('username').trim(),
              password: text('password'),
              ...(text('email').trim() ? { email: text('email').trim() } : {}),
            };
            clearSecrets(form);
            void state.run(async () => {
              await action('auth/homecrm/invitation/accept', body);
              await onAccepted();
            });
          }}
        >
          <label className="auth-field">
            <span>Как вас зовут</span>
            <input name="displayName" autoComplete="given-name" required maxLength={60} />
          </label>
          <label className="auth-field">
            <span>Имя пользователя</span>
            <input
              name="username"
              aria-label="Имя пользователя"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              minLength={3}
              maxLength={30}
              pattern={'[\\p{L}\\p{N}][\\p{L}\\p{N}._\\-]*'}
            />
            <small>От 3 до 30 букв, цифр, точек, дефисов или подчёркиваний</small>
          </label>
          <label className="auth-field">
            <span>
              Почта <small>необязательно</small>
            </span>
            <input name="email" type="email" autoComplete="email" maxLength={254} />
          </label>
          <PasswordField newPassword />
        </AuthForm>
      )}
      <BackToLogin />
    </AuthPage>
  );
}
