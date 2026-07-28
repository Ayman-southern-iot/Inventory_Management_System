import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { t } from '@/i18n/en';

type ToastTone = 'success' | 'danger';

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TOAST_TIMEOUT_MS = 5_000;

const TONE_STYLES: Record<ToastTone, string> = {
  success: 'border-success bg-success-subtle text-ink',
  danger: 'border-danger bg-danger-subtle text-ink',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = (nextId.current += 1);
      setToasts((current) => [...current, { id, tone, message }]);
      window.setTimeout(() => dismiss(id), TOAST_TIMEOUT_MS);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message: string) => push('success', message),
      error: (message: string) => push('danger', message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* aria-live so a screen reader announces the result of an action it cannot see. */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex items-start gap-2 rounded-[--radius-panel] border px-3 py-2.5',
              'shadow-[--shadow-overlay]',
              TONE_STYLES[toast.tone],
            )}
          >
            {toast.tone === 'success' ? (
              <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
            ) : (
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
            )}
            <p className="flex-1 text-sm">{toast.message}</p>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label={t.common.close}
              className="text-ink-subtle hover:text-ink"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a ToastProvider');
  return context;
}
