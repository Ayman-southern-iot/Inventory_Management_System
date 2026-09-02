import type { ExpenseReport } from '@ims/shared';
import { t } from '@/i18n/en';
import { cn } from '@/lib/cn';
import { formatBdt } from '@/lib/format';

/**
 * The four-stage flow: Requested → Approved → Funded → Spent.
 *
 * Each figure is the source of the next, which is why they sit in one row reading left to right
 * rather than as four cards. The bars are proportional to the *previous* stage, not to the largest
 * figure — the question a reader has at each step is "how much of what came before survived?", and
 * a bar scaled to the row maximum answers a different question.
 *
 * Spec: `docs/spec/expenses-page-rebuild.md`. Everything here is `NO-BASIS` — the requirements
 * document asks only that the report be exportable, so this whole page is a design addition
 * recorded as Ayman's decision.
 */

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

function Stage({
  label,
  value,
  hint,
  fill,
  accent,
}: {
  label: string;
  value: number;
  hint: string;
  /** 0–100. The share of the preceding stage this figure represents. */
  fill: number;
  accent?: boolean;
}) {
  return (
    <div className="flex-1 px-5 py-4 first:pl-0">
      <p
        className={cn(
          'text-xs font-medium uppercase tracking-wide',
          accent ? 'text-brand' : 'text-ink-muted',
        )}
      >
        {label}
      </p>
      <p className="mt-1.5 text-3xl font-semibold tabular-nums text-ink">
        {formatBdt(value)}
      </p>
      {/*
        A track that is always drawn, so the four bars share a baseline and the eye can compare
        them. An undrawn track would make a zero stage look like a rendering fault.
      */}
      <div className="mt-2.5 h-1 w-full rounded-full bg-border">
        <div
          className={cn('h-1 rounded-full', accent ? 'bg-brand' : 'bg-success')}
          style={{ width: `${Math.min(100, Math.max(0, fill))}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-ink-subtle">{hint}</p>
    </div>
  );
}

function Gap({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs uppercase tracking-wide text-ink-muted">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-ink">{formatBdt(value)}</span>
    </div>
  );
}

/** The report's totals row. Not separately exported by the contract, so it is named through it. */
type Totals = ExpenseReport['totals'];

export function ExpenseFlow({ totals, periodLabel }: { totals: Totals; periodLabel: string }) {
  const { requested, approved, funded, spent, purchased, transportation } = totals;

  /*
   * The two gaps, floored at zero and never conflated.
   *
   * `approved − funded` is money an approver sanctioned that Accounts has not released.
   * `funded − spent` is money released and not yet spent. They answer different questions and a
   * page that adds them together would be inventing a third figure nobody asked for.
   *
   * Floored because a negative here is an overage to investigate, not a debt — the same reasoning
   * the funding endpoint already applies to `outstanding` and `unspent`.
   */
  const awaiting = Math.max(0, Math.round((approved - funded) * 100) / 100);
  const inHand = Math.max(0, Math.round((funded - spent) * 100) / 100);

  /*
   * The page's whole promise is that the figures reconcile, so it says whether they do rather than
   * leaving the reader to add up the columns. Silence would be ambiguous — "checked and fine" and
   * "never checked" would look identical.
   */
  const reconciles = Math.abs(purchased + transportation - spent) < 0.01;

  return (
    <section className="px-4 py-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-medium text-ink">{periodLabel}</h2>
        <div className="h-px flex-1 bg-border" />
        <p
          className={cn(
            'text-xs font-medium',
            reconciles ? 'text-success' : 'text-danger',
          )}
        >
          {reconciles ? `✓ ${t.expenses.reconciles}` : `⚠ ${t.expenses.reconcilesOff}`}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap divide-x divide-border sm:flex-nowrap">
        <Stage
          label={t.expenses.flowRequested}
          value={requested}
          hint={t.expenses.flowRequestedHint.replace('{n}', String(totals.requisitionCount))}
          fill={100}
        />
        <Stage
          label={t.expenses.flowApproved}
          value={approved}
          hint={t.expenses.flowApprovedHint.replace('{pct}', String(pct(approved, requested)))}
          fill={pct(approved, requested)}
        />
        <Stage
          label={t.expenses.flowFunded}
          value={funded}
          hint={t.expenses.flowFundedHint}
          fill={pct(funded, approved)}
        />
        <Stage
          label={t.expenses.flowSpent}
          value={spent}
          hint={t.expenses.flowSpentHint.replace('{pct}', String(pct(spent, funded)))}
          fill={pct(spent, funded)}
          accent
        />
      </div>

      {/*
        The split and the gaps share a strip because they are both "and here is what that last
        number is made of, and what has not moved yet" — subordinate to the flow above, not a
        second set of headline figures.
      */}
      <div className="mt-3 flex flex-wrap items-baseline gap-x-8 gap-y-2 border-t border-border pt-3">
        <Gap label={t.expenses.splitItems} value={purchased} />
        <Gap label={t.expenses.splitTransport} value={transportation} />
        <div className="ml-auto flex flex-wrap items-baseline gap-x-8 gap-y-2">
          <Gap label={t.expenses.gapAwaiting} value={awaiting} />
          <Gap label={t.expenses.gapInHand} value={inHand} />
        </div>
      </div>
    </section>
  );
}
