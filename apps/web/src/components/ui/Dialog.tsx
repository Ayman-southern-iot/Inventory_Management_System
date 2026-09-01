import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { t } from '@/i18n/en';
import type { ZodTypeAny } from 'zod';
import { RequiredFields } from './RequiredFields';

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * The form contract this dialog edits. Every control inside then marks itself required from
   * the same schema the resolver validates with, instead of each field carrying a hand-kept
   * `required` that drifts when the contract changes. See `RequiredFields`.
   */
  schema?: ZodTypeAny;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps focus and closes on Escape (rules/30-frontend.md accessibility floor). Hand-rolled
 * rather than pulled from a library because it is 60 lines and this is the only dialog
 * behaviour the app needs.
 */
export function Dialog({ open, title, onClose, children, footer, schema }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      restoreFocusTo.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 pt-[10vh]">
      {/* The backdrop closes the dialog, but only when the click starts on the backdrop
          itself — otherwise a drag that ends outside would discard a half-filled form. */}
      <div className="absolute inset-0" onMouseDown={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-lg rounded-[--radius-panel] border border-border bg-surface shadow-[--shadow-overlay]"
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.common.close}
            className="text-ink-subtle hover:text-ink"
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>
        <div className="px-5 py-4">
          {schema ? <RequiredFields schema={schema}>{children}</RequiredFields> : children}
        </div>
        {footer ? (
          <footer className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
