import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  /** По умолчанию 7 секунд: столько же даётся на отмену выполнения (TASK-7). */
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
const DEFAULT_DURATION_MS = 7000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ActiveToast | null>(null);

  const show = useCallback((options: ToastOptions) => {
    setToast((previous) => ({ ...options, id: (previous?.id ?? 0) + 1 }));
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
  const durationMs = toast?.durationMs ?? DEFAULT_DURATION_MS;

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
                toast.action?.onClick();
                dismiss();
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
