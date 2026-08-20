import { useEffect, useState } from 'react';
import type { RequisitionDetail, RequisitionFunding } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { formatBdt } from '@/lib/format';
import {
  useRecordPurchase,
  useRecordReceipt,
  useSendToAccounts,
  useUnverifyPurchase,
  useVerifyPurchase,
} from '../api';
import { ReceiveToStockForm } from './ReceiveToStockForm';

export type FundsAction =
  | 'send-to-accounts'
  | 'receipt'
  | 'purchase'
  | 'verify'
  | 'unverify'
  | 'stock';

const TITLES: Record<FundsAction, string> = {
  'send-to-accounts': t.funds.sendToAccounts,
  receipt: t.funds.recordReceipt,
  purchase: t.funds.recordPurchase,
  verify: t.funds.verifyPurchase,
  unverify: t.funds.unverifyPurchase,
  stock: t.funds.receiveToStock,
};

/** Today, in the browser's calendar — the default for every "when did this happen" field. */
function today(): string {
  return new Intl.DateTimeFormat('en-CA').format(new Date());
}

/**
 * What verify-purchase should offer to send back: everything released that was neither spent
 * nor already returned. The dialog prints this same figure one line above the field, so a
 * hard '0' default made the IM read it and retype it — and the time they forgot, the balance
 * stayed out of Accounts' books with nothing to say it had been missed.
 */
function defaultReturnedAmount(funding: RequisitionFunding | null): string {
  return funding && funding.unspent > 0 ? String(funding.unspent) : '0';
}

/**
 * One dialog, switching on the action. The forms are small and share the same submit/close/toast
 * shape, so five separate dialog components would be five copies of the same wiring.
 */
