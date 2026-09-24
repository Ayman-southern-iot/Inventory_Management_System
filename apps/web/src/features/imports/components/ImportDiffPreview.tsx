import { isImportWarning, type ImportDiff, type ImportIssue } from '@ims/shared';
import { t } from '@/i18n/en';

/**
 * What the file would do, shown before anything is written (`importing_data.md` §5.4, I2).
 *
 * **The warnings are the reason this screen exists, not the counts.** A person can approve "40
 * products updated" without learning anything; what they need to see is the line saying ten units
 * are about to disappear off a shelf because the file has no row for it (§4.5), or that three
 * products being retired still have stock out on loan. So warnings are listed in full and given
 * more room than the totals, rather than collapsed behind a disclosure nobody opens.
 */
export function ImportDiffPreview({ diff }: { diff: ImportDiff }): JSX.Element {
  const nothingChanges =
    diff.productsCreated === 0 &&
    diff.productsUpdated === 0 &&
    diff.productsDeactivated === 0 &&
    diff.shelvesChanged === 0 &&
    diff.categoriesCreated.length === 0;

  return (
    <div className="space-y-4">
      {nothingChanges ? (
        <p className="rounded-md bg-surface-muted p-4 text-sm text-ink">
          {t.imports.preview.nothingToDo}
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Count label={t.imports.preview.productsCreated} value={diff.productsCreated} />
          <Count label={t.imports.preview.productsUpdated} value={diff.productsUpdated} />
          <Count label={t.imports.preview.productsRetired} value={diff.productsDeactivated} />
          <Count label={t.imports.preview.renamed} value={diff.productsRenamed} />
          <Count label={t.imports.preview.recategorised} value={diff.productsRecategorised} />
          <Count label={t.imports.preview.shelvesChanged} value={diff.shelvesChanged} />
        </dl>
      )}

      {diff.shelvesChanged > 0 ? (
        <p className="text-sm text-ink-subtle">
          {t.imports.preview.units(diff.unitsAdded, diff.unitsRemoved)}
        </p>
      ) : null}

      {diff.categoriesCreated.length > 0 ? (
        <section>
          <h3 className="text-sm font-medium text-ink">
            {t.imports.preview.categoriesCreated(diff.categoriesCreated.length)}
          </h3>
          <ul className="mt-1 list-inside list-disc text-sm text-ink-subtle">
            {diff.categoriesCreated.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <IssueList issues={diff.warnings} />
    </div>
  );
}

/**
 * Every warning, in full.
 *
 * Not truncated and not summarised: a file that produces forty of these is a file somebody should
 * read forty lines of before approving. Truncating would hide exactly the one that mattered, and
 * the person clicking Apply is the last check before the catalogue is rewritten.
 */
export function IssueList({
  issues,
  tone = 'warning',
}: {
  issues: ImportIssue[];
  tone?: 'warning' | 'error';
}): JSX.Element | null {
  if (issues.length === 0) return null;

  return (
    <section>
      <h3 className="text-sm font-medium text-ink">
        {tone === 'error'
          ? t.imports.preview.problems(issues.length)
          : t.imports.preview.warnings(issues.length)}
      </h3>
      <ul className="mt-2 space-y-1">
        {issues.map((issue, index) => (
          <li
            // Row and code are not unique together — one row can raise two of the same kind on
            // different columns — so the index is part of the key rather than a guess at one.
            key={`${issue.row}-${issue.code}-${index}`}
            className={
              tone === 'error'
                ? 'rounded bg-danger-subtle p-2 text-sm text-ink'
                : 'rounded bg-surface-muted p-2 text-sm text-ink'
            }
          >
            <span className="font-medium">{t.imports.preview.atRow(issue.row)}</span>{' '}
            {issue.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Guards against a warning code leaking into the error list, or the reverse (part D's partition). */
export function partitionIssues(issues: ImportIssue[]): {
  errors: ImportIssue[];
  warnings: ImportIssue[];
} {
  return {
    errors: issues.filter((issue) => !isImportWarning(issue.code)),
    warnings: issues.filter((issue) => isImportWarning(issue.code)),
  };
}

function Count({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="rounded-md border border-border p-3">
      <dt className="text-xs text-ink-subtle">{label}</dt>
      <dd className="text-xl font-semibold text-ink">{value}</dd>
    </div>
  );
}
