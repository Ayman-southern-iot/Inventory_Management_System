import { useId } from 'react';
import { ApiKeyScope, isReadOnlyApiKeyScope } from '@ims/shared';
import { Badge } from '@/components/ui/primitives';
import { t } from '@/i18n/en';

/**
 * A `Record` over the enum rather than a list, so a sixth scope added to the shared contract
 * fails the build here until somebody has written down what it means.
 */
const SCOPE_COPY: Record<ApiKeyScope, { label: string; hint: string }> = {
  [ApiKeyScope.INVENTORY_READ]: {
    label: t.apiKeys.scopeInventoryRead,
    hint: t.apiKeys.scopeInventoryReadHint,
  },
  [ApiKeyScope.CATALOG_WRITE]: {
    label: t.apiKeys.scopeCatalogWrite,
    hint: t.apiKeys.scopeCatalogWriteHint,
  },
  [ApiKeyScope.LOCATIONS_WRITE]: {
    label: t.apiKeys.scopeLocationsWrite,
    hint: t.apiKeys.scopeLocationsWriteHint,
  },
  [ApiKeyScope.STOCK_RECEIVE]: {
    label: t.apiKeys.scopeStockReceive,
    hint: t.apiKeys.scopeStockReceiveHint,
  },
  [ApiKeyScope.STOCK_TAKE]: {
    label: t.apiKeys.scopeStockTake,
    hint: t.apiKeys.scopeStockTakeHint,
  },
};

/** Contract order: the read scope first, then the four that change data. */
const SCOPES = Object.values(ApiKeyScope);

interface ApiKeyScopeFieldsProps {
  value: readonly ApiKeyScope[];
  onChange: (next: ApiKeyScope[]) => void;
  error?: string;
}

/**
 * One checkbox per scope. A scope that can change data carries a "Changes data" badge inside its
 * label, so the checkbox's accessible name says so too — the difference between a key that can
 * look and one that can move stock should not depend on reading a colour.
 */
export function ApiKeyScopeFields({ value, onChange, error }: ApiKeyScopeFieldsProps) {
  const baseId = useId();
  const errorId = `${baseId}-error`;

  function toggle(scope: ApiKeyScope, checked: boolean) {
    // Rebuilt in contract order whatever order they were ticked in, so the request, the list
    // and the audit row all read the same.
    onChange(SCOPES.filter((each) => (each === scope ? checked : value.includes(each))));
  }

  return (
    <fieldset
      aria-describedby={error ? errorId : undefined}
      className="rounded-[--radius-control] border border-border p-3"
    >
      <legend className="px-1 text-sm font-medium text-ink">
        {t.apiKeys.scopes}
        <span aria-hidden className="ml-0.5 text-danger">
          *
        </span>
      </legend>
      <ul className="flex flex-col gap-2.5">
        {SCOPES.map((scope) => {
          const inputId = `${baseId}-${scope}`;
          const hintId = `${inputId}-hint`;
          return (
            <li key={scope} className="flex items-start gap-2">
              <input
                id={inputId}
                type="checkbox"
                checked={value.includes(scope)}
                aria-describedby={hintId}
                onChange={(event) => toggle(scope, event.target.checked)}
                className="mt-0.5 size-4 rounded border-border-strong accent-brand"
              />
              <div className="flex flex-col gap-0.5">
                <label htmlFor={inputId} className="flex items-center gap-2 text-sm text-ink">
                  {SCOPE_COPY[scope].label}
                  {isReadOnlyApiKeyScope(scope) ? null : (
                    <Badge tone="pending">{t.apiKeys.scopeChangesData}</Badge>
                  )}
                </label>
                <p id={hintId} className="text-xs text-ink-subtle">
                  {SCOPE_COPY[scope].hint}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p id={errorId} role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
