import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  message: string;
  /** Вторая строка: пояснение, например почему запись не видна при выбранном фильтре. */
  detail?: string;
  action?: ToastAction;
  /** Обычное сообщение — 4,5 с; действие отмены сохраняет своё окно (TASK-7). */
  durationMs?: number;
}

interface ActiveToast extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  toast: ActiveToast | null;
  show: (options: ToastOptions) => void;
  dismiss: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
const DEFAULT_DURATION_MS = 4500;

/** У отмены («Отменить» / «Вернуть») сохраняется окно, заданное операцией. */
export function toastDuration(options: ToastOptions | null): number {
  return options?.action && ['Отменить', 'Вернуть'].includes(options.action.label)
    ? (options.durationMs ?? 7000)
    : DEFAULT_DURATION_MS;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const sequence = useRef(0);

  const show = useCallback((options: ToastOptions) => {
    setToast({ ...options, id: ++sequence.current });
  }, []);
  const dismiss = useCallback(() => setToast(null), []);

  const value = useMemo(() => ({ toast, show, dismiss }), [toast, show, dismiss]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

function useToastContext(): ToastContextValue {
  const value = useContext(ToastContext);
  if (value === null) throw new Error('Тосты работают только внутри ToastProvider');
  return value;
}

/** Показать короткое сообщение внизу экрана. */
export function useToast(): Pick<ToastContextValue, 'show' | 'dismiss'> {
  const { show, dismiss } = useToastContext();
  return useMemo(() => ({ show, dismiss }), [show, dismiss]);
}

/** Область сообщений: читалки экрана озвучивают новое сообщение (role="status"). */
export function ToastRegion() {
  const { toast, dismiss } = useToastContext();
  const id = toast?.id;
  const durationMs = toastDuration(toast);

  useEffect(() => {
    if (id === undefined) return;
    const timer = window.setTimeout(dismiss, durationMs);
    return () => window.clearTimeout(timer);
  }, [id, durationMs, dismiss]);

  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast ? (
        <div className="toast" key={toast.id}>
          <div className="toast__text">
            <span>{toast.message}</span>
            {toast.detail ? <span className="toast__detail">{toast.detail}</span> : null}
          </div>
          {toast.action ? (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                dismiss();
                toast.action?.onClick();
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
