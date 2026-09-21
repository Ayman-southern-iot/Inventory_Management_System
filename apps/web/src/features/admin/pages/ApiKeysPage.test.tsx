import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiKeyScope, type ApiKey, type ApiKeyUsageDoc } from '@ims/shared';
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
    ...overrides,
  };
}

const USAGE: ApiKeyUsageDoc = {
  basePath: '/api/v1',
  authHeader: 'Authorization: Bearer <key>',
  tokenPrefix: 'ims_',
  rateLimitPerMinute: 120,
  maxPageSize: 100,
  endpoints: [
    {
      method: 'GET',
      path: '/categories',
      scope: ApiKeyScope.INVENTORY_READ,
      summary: 'The whole category tree.',
      queryParams: [],
    },
    {
      method: 'GET',
      path: '/products',
      scope: ApiKeyScope.INVENTORY_READ,
      summary: 'Every product.',
      queryParams: [{ name: 'limit', type: 'number', required: false }],
    },
  ],
};

let listed: ApiKey[] = [key()];

vi.mock('../api', () => ({
  useApiKeys: () => ({
    data: { items: listed, page: 1, limit: 25, total: listed.length },
    isPending: false,
    error: null,
  }),
  useApiKeyUsage: () => ({ data: USAGE, isPending: false, error: null }),
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
    listed = [key()];
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

    /** `/categories` sorts first; an example of the category tree answers nobody's question. */
    it('demonstrates the richest endpoint, not the alphabetically first', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole('button', { name: t.apiKeys.usageTitle }));

      const example = await screen.findByText(/^curl -H/);
      expect(example.textContent).toContain('/api/v1/products?limit=100');
      expect(example.textContent).not.toContain('/categories');
    });
  });
});
