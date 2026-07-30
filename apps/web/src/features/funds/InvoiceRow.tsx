import { useRef } from 'react';
import { Paperclip, Download } from 'lucide-react';
import type { Purchase } from '@ims/shared';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { formatBdt, formatDateTime } from '@/lib/format';
import { invoicePath, useAttachInvoice } from './api';

/**
 * One purchase, with its invoice.
 *
 * The download is a blob fetch rather than an anchor href: the endpoint is bearer-authenticated
 * and a plain link carries no token. The object URL is revoked as soon as the click is handed to
 * the browser, which is enough — the download has already started by then.
 */
export function InvoiceRow({
  requisitionId,
  purchase,
  canAct,
}: {
  requisitionId: string;
  purchase: Purchase;
  canAct: boolean;
}) {
  const toast = useToast();
  const attach = useAttachInvoice(requisitionId);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      await attach.mutateAsync({ purchaseId: purchase.id, file });
      toast.success(t.funds.invoiceAttached);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

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

        {canAct && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              className="sr-only"
              onChange={(event) => void onPick(event)}
            />
            <Button
              variant="secondary"
              size="sm"
              isLoading={attach.isPending}
              onClick={() => inputRef.current?.click()}
              icon={<Paperclip aria-hidden className="size-4" />}
            >
              {purchase.hasInvoice ? t.funds.replaceInvoice : t.funds.attachInvoice}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
