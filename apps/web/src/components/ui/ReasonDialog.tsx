import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { TextAreaField } from '@/components/ui/Field';
import { t } from '@/i18n/en';

/**
 * "Why are you doing this?", asked properly.
 *
 * Replaces `window.prompt`, which several reversal actions reached for. A native prompt cannot be
 * styled, cannot show a field error, is suppressible by the browser, and announces itself with the
 * hostname — "localhost says" over an otherwise finished application. It also cannot enforce that
 * the reason is non-empty without a second round trip.
 *
 * The reason is required here, because every action that uses this dialog is one somebody will
 * have to explain later: undoing an approval, taking back a rejection, reversing a borrow.
 */
export function ReasonDialog({
  open,
  title,
  description,
  label,
  confirmLabel,
  isPending,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  /** Optional sentence above the field, for actions whose consequence is not obvious. */
  description?: string;
  label: string;
  confirmLabel: string;
  isPending?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  // Cleared on open, never carried between two different reversals.
  useEffect(() => {
    if (open) {
      setReason('');
      setTouched(false);
    }
  }, [open]);

  const empty = reason.trim().length === 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button
            isLoading={isPending}
            onClick={() => {
              setTouched(true);
              if (empty) return;
              onConfirm(reason.trim());
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {description ? <p className="text-sm text-ink-muted">{description}</p> : null}
        <TextAreaField
          label={label}
          required
          rows={3}
          value={reason}
          error={touched && empty ? t.common.reasonRequired : undefined}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
    </Dialog>
  );
}
