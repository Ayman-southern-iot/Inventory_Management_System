import { useEffect, useState } from 'react';
import type { RequisitionDetail, RequisitionFunding } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { fieldErrorsFor, messageForError } from '@/lib/error-message';
import { formatBdt, formatDateTime } from '@/lib/format';
import {
  useRecordPurchase,
  useRecordReceipt,
  useSendToAccounts,
  useUndoSendToAccounts,
  useUnverifyPurchase,
  useVerifyPurchase,
  useVoidPurchase,
  useVoidReceipt,
} from '../api';
import { InvoiceAttachButton } from './InvoiceAttachButton';
import { ReceiveToStockForm } from './ReceiveToStockForm';

export type FundsAction =
  | 'send-to-accounts'
  | 'receipt'
  | 'purchase'
  | 'verify'
  | 'unverify'
  /* Phase 08 — the way back from each money stage. */
  | 'undo-send'
  | 'void-receipt'
  | 'void-purchase'
  | 'stock';

/** The reversals. Each takes a mandatory reason, which is what the Save guard keys on. */
const REVERSALS: readonly FundsAction[] = ['unverify', 'undo-send', 'void-receipt', 'void-purchase'];

/**
 * What to call the free-text box. A reversal asks *why*, and says so — the same field labelled
 * "Note" reads as optional, and on these four it is the record of a decision.
 */
const REASON_LABEL: Partial<Record<FundsAction, string>> = {
  verify: t.funds.returnNote,
  unverify: t.funds.unverifyReason,
  'undo-send': t.funds.undoSendReason,
  'void-receipt': t.funds.voidReceiptReason,
  'void-purchase': t.funds.voidPurchaseReason,
};

const TITLES: Record<FundsAction, string> = {
  'send-to-accounts': t.funds.sendToAccounts,
  receipt: t.funds.recordReceipt,
  purchase: t.funds.recordPurchase,
  verify: t.funds.verifyPurchase,
  unverify: t.funds.unverifyPurchase,
  'undo-send': t.funds.undoSendToAccounts,
  'void-receipt': t.funds.voidReceipt,
  'void-purchase': t.funds.voidPurchase,
  stock: t.funds.receiveToStock,
};

/**
 * The entry a Back press would undo: the most recent live one.
 *
 * `listReceipts` and `listPurchases` both order oldest-first, so the last element is the newest —
 * and voided rows never reach the client, so "live" needs no filtering here. Naming it in the
 * dialog is the whole point: "Back" above a list of three receipts does not say which of them is
 * about to disappear.
 */
function mostRecentReceipt(funding: RequisitionFunding | null) {
  return funding && funding.receipts.length > 0
    ? funding.receipts[funding.receipts.length - 1]
    : undefined;
}

