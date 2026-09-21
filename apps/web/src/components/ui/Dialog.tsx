import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { t } from '@/i18n/en';
import type { ZodTypeAny } from 'zod';
import { RequiredFields } from './RequiredFields';

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** One line under the title. Use it for a standing fact about the form, not an instruction. */
  subtitle?: string;
  footer?: ReactNode;
  /**
   * Pinned to the left of the footer, opposite the buttons — a secondary control that belongs
   * to the submit rather than to any one field, like 'Save and add another'.
   */
  footerStart?: ReactNode;
  /**
   * The form contract this dialog edits. Every control inside then marks itself required from
   * the same schema the resolver validates with, instead of each field carrying a hand-kept
   * `required` that drifts when the contract changes. See `RequiredFields`.
   */
  schema?: ZodTypeAny;
  /** 'lg' for a form with side-by-side columns. Default is the narrow single-column width. */
  size?: 'md' | 'lg';
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps focus and closes on Escape (rules/30-frontend.md accessibility floor). Hand-rolled
 * rather than pulled from a library because it is 60 lines and this is the only dialog
 * behaviour the app needs.
 */
export function Dialog({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  footerStart,
  schema,
  size = 'md',
}: DialogProps) {
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
        className={cn(
          'relative w-full rounded-[--radius-panel] border border-border bg-surface shadow-[--shadow-overlay]',
          size === 'lg' ? 'max-w-2xl' : 'max-w-lg',
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div>
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-ink-subtle">{subtitle}</p> : null}
          </div>
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
          <footer
            className={cn(
              'flex items-center gap-2 border-t border-border px-5 py-3.5',
              footerStart ? 'justify-between' : 'justify-end',
            )}
          >
            {footerStart ? <div>{footerStart}</div> : null}
            <div className="flex items-center gap-2">{footer}</div>
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
