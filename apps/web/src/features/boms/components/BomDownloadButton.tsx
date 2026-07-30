import { Download } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useBomSignedUrl } from '../api';

/**
 * Fetches the BOM's signed PDF URL only when the IM clicks Download, then opens
 * the cached file in a new tab.
 *
 * The signed URL has a TTL (`PDF_SIGNED_URL_TTL_SECONDS`). Burning one at page
 * load would be wasted if the user only reads the BOM — the `enabled: false`
 * pattern keeps the call lazy. `window.open(url, '_blank')` is wrapped in a
 * try/catch because pop-up blockers can throw `SecurityError` in some
 * browsers; if that happens we toast instead of silently failing.
 */
export function BomDownloadButton({ id }: { id: string }) {
  const toast = useToast();
  const signed = useBomSignedUrl(id, false);

  async function onClick() {
    try {
      const result = await signed.refetch();
      if (!result.data) return;
      // The signed URL is a path relative to the API origin. The browser
      // resolves it in the new tab, and `Content-Disposition: inline` lets the
      // built-in PDF viewer render it without a download dialog.
      window.open(result.data.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      icon={<Download aria-hidden className="size-4" />}
      isLoading={signed.isFetching}
      disabled={signed.isFetching}
      onClick={onClick}
    >
      {t.boms.downloadPdf}
    </Button>
  );
}