function mostRecentPurchase(funding: RequisitionFunding | null) {
  return funding && funding.purchases.length > 0
    ? funding.purchases[funding.purchases.length - 1]
    : undefined;
}

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
  const undoSend = useUndoSendToAccounts(requisition.id);
  const voidReceipt = useVoidReceipt(requisition.id);
  const voidPurchase = useVoidPurchase(requisition.id);

  // Form state, reset whenever the dialog opens so a previous attempt never leaks into the next.
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [when, setWhen] = useState(today());
  const [reference, setReference] = useState('');
  const [vendor, setVendor] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [unitCosts, setUnitCosts] = useState<Record<string, string>>({});
  const [returnedAmount, setReturnedAmount] = useState(() => defaultReturnedAmount(funding));
  /**
   * D-025: the server names the field it refused; the dialog now marks it instead of only
   * raising a toast that promised a highlight it never delivered.
   */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  /**
   * What is still owed. `funding.outstanding` is the server's own figure — the same one the
   * effect below pre-fills the amount with — so the cap and the default can never disagree.
   * Null with no funding record, in which case the input carries no cap rather than a made-up one.
   */
  const outstandingBalance = funding ? funding.outstanding : null;

  /** The entry a void would take out, named in the hint so the IM can see what they are undoing. */
  const voidingReceipt = mostRecentReceipt(funding);
  const voidingPurchase = mostRecentPurchase(funding);
  const needsReason = action !== null && REVERSALS.includes(action);

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
    unverify.isPending ||
    undoSend.isPending ||
    voidReceipt.isPending ||
    voidPurchase.isPending;

  async function onSubmit() {
    if (!action) return;
    // A retry starts from a clean slate, or a corrected field keeps wearing its old refusal.
    setFieldErrors({});
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
        case 'undo-send':
          await undoSend.mutateAsync({ reason: note.trim() });
          toast.success(t.funds.sendToAccountsUndone);
          break;
        case 'void-receipt': {
          // Re-read at submit rather than captured on open: the panel refetches funding on every
          // mutation, so an entry recorded in another tab between opening and submitting would
          // otherwise be voided instead of the one named in the hint.
          const receipt = mostRecentReceipt(funding);
          if (!receipt) return;
          await voidReceipt.mutateAsync({ receiptId: receipt.id, reason: note.trim() });
          toast.success(t.funds.receiptVoided);
          break;
        }
        case 'void-purchase': {
          const purchase = mostRecentPurchase(funding);
          if (!purchase) return;
          await voidPurchase.mutateAsync({ purchaseId: purchase.id, reason: note.trim() });
          toast.success(t.funds.purchaseVoided);
          break;
        }
        default:
          return;
      }
      onClose();
    } catch (error) {
      setFieldErrors(fieldErrorsFor(error));
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
          {/* Every reversal takes a mandatory reason (the schema's `min(1)`), so Save stays
              disabled until one is typed rather than round-tripping to a 400. */}
          <Button
            onClick={() => void onSubmit()}
            isLoading={busy}
            disabled={needsReason && note.trim().length === 0}
          >
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
              // D-025: the server refuses a receipt above the outstanding balance, so the input
              // says so up front rather than letting the user find out on submit. Omitted when
              // there is nothing sensible to cap against, so the browser never enforces a bound
              // the server does not.
              max={outstandingBalance ?? undefined}
              hint={
                outstandingBalance === null
                  ? undefined
                  : `${t.funds.outstandingHint} ${outstandingBalance.toLocaleString()}`
              }
              step="0.01"
              value={amount}
              error={fieldErrors.amount}
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
            {/* The invoices live here rather than in the panel's purchase list, because this is
                the step that refuses without them (INVOICE_MISSING). Every purchase on the
                requisition gets a row, so a three-vendor buy is three invoices in one place. */}
            {funding && funding.purchases.length > 0 && (
              <div className="rounded-[--radius-control] border border-border">
                <p className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  {t.funds.invoices}
                </p>
                <ul className="divide-y divide-border">
                  {funding.purchases.map((purchase) => (
                    <li
                      key={purchase.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-ink">
                          {purchase.vendor} · {formatBdt(purchase.totalAmount)}
                        </p>
                        <p className="text-xs">
                          {purchase.hasInvoice ? (
                            <span className="text-success">{t.funds.invoiceOnFile}</span>
                          ) : (
                            <span className="text-pending">{t.funds.invoiceMissing}</span>
                          )}
                        </p>
                      </div>
                      <InvoiceAttachButton
                        requisitionId={requisition.id}
                        purchase={purchase}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}

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

        {action === 'undo-send' && (
          <p className="text-sm text-ink-muted">{t.funds.undoSendToAccountsHint}</p>
        )}

        {/* Both void hints name the entry — amount and date, or amount and vendor — so nobody
            undoes the wrong instalment or the wrong vendor's purchase. */}
        {action === 'void-receipt' && voidingReceipt && (
          <p className="text-sm text-ink-muted">
            {t.funds.voidReceiptHint
              .replace('{amount}', formatBdt(voidingReceipt.amount))
              .replace('{when}', formatDateTime(voidingReceipt.receivedAt))}
          </p>
        )}

        {action === 'void-purchase' && voidingPurchase && (
          <p className="text-sm text-ink-muted">
            {t.funds.voidPurchaseHint
              .replace('{amount}', formatBdt(voidingPurchase.totalAmount))
              .replace('{vendor}', voidingPurchase.vendor)}
          </p>
        )}

        <TextAreaField
          label={REASON_LABEL[action ?? 'receipt'] ?? t.common.note}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
    </Dialog>
  );
}
