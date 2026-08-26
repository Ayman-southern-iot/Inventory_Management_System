import { Download } from 'lucide-react';
import type { Purchase } from '@ims/shared';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { formatBdt, formatDateTime } from '@/lib/format';
import { invoicePath } from '../api';

/**
 * One purchase in the funding panel, with a link to its invoice.
 *
 * Read-only since phase 08. Attaching now happens inside the verify-purchase form, which is the
 * step that *requires* the invoice — the IM was previously refused by Verify, then had to close
 * it and come back here to attach, then reopen Verify.
 *
 * The download is a blob fetch rather than an anchor href: the endpoint is bearer-authenticated
 * and a plain link carries no token. The object URL is revoked as soon as the click is handed to
 * the browser, which is enough — the download has already started by then.
 */
export function InvoiceRow({
  requisitionId,
  purchase,
}: {
  requisitionId: string;
  purchase: Purchase;
}) {
  const toast = useToast();

  async function onDownload() {
    try {
      const blob = await api.blob(invoicePath(requisitionId, purchase.id));
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${purchase.vendor}-invoice`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  const outstanding = purchase.lines.reduce((sum, line) => sum + line.outstandingQuantity, 0);

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <div className="min-w-0">
        <p className="text-ink">
          {purchase.vendor} · {formatBdt(purchase.totalAmount)}
          {purchase.invoiceNo ? ` · ${purchase.invoiceNo}` : ''}
        </p>
        <p className="text-xs text-ink-subtle">
          {formatDateTime(purchase.purchasedAt)}
          {' · '}
          {outstanding > 0 ? t.funds.lineOutstanding(outstanding) : t.funds.lineDone}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {purchase.hasInvoice ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void onDownload()}
            icon={<Download aria-hidden className="size-4" />}
          >
            {t.funds.downloadInvoice}
          </Button>
        ) : (
          <Badge tone="pending">{t.funds.invoiceMissing}</Badge>
        )}
      </div>
    </li>
  );
}
