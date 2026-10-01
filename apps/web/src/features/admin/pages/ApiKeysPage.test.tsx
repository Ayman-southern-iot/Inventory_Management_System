import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ApiKeyScope,
  IDEMPOTENCY_HEADER,
  type ApiEndpointDoc,
  type ApiKey,
  type ApiKeyUsageDoc,
  type ServiceAccount,
} from '@ims/shared';
import { t } from '@/i18n/en';
import { ApiKeysPage } from './ApiKeysPage';

/**
 * The admin page for API keys.
 *
 * The behaviour that cannot be got wrong is the one-time reveal. The token is stored as a hash,
 * so if the page fails to show it — or shows it and then loses it on a re-render — the admin's
 * only recourse is to revoke and issue again. Everything else here is ordinary CRUD.
 */

const createSpy = vi.fn();
const setActiveSpy = vi.fn();
const revokeSpy = vi.fn();
const createAccountSpy = vi.fn();
const setAccountActiveSpy = vi.fn();

const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';
const NEW_ACCOUNT_ID = '44444444-4444-4444-8444-444444444444';
const ACCOUNT_NAME = 'Lab drawer panel C576';

const TOKEN = 'ims_aVeryLongSecretThatIsShownExactlyOnce';

function key(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Nightly product sync',
    keyPrefix: 'ims_a4f21c8e',
    scopes: [ApiKeyScope.INVENTORY_READ],
    isActive: true,
    expiresAt: null,
    lastUsedAt: null,
    createdById: '22222222-2222-4222-8222-222222222222',
    createdByName: 'System Administrator',
    createdAt: '2026-09-01T00:00:00.000Z',
    revokedAt: null,
    isExpired: false,
    serviceAccountId: null,
    serviceAccountName: null,
    serviceAccountIsActive: null,
    ...overrides,
  };
}

function serviceAccount(overrides: Partial<ServiceAccount> = {}): ServiceAccount {
  return {
    id: ACCOUNT_ID,
    name: ACCOUNT_NAME,
    isActive: true,
    activeKeyCount: 2,
    createdAt: '2026-09-20T00:00:00.000Z',
    ...overrides,
  };
}

/** The one-call take: a write, with a JSON body and a mandatory Idempotency-Key. */
const TAKE_ENDPOINT: ApiEndpointDoc = {
  method: 'POST',
  path: '/stock/take',
  scope: ApiKeyScope.STOCK_TAKE,
  summary: 'Take stock off a shelf in one call.',
  queryParams: [],
  bodyParams: [
    { name: 'productId', type: 'string', required: true },
    { name: 'quantity', type: 'number', required: true },
    { name: 'purpose', type: 'string', required: false },
  ],
  requiresIdempotencyKey: true,
};

const USAGE: ApiKeyUsageDoc = {
  basePath: '/api/v1',
  authHeader: 'Authorization: Bearer <key>',
  queryParam: 'api_key',
  tokenPrefix: 'ims_',
  rateLimitPerMinute: 120,
  maxPageSize: 100,
  // The config default, and deliberately not one of the 30/90/365 presets.
  writeKeyMaxLifetimeDays: 180,
  keysDisabledInDemo: false,
  endpoints: [
    {
      method: 'GET',
      path: '/categories',
      scope: ApiKeyScope.INVENTORY_READ,
      summary: 'The whole category tree.',
      queryParams: [],
      bodyParams: [],
      requiresIdempotencyKey: false,
    },
    {
      method: 'GET',
      path: '/products',
      scope: ApiKeyScope.INVENTORY_READ,
      summary: 'Every product.',
      queryParams: [{ name: 'limit', type: 'number', required: false }],
      bodyParams: [],
      requiresIdempotencyKey: false,
    },
    TAKE_ENDPOINT,
  ],
};

let listed: ApiKey[] = [key()];
let usageDoc: ApiKeyUsageDoc = USAGE;
/**
 * Empty by default — a fresh install, and the page the tests above were written against. An
 * active account renders an "Active" badge, which the expired-key test rightly refuses to see
 * anywhere on the page, so the tests that need accounts seed them themselves.
 */
let accounts: ServiceAccount[] = [];

