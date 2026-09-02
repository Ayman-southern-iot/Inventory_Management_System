import type { ReactNode } from 'react';
import {
  RequisitionEventType,
  type RequisitionDetail,
  type RequisitionFunding,
} from '@ims/shared';
import { t } from '@/i18n/en';
import { formatBdt, formatDateTime } from '@/lib/format';
import { InvoiceRow } from './InvoiceRow';

/**
 * What happened to the money, in the order it happened.
 *
 * This replaced three disconnected lists — Receipts, Purchases, Returned — with no ordering
 * between them. Read together they were a puzzle: a receipt dated the 1st sat above a purchase
 * dated the 2nd under a heading that implied grouping rather than sequence, and the notes typed at
 * each step were stored and never shown anywhere at all. Ayman, 2026-09-02: "a normal person is
 * not understanding anything from this information".
 *
 * One row per thing that happened, oldest first, each saying what it was, when, who did it, the
 * amount, and — underneath, in muted text — whatever they wrote at the time.
 */

interface Entry {
  key: string;
  /**
   * When the row was written. **This is what the order depends on**, and it is not always the
   * date shown.
   *
   * A receipt carries the day Accounts released the money, typed by the IM; an event carries the
   * instant the system recorded it. Sorting those together put "BOM sent to Accounts" third,
   * below a receipt back-dated to the day before — a sequence that cannot have happened. The
   * true order is the order things were recorded in.
   */
  recordedAt: string;
  /** The business date to print: when the money actually moved. Falls back to `recordedAt`. */
  at: string;
  title: string;
  actorName: string | null;
  /** The figures line: amount, reference, vendor — whatever this kind of entry carries. */
  detail?: ReactNode;
  /** What the person typed. Rendered muted, and only when there is something to render. */
  note?: string | null;
}

function Row({ entry }: { entry: Entry }) {
  return (
    <li className="border-b border-border py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-medium text-ink">{entry.title}</p>
        <p className="text-xs text-ink-subtle">
          {formatDateTime(entry.at)}
          {entry.actorName ? ` · ${entry.actorName}` : ''}
        </p>
      </div>
      {entry.detail ? <div className="mt-0.5 text-sm text-ink-muted">{entry.detail}</div> : null}
      {/*
        The note, which had nowhere to go before. Muted and indented so it reads as somebody's
        aside rather than as another figure — it is the one part of a row that is prose.
      */}
      {entry.note && entry.note.trim().length > 0 ? (
        <p className="mt-1 border-l-2 border-border bg-surface-muted px-2.5 py-1.5 text-sm italic text-ink-muted">
          {entry.note}
        </p>
      ) : null}
    </li>
  );
}

/** The event payloads carry a note; the type is unknown, so read it defensively. */
function noteOf(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && 'note' in payload) {
    const note = (payload as { note?: unknown }).note;
    return typeof note === 'string' ? note : null;
  }
  return null;
}

export function MoneyTrail({
  requisition,
  funding,
}: {
  requisition: RequisitionDetail;
  funding: RequisitionFunding;
}) {
  const entries: Entry[] = [];

  /*
   * Some steps leave a row of their own (a receipt, a purchase); some leave only an event. Sending
   * the BOM to Accounts is the second kind, and its note was the one Ayman noticed going missing.
   */
  for (const event of requisition.events) {
    if (event.eventType === RequisitionEventType.SENT_TO_ACCOUNTS) {
      entries.push({
        key: `event-${event.id}`,
        recordedAt: event.createdAt,
        at: event.createdAt,
        title: t.funds.trailSentToAccounts,
        actorName: event.actorName,
        note: noteOf(event.payload),
      });
    }
    if (event.eventType === RequisitionEventType.STOCKED) {
      entries.push({
        key: `event-${event.id}`,
        recordedAt: event.createdAt,
        at: event.createdAt,
        title: t.funds.trailStocked,
        actorName: event.actorName,
        note: noteOf(event.payload),
      });
    }
  }

  for (const receipt of funding.receipts) {
    entries.push({
      key: `receipt-${receipt.id}`,
      recordedAt: receipt.createdAt,
      at: receipt.receivedAt,
      title: t.funds.trailReceived,
      actorName: receipt.recordedByName,
      detail: (
        <>
          <span className="font-semibold tabular-nums text-ink">{formatBdt(receipt.amount)}</span>
          {receipt.reference ? ` · ${t.funds.trailReference} ${receipt.reference}` : ''}
        </>
      ),
      note: receipt.note,
    });
  }

  for (const purchase of funding.purchases) {
    entries.push({
      key: `purchase-${purchase.id}`,
      recordedAt: purchase.createdAt,
      at: purchase.purchasedAt,
      title: t.funds.trailPurchased,
      actorName: purchase.recordedByName,
      // InvoiceRow carries the download button and the received/outstanding state, so the purchase
      // row keeps it rather than restating half of it.
      detail: (
        <ul className="-my-2">
          <InvoiceRow requisitionId={requisition.id} purchase={purchase} />
        </ul>
      ),
      note: purchase.note,
    });
  }

  for (const entry of funding.returns) {
    entries.push({
      key: `return-${entry.id}`,
      recordedAt: entry.createdAt,
      at: entry.returnedAt,
      title: t.funds.trailReturned,
      actorName: entry.recordedByName,
      detail: (
        <span className="font-semibold tabular-nums text-ink">{formatBdt(entry.amount)}</span>
      ),
      // Never null: a return with no stated reason is refused by a database constraint.
      note: entry.note,
    });
  }

  /*
   * Oldest first, by when each row was **recorded**.
   *
   * A money trail is a sequence — sent, received, spent, handed back — and reversing it makes
   * the reader assemble the story backwards. Ordering on the printed date instead would order
   * it on figures the IM typed: a receipt back-dated to last week would climb above the step
   * that caused it.
   */
  entries.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

  if (entries.length === 0) {
    return <p className="py-2 text-sm text-ink-subtle">{t.funds.trailEmpty}</p>;
  }

  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {t.funds.trailHeading}
      </h3>
      <ol className="flex flex-col">
        {entries.map((entry) => (
          <Row key={entry.key} entry={entry} />
        ))}
      </ol>
    </section>
  );
}
