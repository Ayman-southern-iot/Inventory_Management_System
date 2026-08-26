import { useRef } from 'react';
import { Paperclip } from 'lucide-react';
import type { Purchase } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useAttachInvoice } from '../api';

/**
 * Attach or replace one purchase's invoice.
 *
 * Lives on its own because verification *requires* every purchase to have one — `FundsService`
 * throws `INVOICE_MISSING` — and the attach control used to sit in the funding panel's purchase
 * list instead. That meant the IM opened Verify, was refused, closed it, scrolled to the list,
 * attached, and opened Verify again. Ayman, 2026-08-26: "attached invoice should be in verify
 * purchase form not in separate."
 *
 * The file input is visually hidden rather than styled: browsers give no useful hooks for
 * restyling the native control, and a button that clicks a hidden input is the standard answer.
 */
export function InvoiceAttachButton({
  requisitionId,
  purchase,
  size = 'sm',
}: {
  requisitionId: string;
  purchase: Purchase;
  size?: 'sm' | 'md';
}) {
  const toast = useToast();
  const attach = useAttachInvoice(requisitionId);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared before the await so picking the same file twice in a row still fires a change.
    event.target.value = '';
    if (!file) return;
    try {
      await attach.mutateAsync({ purchaseId: purchase.id, file });
      toast.success(t.funds.invoiceAttached);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        className="sr-only"
        aria-label={`${t.funds.attachInvoice} — ${purchase.vendor}`}
        onChange={(event) => void onPick(event)}
      />
      <Button
        variant="secondary"
        size={size}
        isLoading={attach.isPending}
        onClick={() => inputRef.current?.click()}
        icon={<Paperclip aria-hidden className="size-4" />}
      >
        {purchase.hasInvoice ? t.funds.replaceInvoice : t.funds.attachInvoice}
      </Button>
    </>
  );
}
