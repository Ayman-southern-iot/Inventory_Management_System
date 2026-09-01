import { useEffect, useState } from 'react';
import {
  recordFundReceiptSchema,
  recordPurchaseSchema,
  type RequisitionDetail,
  type RequisitionFunding,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { fieldErrorsFor, messageForError } from '@/lib/error-message';
import { focusFirstInvalid } from '@/lib/focus-invalid';
import { requiredFields } from '@/lib/required-fields';
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
  bomLines,
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
  bomLines?: Map<string, { quantity: number; unitCost: number }>;
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
  /**
   * How many were actually bought, per line.
   *
   * The quantity used to be fixed at whatever the BOM said, so an IM who found six of the ten
   * on the shelf had no way to say so — they had to overstate the purchase and correct it
   * later, or not record it at all.
   */
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  /** The carriage this delivery actually cost, pre-filled from what was planned. */
  const [carriage, setCarriage] = useState('');
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
    // Opened on the figures already agreed, for the IM to adjust — the BOM unit cost where a
    // BOM exists, the requester's estimate otherwise. Typing every price again from blank was
    // what made a missed box so easy, and a form that starts empty tells the IM nothing about
    // what was planned.
    const seeded: Record<string, string> = {};
    for (const item of requisition.items) {
      const agreed = bomLines?.get(item.id)?.unitCost ?? item.estimatedUnitPrice;
      seeded[item.id] = agreed > 0 ? String(agreed) : '';
    }
    setUnitCosts(seeded);

    const seededQuantities: Record<string, string> = {};
    for (const item of requisition.items) {
      seededQuantities[item.id] = String(bomLines?.get(item.id)?.quantity ?? item.quantity);
    }
    setQuantities(seededQuantities);

    // The planned figure, for the IM to adjust. Only on a requisition that has not already
    // charged one: a second delivery on the same requisition usually shipped with the first,
    // and pre-filling the van again is how it gets paid for twice.
    const alreadyCharged = funding?.transportation ?? 0;
    const planned = requisition.transportationCost ?? 0;
    setCarriage(alreadyCharged > 0 ? '0' : planned > 0 ? String(planned) : '');
  }, [action, funding, requisition.items, bomLines]);

  const busy =
    sendToAccounts.isPending ||
    recordReceipt.isPending ||
    recordPurchase.isPending ||
    verify.isPending ||
    unverify.isPending ||
    undoSend.isPending ||
    voidReceipt.isPending ||
    voidPurchase.isPending;

  /**
   * What this action cannot be sent without, taken from the contract rather than listed here.
   *
   * `requiredFields` reads the same zod schema the API validates with, so a field that becomes
   * optional stops being marked without anybody remembering to come back and unmark it. The
   * dialog then only has to say which of its inputs carries which key.
   */
  /**
   * What this purchase would commit, and what there is to commit.
   *
   * Ayman's ruling, 2026-08-31: a purchase may not spend more than has been funded. Nothing
   * checked before — a 60,000 purchase against 40,500 funded was accepted, and the funding
   * panel then reported Spent 60,000 beside Funded 40,500 with Unspent floored at 0, which is
   * not a state the money can actually be in.
   *
   * Funded rather than approved, because you cannot spend cash you have not received: a
   * part-funded requisition is capped at the instalment in hand, not at what was sanctioned.
   * The carriage counts, since it is spent the moment a purchase exists.
   */
  /** What the IM has actually typed for a line, falling back to what was planned. */
  function quantityOf(itemId: string, planned: number): number {
    const typed = Number(quantities[itemId] ?? '');
    return Number.isFinite(typed) && typed > 0 ? typed : planned;
  }

  const purchaseTotal = requisition.items.reduce((sum, item) => {
    const cost = Number(unitCosts[item.id] ?? '');
    if (!Number.isFinite(cost) || cost <= 0) return sum;
    const planned = bomLines?.get(item.id)?.quantity ?? item.quantity;
    return sum + cost * quantityOf(item.id, planned);
  }, 0);

  const carriageAmount = Number(carriage === '' ? 0 : carriage);
  const thisCarriage = Number.isFinite(carriageAmount) && carriageAmount > 0 ? carriageAmount : 0;
  const alreadySpent = funding?.spent ?? 0;
  const alreadyCarried = funding?.transportation ?? 0;
  const fundedSoFar = funding?.funded ?? 0;
  const wouldCommit =
    Math.round((alreadySpent + alreadyCarried + purchaseTotal + thisCarriage) * 100) / 100;
  /**
   * What is left **after** this purchase, not before it.
   *
   * This read funded minus what had already gone, which on a fresh requisition is the whole
   * grant — so the screen showed "Left to spend: 3,400" beside a purchase committing exactly
   * 3,400, and the two numbers together said nothing. The figure the IM is watching is whether
   * there is anything left once they press the button.
   */
  const remaining = Math.round((fundedSoFar - wouldCommit) * 100) / 100;
  const overspends = fundedSoFar > 0 && remaining < 0;

  function missingRequired(): Record<string, string> {
    const missing: Record<string, string> = {};
    const blank = (value: string) => value.trim() === '';

    if (action === 'receipt') {
      const required = requiredFields(recordFundReceiptSchema);
      if (required.has('amount') && blank(amount)) missing.amount = t.requisitions.fieldRequired;
      if (required.has('receivedAt') && blank(when)) missing.receivedAt = t.requisitions.fieldRequired;
    }
    if (action === 'purchase') {
      const required = requiredFields(recordPurchaseSchema);
      if (required.has('vendor') && blank(vendor)) missing.vendor = t.requisitions.fieldRequired;
      if (required.has('purchasedAt') && blank(when)) missing.purchasedAt = t.requisitions.fieldRequired;

      // Every line needs a unit cost. The payload used to drop costless lines, so leaving one
      // blank produced an empty `lines` array and the IM was shown zod describing the array
      // rather than the box they had missed. Marked per line instead.
      for (const item of requisition.items) {
        const raw = unitCosts[item.id] ?? '';
        if (blank(raw)) {
          missing[`unitCost:${item.id}`] = t.requisitions.fieldRequired;
        } else if (!Number.isFinite(Number(raw)) || Number(raw) <= 0) {
          missing[`unitCost:${item.id}`] = t.funds.unitCostPositive;
        }
      }
    }
    // Every reversal carries a mandatory reason: undoing a money step is audit-worthy and an
    // unexplained one is worse than none at all.
    if (needsReason && blank(note)) missing.note = t.requisitions.fieldRequired;

    return missing;
  }

  async function onSubmit() {
    if (!action) return;
    // A retry starts from a clean slate, or a corrected field keeps wearing its old refusal.
    setFieldErrors({});

    // Refused here rather than by the API: these dialogs write money, and a round trip that
    // ends in a toast teaches the user nothing about which box was empty.
    const missing = missingRequired();
    if (Object.keys(missing).length > 0) {
      setFieldErrors(missing);
      focusFirstInvalid();
      toast.error(t.requisitions.fixHighlighted);
      return;
    }

    if (action === 'purchase' && overspends) {
      toast.error(
        t.funds.overspendBlocked
          .replace('{committed}', wouldCommit.toLocaleString())
          .replace('{funded}', fundedSoFar.toLocaleString()),
      );
      focusFirstInvalid();
      return;
    }
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
            transportationCost: thisCarriage,
            // No filter: a line with no cost is refused above, so anything reaching here is
            // costed. Filtering was what turned a missed box into an empty-array error.
            lines: requisition.items.map((item) => {
                // Prefer the BOM-edited quantity. The IM may have shrunk a 50-unit line
                // to 30 in the BOM customiser; the wire payload must reflect what was
                // actually bought, not the original requisition quantity. The server
                // also re-derives this as a ceiling defense-in-depth.
                const bomLine = bomLines?.get(item.id);
                const bomQuantity = bomLine?.quantity;
                const planned = bomQuantity ?? item.quantity;
                return {
                  requisitionItemId: item.id,
                  quantity: quantityOf(item.id, planned),
                  unitCost: Number(unitCosts[item.id]),
                  overBomQuantity:
                    bomQuantity !== undefined && quantityOf(item.id, planned) > bomQuantity,
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
              required
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
              required
              type="date"
              value={when}
              error={fieldErrors.receivedAt}
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
              required
              value={vendor}
              error={fieldErrors.vendor}
              onChange={(event) => setVendor(event.target.value)}
            />
            <TextField
              label={t.funds.invoiceNo}
              value={invoiceNo}
              onChange={(event) => setInvoiceNo(event.target.value)}
            />
            <TextField
              label={t.funds.purchasedAt}
              required
              type="date"
              value={when}
              error={fieldErrors.purchasedAt}
              onChange={(event) => setWhen(event.target.value)}
            />
            <div className="flex flex-col gap-2">
              {requisition.items.map((item) => {
                // The label and the wire payload agree on the quantity — BOM-edited if
                // a BOM exists, otherwise the original requisition quantity. Keeps the
                // IM from typing a unit cost for 50 units when only 30 were planned.
                const bomLine = bomLines?.get(item.id);
                const bomQuantity = bomLine?.quantity;
                const quantity = bomQuantity ?? item.quantity;
                return (
                  <div key={item.id} className="rounded-[--radius-control] border border-border p-3">
                    <p className="mb-2 text-sm font-medium text-ink">{item.itemName}</p>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <TextField
                        label={t.funds.quantity}
                        required
                        // The planned figure is named rather than enforced in the box: buying
                        // fewer is normal and buying more needs the BOM override, which the
                        // server decides.
                        hint={t.funds.plannedQuantity.replace('{n}', String(quantity))}
                        type="number"
                        min={1}
                        step="1"
                        value={quantities[item.id] ?? ''}
                        onChange={(event) => {
                          const next = event.target.value;
                          setQuantities((previous) => ({ ...previous, [item.id]: next }));
                        }}
                      />
                      <TextField
                        label={t.funds.unitCost}
                        required
                        type="number"
                        min={0}
                        step="0.01"
                        value={unitCosts[item.id] ?? ''}
                        error={fieldErrors[`unitCost:${item.id}`]}
                        onChange={(event) => {
                          const next = event.target.value;
                          setUnitCosts((previous) => ({ ...previous, [item.id]: next }));
                          // Clear the mark as soon as it is answered, or a corrected line keeps
                          // wearing a refusal it has already satisfied.
                          setFieldErrors((current) => {
                            const key = `unitCost:${item.id}`;
                            if (!current[key]) return current;
                            const rest = { ...current };
                            delete rest[key];
                            return rest;
                          });
                        }}
                      />
                      <div className="flex flex-col justify-end">
                        <p className="text-xs text-ink-subtle">{t.funds.lineTotal}</p>
                        <p className="text-sm font-medium tabular-nums text-ink">
                          {(
                            Number(unitCosts[item.id] ?? '') > 0
                              ? Number(unitCosts[item.id]) * quantityOf(item.id, quantity)
                              : 0
                          ).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}

              <TextField
                label={t.funds.transportationActual}
                hint={t.funds.transportationActualHint}
                type="number"
                min={0}
                step="0.01"
                value={carriage}
                onChange={(event) => setCarriage(event.target.value)}
              />

              <dl className="flex flex-col gap-1 border-t border-border pt-2 text-sm">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-ink-muted">{t.funds.purchaseTotal}</dt>
                  {/* Goods and carriage together — what leaves the account on this purchase. */}
                  <dd className="tabular-nums font-medium text-ink">
                    {(purchaseTotal + thisCarriage).toLocaleString()}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-ink-muted">{t.funds.fundedLabel}</dt>
                  <dd className="tabular-nums font-medium text-ink">
                    {fundedSoFar.toLocaleString()}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 border-t border-border pt-1">
                  <dt
                    className={
                      overspends ? 'font-semibold text-danger' : 'font-medium text-ink'
                    }
                  >
                    {t.funds.leftToSpend}
                  </dt>
                  <dd
                    className={
                      overspends
                        ? 'tabular-nums font-semibold text-danger'
                        : 'tabular-nums font-semibold text-ink'
                    }
                  >
                    {remaining.toLocaleString()}
                  </dd>
                </div>
                {overspends ? (
                  <p role="alert" className="text-xs text-danger">
                    {t.funds.overspendInline}
                  </p>
                ) : null}
              </dl>
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
          // Mandatory only for a reversal — an ordinary receipt may carry no note at all.
          required={needsReason}
          value={note}
          error={fieldErrors.note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
    </Dialog>
  );
}
