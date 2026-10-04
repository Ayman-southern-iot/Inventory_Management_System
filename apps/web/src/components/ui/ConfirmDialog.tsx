import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { t } from '@/i18n/en';

/**
 * "Are you sure?", for an action that is one click and cannot be undone from where it was clicked.
 *
 * `ReasonDialog` is for the actions somebody must explain later; this is for the ones that only
 * need a second look. Said in the dialog's own words what will happen, because "Are you sure?" on
 * its own makes people click through. Message audit M6: deactivating a user, a department or a
 * compartment, and rejecting a borrow, all happened on the first click.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  isPending,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  /** What will happen, in a sentence a person can act on. */
  body: string;
  confirmLabel: string;
  isPending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
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
          <Button variant="danger" isLoading={isPending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-muted">{body}</p>
    </Dialog>
  );
}
