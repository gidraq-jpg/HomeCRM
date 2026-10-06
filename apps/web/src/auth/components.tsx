import { House, WifiSlash } from '@phosphor-icons/react';
import { type FormEvent, type ReactNode, useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { usePageTitle } from '../ui/Page.tsx';
import { errorMessage } from './api.ts';

export function AuthPage({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  usePageTitle(title);
  useEffect(() => {
    const heading = document.querySelector<HTMLElement>('.auth-page h1');
    if (heading?.textContent === title) heading.focus();
  }, [title]);
  return (
    <main className="auth-page">
      <div className="auth-brand">
        <House size={28} weight="regular" aria-hidden />
        <span>HomeCRM</span>
      </div>
      <header className="auth-heading">
        <h1 tabIndex={-1}>{title}</h1>
        {lead && <p>{lead}</p>}
      </header>
      {children}
    </main>
  );
}
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <div
      className={`auth-notice ${error ? 'auth-notice--error' : ''}`}
      role={error ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}
export function ErrorNotice({ error }: { error: unknown }) {
  return error ? <Notice error>{errorMessage(error)}</Notice> : null;
}
export function useOnline() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}
export function OfflineBanner() {
  const online = useOnline();
  return online ? null : (
    <div className="offline-banner" role="status">
      <WifiSlash size={22} aria-hidden />
      <span>
        <strong>Без сети</strong> · Для входа и сохранения нужно подключение.
      </span>
    </div>
  );
}
/** Отдельное состояние для каждой формы. Секреты не сохраняются в кэше мутаций. */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState('');
  const online = useOnline();
  async function run(work: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    setError(null);
    setDone('');
    try {
      await work();
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(false);
    }
  }
  return { pending, error, done, setDone, setError, run, disabled: pending || !online };
}
export function AuthForm({
  state,
  onSubmit,
  children,
  submit = 'Продолжить',
}: {
  state: ReturnType<typeof useAction>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
  submit?: string;
}) {
  return (
    <form className="auth-form" onSubmit={onSubmit} aria-busy={state.pending}>
      {children}
      <ErrorNotice error={state.error} />
      {state.done && <Notice>{state.done}</Notice>}
      <button className="btn btn--primary btn--block" disabled={state.disabled} type="submit">
        {state.pending ? 'Подождите…' : submit}
      </button>
    </form>
  );
}
export function PasswordField({
  label = 'Пароль',
  name = 'password',
  newPassword = false,
}: {
  label?: string;
  name?: string;
  newPassword?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <span className="password-field">
        <input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          autoComplete={newPassword ? 'new-password' : 'current-password'}
          required
          minLength={newPassword ? 10 : 1}
          maxLength={128}
        />
        <button
          type="button"
          className="text-button"
          aria-label={visible ? `Скрыть: ${label}` : `Показать: ${label}`}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? 'Скрыть' : 'Показать'}
        </button>
      </span>
      {newPassword && <small>Не менее 10 символов</small>}
    </div>
  );
}
export function BackToLogin() {
  return (
    <Link className="text-button" to="/sign-in">
      К входу
    </Link>
  );
}
export function formValues(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  return { form, text: (key: string) => String(data.get(key) ?? '') };
}
export function clearSecrets(form: HTMLFormElement) {
  for (const input of form.querySelectorAll<HTMLInputElement>(
    'input[name*="assword"], input[name="code"]',
  ))
    input.value = '';
}