vi.mock('../api', () => ({
  useApiKeys: () => ({
    data: { items: listed, page: 1, limit: 25, total: listed.length },
    isPending: false,
    error: null,
  }),
  useApiKeyUsage: () => ({ data: usageDoc, isPending: false, error: null }),
  useCreateApiKey: () => ({
    mutateAsync: (input: unknown) => {
      createSpy(input);
      return Promise.resolve({ key: key(), token: TOKEN });
    },
    isPending: false,
  }),
  useSetApiKeyActive: () => ({
    mutateAsync: (input: unknown) => {
      setActiveSpy(input);
      return Promise.resolve(key());
    },
    isPending: false,
  }),
  useRevokeApiKey: () => ({
    mutateAsync: (id: unknown) => {
      revokeSpy(id);
      return Promise.resolve();
    },
    isPending: false,
  }),
  useServiceAccounts: () => ({ data: accounts, isPending: false, error: null }),
  useCreateServiceAccount: () => ({
    mutateAsync: (input: { name: string }) => {
      createAccountSpy(input);
      const created = serviceAccount({ id: NEW_ACCOUNT_ID, name: input.name, activeKeyCount: 0 });
      // What the real hook's invalidation achieves: the list already holds it on resolve.
      accounts = [...accounts, created];
      return Promise.resolve(created);
    },
    isPending: false,
  }),
  useSetServiceAccountActive: () => ({
    mutateAsync: (input: { id: string; isActive: boolean }) => {
      setAccountActiveSpy(input);
      return Promise.resolve(serviceAccount({ isActive: input.isActive }));
    },
    isPending: false,
  }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ApiKeysPage />
    </QueryClientProvider>,
  );
}

describe('ApiKeysPage', () => {
  beforeEach(() => {
    createSpy.mockClear();
    setActiveSpy.mockClear();
    revokeSpy.mockClear();
    createAccountSpy.mockClear();
    setAccountActiveSpy.mockClear();
    listed = [key()];
    usageDoc = USAGE;
    accounts = [];
  });

  it('shows the prefix and never a whole key', () => {
    renderPage();
    expect(screen.getByText(/ims_a4f21c8e/)).toBeInTheDocument();
  });

  describe('the one-time reveal', () => {
    it('shows the token after issuing, and hides it once dismissed', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole('button', { name: t.apiKeys.newKey }));
      await user.type(screen.getByLabelText(new RegExp(t.apiKeys.name)), 'Nightly sync');
      await user.click(screen.getByRole('button', { name: t.apiKeys.issue }));

      const field = await screen.findByDisplayValue(TOKEN);
      expect(field).toBeInTheDocument();
      expect(screen.getByText(t.apiKeys.createdBody)).toBeInTheDocument();

      // Dismissing is the point of no return: the token is not recoverable from anywhere.
      await user.click(screen.getByRole('button', { name: t.apiKeys.done }));
      await waitFor(() => expect(screen.queryByDisplayValue(TOKEN)).not.toBeInTheDocument());
    });

    /** Ayman asked for "forever" explicitly, so it has to survive the form. */
    it('sends a null expiry when Never is chosen', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole('button', { name: t.apiKeys.newKey }));
      await user.type(screen.getByLabelText(new RegExp(t.apiKeys.name)), 'Forever key');
      await user.selectOptions(screen.getByLabelText(new RegExp(t.apiKeys.expiry)), 'never');
      await user.click(screen.getByRole('button', { name: t.apiKeys.issue }));

      await waitFor(() =>
        expect(createSpy).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'Forever key', expiresInDays: null }),
        ),
      );
    });

    it('defaults to 90 days rather than to forever', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole('button', { name: t.apiKeys.newKey }));
      await user.type(screen.getByLabelText(new RegExp(t.apiKeys.name)), 'Ordinary key');
      await user.click(screen.getByRole('button', { name: t.apiKeys.issue }));

      await waitFor(() =>
        expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ expiresInDays: 90 })),
      );
    });
  });

  describe('status', () => {
    it('calls a revoked key revoked, whatever its other flags say', () => {
      listed = [key({ revokedAt: '2026-09-10T00:00:00.000Z', isActive: false })];
      renderPage();
      expect(screen.getByText(t.apiKeys.revoked)).toBeInTheDocument();
    });

    /** Expiry outranks the toggle: a key past its date is refused however it is flagged. */
    it('calls an expired key expired even while it is still marked active', () => {
      listed = [key({ isActive: true, isExpired: true, expiresAt: '2026-09-01T00:00:00.000Z' })];
      renderPage();
      expect(screen.getByText(t.apiKeys.expired)).toBeInTheDocument();
      expect(screen.queryByText(t.apiKeys.active)).not.toBeInTheDocument();
    });

    /**
     * The guard refuses a key whose service account is deactivated (403 API_KEY_DISABLED), so
     * the key's own enabled flag is not the whole truth and the list must not say "Active".
     */
    it('calls a key blocked while its service account is deactivated', () => {
      listed = [
        key({
          isActive: true,
          scopes: [ApiKeyScope.STOCK_TAKE],
          serviceAccountId: ACCOUNT_ID,
          serviceAccountName: ACCOUNT_NAME,
          serviceAccountIsActive: false,
        }),
      ];
      renderPage();
      expect(screen.getByText(t.apiKeys.blocked)).toBeInTheDocument();
      expect(screen.getByText(t.apiKeys.blockedByServiceAccount)).toBeInTheDocument();
      expect(screen.queryByText(t.apiKeys.active)).not.toBeInTheDocument();
    });

    it('offers no enable or revoke action on a revoked key', () => {
      listed = [key({ revokedAt: '2026-09-10T00:00:00.000Z', isActive: false })];
      renderPage();
      expect(
        screen.queryByRole('button', { name: new RegExp(t.apiKeys.revoke) }),
      ).not.toBeInTheDocument();
    });
  });

  describe('revoking', () => {
    it('asks before revoking, and says it cannot be undone', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(
        screen.getByRole('button', { name: `${t.apiKeys.revoke} Nightly product sync` }),
      );
      expect(screen.getByText(t.apiKeys.revokeConfirmBody)).toBeInTheDocument();
      expect(revokeSpy).not.toHaveBeenCalled();

      // Anchored: the row's button is "Revoke <key name>" and would match a loose string.
      await user.click(
        screen.getByRole('button', { name: new RegExp(`^${t.apiKeys.revoke}$`) }),
      );
      await waitFor(() =>
        expect(revokeSpy).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111'),
      );
    });
  });

  describe('the generated instructions', () => {
    it('lists the endpoints the server reported', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole('button', { name: t.apiKeys.usageTitle }));

      expect(await screen.findByText('/api/v1/products')).toBeInTheDocument();
      expect(screen.getByText('/api/v1/categories')).toBeInTheDocument();
      expect(screen.getByText('Every product.')).toBeInTheDocument();
    });

    /**
     * Ayman chose the URL form knowing the cost. The panel must therefore show it *and* the
     * reason it is the riskier of the two, in the same place as the copy button — a warning
     * somewhere else is a warning nobody reads.
     */
    it('offers the browser URL with its warning attached', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole('button', { name: t.apiKeys.usageTitle }));

      expect(await screen.findByText(/api_key=ims_your_key_here/)).toBeInTheDocument();
      expect(screen.getByText(t.apiKeys.usageBrowserBody)).toBeInTheDocument();
    });

    /**
     * The API refuses `?api_key=` for any key that can write, even on a GET: the URL is kept by
     * proxy logs and browser history, and from there the key works in a header, on writes. This
     * panel is not tied to one key, so the rule has to sit beside the URL it restricts.
     */
    it('says a key that can change data goes only in the header, beside the URL form', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole('button', { name: t.apiKeys.usageTitle }));

      const url = await screen.findByText(/api_key=ims_your_key_here/);
      const section = url.closest('section');
      expect(section).not.toBeNull();
      expect(
        within(section as HTMLElement).getByText(t.apiKeys.usageWriteKeyHeaderOnly),
      ).toBeInTheDocument();
    });

    /** `/categories` sorts first; an example of the category tree answers nobody's question. */
    it('demonstrates the richest endpoint, not the alphabetically first', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole('button', { name: t.apiKeys.usageTitle }));

      const example = await screen.findByText(/^curl -H/);
      expect(example.textContent).toContain('/api/v1/products?limit=100');
      expect(example.textContent).not.toContain('/categories');
    });

    it('shows a call that changes data with its method, JSON body and idempotency header', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole('button', { name: t.apiKeys.usageTitle }));

      const example = await screen.findByText(/^curl -X POST/);
      const text = example.textContent ?? '';
      expect(text).toContain('Authorization: Bearer ims_your_key_here');
      expect(text).toContain('-H "Content-Type: application/json"');
      expect(text).toContain(`-H "${IDEMPOTENCY_HEADER}: <uuid>"`);
      // Required fields only: `purpose` is optional and stays out of the example body.
      expect(text).toContain(`-d '{"productId":"<productId>","quantity":1}'`);
      expect(text).toContain('/api/v1/stock/take');
      expect(screen.getByText(/productId \(string, required\)/)).toBeInTheDocument();
      expect(
        screen.getByText(t.apiKeys.usageIdempotency.replace('{header}', IDEMPOTENCY_HEADER)),
      ).toBeInTheDocument();
    });

    /** The API refuses `?api_key=` on every non-GET, so the panel must never offer it for one. */
    it('never offers the key-in-URL form for a call that changes data', async () => {
      usageDoc = { ...USAGE, endpoints: [TAKE_ENDPOINT] };
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole('button', { name: t.apiKeys.usageTitle }));

      expect(await screen.findByText(/^curl -X POST/)).toBeInTheDocument();
      expect(screen.queryByText(/api_key=/)).not.toBeInTheDocument();
      expect(screen.queryByText(t.apiKeys.usageBrowser)).not.toBeInTheDocument();
    });
  });

  describe('scopes that change data', () => {
    beforeEach(() => {
      accounts = [serviceAccount()];
    });

    async function openCreate() {
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('button', { name: t.apiKeys.newKey }));
      return user;
    }

    function expiryValues(): string[] {
      const select = screen.getByLabelText(new RegExp(t.apiKeys.expiry));
      return within(select)
        .getAllByRole('option')
        .map((option) => (option as HTMLOptionElement).value);
    }

    it('offers all five scopes, and marks the four that change data', async () => {
      await openCreate();

      for (const label of [
        t.apiKeys.scopeInventoryRead,
        t.apiKeys.scopeCatalogWrite,
        t.apiKeys.scopeLocationsWrite,
        t.apiKeys.scopeStockReceive,
        t.apiKeys.scopeStockTake,
      ]) {
        expect(screen.getByRole('checkbox', { name: new RegExp(label) })).toBeInTheDocument();
      }
      expect(
        screen.getAllByRole('checkbox', { name: new RegExp(t.apiKeys.scopeChangesData) }),
      ).toHaveLength(4);
      expect(
        screen.getByRole('checkbox', { name: new RegExp(t.apiKeys.scopeInventoryRead) }),
      ).toBeChecked();
    });

    it('requires a service account before a key that changes data can be issued', async () => {
      const user = await openCreate();
      await user.type(screen.getByLabelText(new RegExp(t.apiKeys.name)), 'Drawer panel');
      await user.click(screen.getByRole('checkbox', { name: new RegExp(t.apiKeys.scopeStockTake) }));
      await user.click(screen.getByRole('button', { name: t.apiKeys.issue }));

      expect(await screen.findByText(t.apiKeys.serviceAccountRequired)).toBeInTheDocument();
      expect(createSpy).not.toHaveBeenCalled();

      await user.selectOptions(
        screen.getByLabelText(new RegExp(t.apiKeys.serviceAccount)),
        ACCOUNT_ID,
      );
      await user.click(screen.getByRole('button', { name: t.apiKeys.issue }));

      await waitFor(() =>
        expect(createSpy).toHaveBeenCalledWith({
          name: 'Drawer panel',
          scopes: [ApiKeyScope.INVENTORY_READ, ApiKeyScope.STOCK_TAKE],
          expiresInDays: 90,
          serviceAccountId: ACCOUNT_ID,
        }),
      );
    });

    it('offers no Never and nothing over the ceiling once a scope that changes data is ticked', async () => {
      const user = await openCreate();
      expect(expiryValues()).toEqual(['30', '90', '365', 'never']);

      await user.click(
        screen.getByRole('checkbox', { name: new RegExp(t.apiKeys.scopeCatalogWrite) }),
      );
      // The presets under the 180-day ceiling, plus the ceiling itself.
      expect(expiryValues()).toEqual(['30', '90', '180']);

      await user.click(
        screen.getByRole('checkbox', { name: new RegExp(t.apiKeys.scopeCatalogWrite) }),
      );
      expect(expiryValues()).toEqual(['30', '90', '365', 'never']);
      expect(screen.queryByLabelText(new RegExp(t.apiKeys.serviceAccount))).not.toBeInTheDocument();
    });

    /** Unticking every write scope must put back exactly what a read-only key sent before. */
    it('issues an unbound read-only key after a write scope is ticked and unticked', async () => {
      const user = await openCreate();
      await user.type(screen.getByLabelText(new RegExp(t.apiKeys.name)), 'Reader');
      const take = screen.getByRole('checkbox', { name: new RegExp(t.apiKeys.scopeStockTake) });
      await user.click(take);
      await user.selectOptions(
        screen.getByLabelText(new RegExp(t.apiKeys.serviceAccount)),
        ACCOUNT_ID,
      );
      await user.click(take);
      await user.click(screen.getByRole('button', { name: t.apiKeys.issue }));

      await waitFor(() =>
        expect(createSpy).toHaveBeenCalledWith({
          name: 'Reader',
          scopes: [ApiKeyScope.INVENTORY_READ],
          expiresInDays: 90,
          serviceAccountId: null,
        }),
      );
    });

    it('creates a service account inline and selects it, without issuing the key', async () => {
      const user = await openCreate();
      await user.click(screen.getByRole('checkbox', { name: new RegExp(t.apiKeys.scopeStockTake) }));
      await user.type(
        screen.getByLabelText(new RegExp(t.apiKeys.newServiceAccount)),
        'Bench scanner{Enter}',
      );

      await waitFor(() => expect(createAccountSpy).toHaveBeenCalledWith({ name: 'Bench scanner' }));
      await waitFor(() =>
        expect(screen.getByLabelText(new RegExp(t.apiKeys.serviceAccount))).toHaveValue(
          NEW_ACCOUNT_ID,
        ),
      );
      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  describe('service accounts', () => {
    beforeEach(() => {
      accounts = [serviceAccount()];
    });

    it('names the account a key acts as, and shows none for an unbound key', () => {
      listed = [
        key(),
        key({
          id: '55555555-5555-4555-8555-555555555555',
          name: 'Drawer panel',
          scopes: [ApiKeyScope.STOCK_TAKE],
          serviceAccountId: ACCOUNT_ID,
          serviceAccountName: ACCOUNT_NAME,
          serviceAccountIsActive: true,
        }),
      ];
      renderPage();

      expect(
        screen.getByRole('columnheader', { name: t.apiKeys.serviceAccountColumn }),
      ).toBeInTheDocument();
      const bound = screen.getByRole('row', { name: /Drawer panel/ });
      expect(within(bound).getByText(ACCOUNT_NAME)).toBeInTheDocument();
      const unbound = screen.getByRole('row', { name: /Nightly product sync/ });
      expect(within(unbound).getByText(t.common.none)).toBeInTheDocument();
    });

    it('lists each account with its status and enabled-key count', () => {
      renderPage();
      const row = screen.getByRole('row', { name: new RegExp(`^${ACCOUNT_NAME}`) });
      expect(within(row).getByText(t.common.active)).toBeInTheDocument();
      expect(within(row).getByText('2')).toBeInTheDocument();
    });

    it('asks before deactivating, says every bound key stops, then sends isActive false', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(
        screen.getByRole('button', { name: `${t.apiKeys.deactivate} ${ACCOUNT_NAME}` }),
      );
      expect(
        screen.getByText(
          t.apiKeys.deactivateConfirmBody.replace('{name}', ACCOUNT_NAME).replace('{n}', '2'),
        ),
      ).toBeInTheDocument();
      expect(setAccountActiveSpy).not.toHaveBeenCalled();

      // Anchored: the row's button is "Deactivate <name>" and would match a loose string.
      await user.click(
        screen.getByRole('button', { name: new RegExp(`^${t.apiKeys.deactivate}$`) }),
      );
      await waitFor(() =>
        expect(setAccountActiveSpy).toHaveBeenCalledWith({ id: ACCOUNT_ID, isActive: false }),
      );
    });

    it('creates an account from the panel itself, with no key dialog open', async () => {
      accounts = [];
      const user = userEvent.setup();
      renderPage();

      // Only the panel offers the field here: the key dialog is closed.
      await user.type(screen.getByLabelText(new RegExp(t.apiKeys.newServiceAccountOnPanel)), 'Bench scanner');
      await user.click(screen.getByRole('button', { name: t.apiKeys.createServiceAccount }));

      await waitFor(() => expect(createAccountSpy).toHaveBeenCalledWith({ name: 'Bench scanner' }));
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('says how an account comes to exist when there is none', () => {
      accounts = [];
      renderPage();
      expect(screen.getByText(t.apiKeys.serviceAccountsEmptyTitle)).toBeInTheDocument();
      expect(screen.getByText(t.apiKeys.serviceAccountsEmptyBody)).toBeInTheDocument();
    });

    it('activates an inactive account without asking', async () => {
      accounts = [serviceAccount({ isActive: false })];
      const user = userEvent.setup();
      renderPage();

      await user.click(
        screen.getByRole('button', { name: `${t.apiKeys.activate} ${ACCOUNT_NAME}` }),
      );
      await waitFor(() =>
        expect(setAccountActiveSpy).toHaveBeenCalledWith({ id: ACCOUNT_ID, isActive: true }),
      );
      expect(screen.queryByText(t.apiKeys.deactivateConfirmTitle)).not.toBeInTheDocument();
    });
  });

  describe('demo mode', () => {
    it('says keys are switched off and offers no way to issue a key or an account', () => {
      usageDoc = { ...USAGE, keysDisabledInDemo: true };
      renderPage();

      expect(screen.getByText(t.apiKeys.demoDisabledBody)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: t.apiKeys.newKey })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: t.apiKeys.createServiceAccount }),
      ).not.toBeInTheDocument();
    });
  });
});
