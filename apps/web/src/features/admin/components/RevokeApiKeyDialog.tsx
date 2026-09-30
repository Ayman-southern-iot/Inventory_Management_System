import type { ApiKey } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useRevokeApiKey } from '../api';

interface RevokeApiKeyDialogProps {
  /** The key being revoked; the dialog is open while this is set. */
  apiKey: ApiKey | undefined;
  onClose: () => void;
}

/** Revoking is permanent, so it is always asked, in-app, with the alternative named. */
export function RevokeApiKeyDialog({ apiKey, onClose }: RevokeApiKeyDialogProps) {
  const toast = useToast();
  const revokeKey = useRevokeApiKey();

  async function confirmRevoke() {
    if (!apiKey) return;
    try {
      await revokeKey.mutateAsync(apiKey.id);
      toast.success(t.apiKeys.wasRevoked);
      onClose();
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  return (
    <Dialog
      open={apiKey !== undefined}
      onClose={onClose}
      title={t.apiKeys.revokeConfirmTitle}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button variant="danger" onClick={() => void confirmRevoke()}>
            {t.apiKeys.revoke}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-muted">{t.apiKeys.revokeConfirmBody}</p>
    </Dialog>
  );
}
