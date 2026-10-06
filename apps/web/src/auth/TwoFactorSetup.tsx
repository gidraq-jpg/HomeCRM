import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { action, api, Enrollment } from './api.ts';
import {
  AuthForm,
  AuthPage,
  clearSecrets,
  formValues,
  Notice,
  PasswordField,
  useAction,
} from './components.tsx';

export function RecoveryCodes({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  return (
    <section className="recovery-codes" aria-label="Коды восстановления">
      <h2>Сохраните резервные коды</h2>
      <p>Храните их в надёжном месте вне HomeCRM. Каждый код заменяет второй фактор один раз.</p>
      <ol className="backup-grid">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ol>
      <button className="btn btn--secondary btn--block" type="button" onClick={onClose}>
        Я сохранил коды
      </button>
    </section>
  );
}

function Authenticator({ uri }: { uri: string }) {
  const [qr, setQr] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(uri, { width: 240, margin: 4, errorCorrectionLevel: 'M' }).then(
      (image) => {
        if (active) setQr(image);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [uri]);
  const key = new URL(uri).searchParams.get('secret') ?? '';
  return (
    <section className="authenticator" aria-label="Подключить аутентификатор">
      <h2>Добавьте HomeCRM в приложение</h2>
      <p>Отсканируйте QR-код приложением-аутентификатором или введите ключ вручную.</p>
      {qr ? (
        <img width={240} height={240} src={qr} alt="QR-код настройки второго фактора" />
      ) : (
        <Notice>
          {failed ? 'QR-код не удалось построить. Используйте ключ ниже.' : 'Готовим QR-код…'}
        </Notice>
      )}
      <p className="auth-hint">Ключ для ручного ввода</p>
      <code className="auth-secret">{key}</code>
      <a className="text-button" href={uri}>
        Открыть приложение на этом телефоне
      </a>
    </section>
  );
}

export function TwoFactorSetup({
  required,
  onComplete,
}: {
  required: boolean;
  onComplete: () => Promise<void>;
}) {
  const [enrollment, setEnrollment] = useState<null | { totpURI: string; backupCodes: string[] }>(
    null,
  );
  const [saved, setSaved] = useState(false);
  const [verified, setVerified] = useState(false);
  const state = useAction();
  return (
    <AuthPage
      title={verified ? 'Второй фактор включён' : 'Защитить вход'}
      lead={
        required
          ? 'Администратору нужен второй фактор. Пока он не включён, данные дома недоступны.'
          : 'Второй фактор защищает учётную запись, даже если пароль станет известен.'
      }
    >
      {!enrollment ? (
        <AuthForm
          state={state}
          submit="Настроить второй фактор"
          onSubmit={(event) => {
            const { form, text } = formValues(event);
            const password = text('password');
            clearSecrets(form);
            void state.run(async () => {
              setEnrollment(await api('auth/two-factor/enable', Enrollment, { password }));
            });
          }}
        >
          <PasswordField label="Подтвердите пароль" />
        </AuthForm>
      ) : (
        <>
          {!saved && (
            <RecoveryCodes codes={enrollment.backupCodes} onClose={() => setSaved(true)} />
          )}
          {!verified && (
            <>
              <Authenticator uri={enrollment.totpURI} />
              <AuthForm
                state={state}
                submit="Включить второй фактор"
                onSubmit={(event) => {
                  const { form, text } = formValues(event);
                  const code = text('code');
                  clearSecrets(form);
                  void state.run(async () => {
                    await action('auth/two-factor/verify-totp', { code });
                    setVerified(true);
                  });
                }}
              >
                <label className="auth-field">
                  <span>Код из приложения</span>
                  <input
                    name="code"
                    className="auth-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    required
                    minLength={6}
                    maxLength={6}
                  />
                </label>
              </AuthForm>
            </>
          )}
          {verified && (
            <>
              <Notice>При следующем входе введите код из приложения или один резервный код.</Notice>
              <button
                className="btn btn--primary btn--block"
                type="button"
                disabled={!saved || state.disabled}
                onClick={() =>
                  void state.run(async () => {
                    setEnrollment(null);
                    await onComplete();
                  })
                }
              >
                Продолжить
              </button>
              {!saved && <p className="auth-hint">Сначала сохраните резервные коды.</p>}
            </>
          )}
        </>
      )}
      {!required && !enrollment && (
        <Link className="text-button" to="/more/settings">
          Вернуться в настройки
        </Link>
      )}
    </AuthPage>
  );
}