export function FundsActionDialog({
  action,
  requisition,
  funding,
  bomQuantities,
  onClose,
}: {
  action: FundsAction | null;
  requisition: RequisitionDetail;
  funding: RequisitionFunding | null;
  /**
   * Per-line quantity the IM set when generating the BOM. Indexed by `requisitionItemId`.
   * Empty when the requisition has no live BOM (e.g. older requisitions pre-dating the
   * BOM flow); the dialog falls back to `requisition.items[].quantity` in that case.
   *
   * The server still re-derives this defensively (see `FundsService.recordPurchase`),
   * but mirroring it on the client means the label and the wire payload reflect what
   * the IM actually planned.
   */
  bomQuantities?: Map<string, number>;
  onClose: () => void;
}) {
  const toast = useToast();
  const sendToAccounts = useSendToAccounts(requisition.id);
  const recordReceipt = useRecordReceipt(requisition.id);
  const recordPurchase = useRecordPurchase(requisition.id);
  const verify = useVerifyPurchase(requisition.id);
  const unverify = useUnverifyPurchase(requisition.id);

  // Form state, reset whenever the dialog opens so a previous attempt never leaks into the next.
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [when, setWhen] = useState(today());
  const [reference, setReference] = useState('');
  const [vendor, setVendor] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [unitCosts, setUnitCosts] = useState<Record<string, string>>({});
  const [returnedAmount, setReturnedAmount] = useState(() => defaultReturnedAmount(funding));

  useEffect(() => {
    if (!action) return;
    setNote('');
    setWhen(today());
    setReference('');
    setVendor('');
    setInvoiceNo('');
    setReturnedAmount(defaultReturnedAmount(funding));
    // Pre-fill the receipt with what is still outstanding: the common case is Accounts releasing
    // exactly the remainder, and typing it again is friction.
    setAmount(funding && funding.outstanding > 0 ? String(funding.outstanding) : '');
    setUnitCosts({});
  }, [action, funding]);

  const busy =
    sendToAccounts.isPending ||
    recordReceipt.isPending ||
    recordPurchase.isPending ||
    verify.isPending ||
    unverify.isPending;

  async function onSubmit() {
    if (!action) return;
    try {
      switch (action) {
        case 'send-to-accounts':
          await sendToAccounts.mutateAsync({ note: note.trim() || null });
          toast.success(t.funds.sentToAccounts);
          break;
        case 'receipt':
          await recordReceipt.mutateAsync({
            amount: Number(amount),
            // The date input gives a calendar day; the API wants an instant.
            receivedAt: new Date(`${when}T00:00:00`).toISOString(),
            reference: reference.trim() || null,
            note: note.trim() || null,
          });
          toast.success(t.funds.receiptRecorded);
          break;
        case 'purchase':
          await recordPurchase.mutateAsync({
            vendor: vendor.trim(),
            invoiceNo: invoiceNo.trim() || null,
            purchasedAt: new Date(`${when}T00:00:00`).toISOString(),
            note: note.trim() || null,
            lines: requisition.items
              .filter((item) => Number(unitCosts[item.id] ?? '') > 0)
              .map((item) => {
                // Prefer the BOM-edited quantity. The IM may have shrunk a 50-unit line
                // to 30 in the BOM customiser; the wire payload must reflect what was
                // actually bought, not the original requisition quantity. The server
                // also re-derives this as a ceiling defense-in-depth.
                const bomQuantity = bomQuantities?.get(item.id);
                const quantity = bomQuantity ?? item.quantity;
                return {
                  requisitionItemId: item.id,
                  quantity,
                  unitCost: Number(unitCosts[item.id]),
                  overBomQuantity: bomQuantity !== undefined && item.quantity > bomQuantity,
                  overBomNote: null,
                };
              }),
          });
          toast.success(t.funds.purchaseRecorded);
          break;
        case 'verify':
          await verify.mutateAsync({
            returnedAmount: Number(returnedAmount) || 0,
            returnNote: note.trim() || null,
          });
          toast.success(t.funds.purchaseVerified);
          break;
        case 'unverify':
          await unverify.mutateAsync({
            reason: note.trim(),
          });
          toast.success(t.funds.purchaseUnverified);
          break;
        default:
          return;
      }
      onClose();
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  // Receiving into stock has its own form: it is per purchase line, with an optional new-product
  // block, and folding it in here would double this component's size.
  if (action === 'stock') {
    return (
      <ReceiveToStockForm
        requisitionId={requisition.id}
        funding={funding}
        onClose={onClose}
      />
    );
  }

  return (
    <Dialog
      open={action !== null}
      onClose={onClose}
      title={action ? TITLES[action] : ''}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t.common.cancel}
          </Button>
          <Button onClick={() => void onSubmit()} isLoading={busy}>
            {t.common.save}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {action === 'send-to-accounts' && (
          <p className="text-sm text-ink-muted">{t.funds.sendToAccountsHint}</p>
        )}

        {action === 'receipt' && (
          <>
            <TextField
              label={t.funds.amount}
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <TextField
              label={t.funds.receivedAt}
              type="date"
              value={when}
              onChange={(event) => setWhen(event.target.value)}
            />
            <TextField
              label={t.funds.reference}
              hint={t.funds.referenceHint}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </>
        )}

        {action === 'purchase' && (
          <>
            <TextField
              label={t.funds.vendor}
              value={vendor}
              onChange={(event) => setVendor(event.target.value)}
            />
            <TextField
              label={t.funds.invoiceNo}
              value={invoiceNo}
              onChange={(event) => setInvoiceNo(event.target.value)}
            />
            <TextField
              label={t.funds.purchasedAt}
              type="date"
              value={when}
              onChange={(event) => setWhen(event.target.value)}
            />
            <div className="flex flex-col gap-2">
              {requisition.items.map((item) => {
                // The label and the wire payload agree on the quantity — BOM-edited if
                // a BOM exists, otherwise the original requisition quantity. Keeps the
                // IM from typing a unit cost for 50 units when only 30 were planned.
                const bomQuantity = bomQuantities?.get(item.id);
                const quantity = bomQuantity ?? item.quantity;
                return (
                  <TextField
                    key={item.id}
                    label={`${item.itemName} × ${quantity}`}
                    hint={t.funds.unitCost}
                    type="number"
                    min={0}
                    step="0.01"
                    value={unitCosts[item.id] ?? ''}
                    onChange={(event) =>
                      setUnitCosts((previous) => ({ ...previous, [item.id]: event.target.value }))
                    }
                  />
                );
              })}
            </div>
          </>
        )}

        {action === 'verify' && (
          <>
            {funding && (
              <p className="text-sm text-ink-muted">
                {t.funds.unspent}: <strong>{formatBdt(funding.unspent)}</strong>
                {funding.transportation > 0 ? (
                  <>
                    {' '}
                    <span className="text-ink-subtle">
                      ({t.funds.transportationNote}: {formatBdt(funding.transportation)})
                    </span>
                  </>
                ) : null}
              </p>
            )}
            <TextField
              label={t.funds.returnedAmount}
              hint={t.funds.returnedAmountHint}
              type="number"
              min={0}
              step="0.01"
              value={returnedAmount}
              onChange={(event) => setReturnedAmount(event.target.value)}
            />
          </>
        )}

        {action === 'unverify' && (
          <p className="text-sm text-ink-muted">{t.funds.unverifyPurchaseHint}</p>
        )}

        <TextAreaField
          label={
            action === 'verify'
              ? t.funds.returnNote
              : action === 'unverify'
                ? t.funds.unverifyReason
                : t.common.note
          }
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
    </Dialog>
  );
}
