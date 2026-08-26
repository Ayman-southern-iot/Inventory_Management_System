import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ErrorCode, PAGINATION_MAX_LIMIT } from '@ims/shared';
import type {
  AdjustStockInput,
  Category,
  CategoryNode,
  Compartment,
  CreateCategoryInput,
  CreateCompartmentInput,
  CreateProductInput,
  CreateZoneInput,
  LedgerEntry,
  ListLedgerQuery,
  ListProductsQuery,
  MoveStockInput,
  Paginated,
  Product,
  ProductDetail,
  ReceiveStockInput,
  ResolveQuarantineInput,
  UpdateCategoryInput,
  UpdateCompartmentInput,
  UpdateProductInput,
  UpdateZoneInput,
  Zone,
} from '@ims/shared';
import { ApiError, api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { toSearchParams } from '@/api/search-params';

/* -------------------------------------------------------------------- categories */

export function useCategoryTree() {
  return useQuery({
    queryKey: queryKeys.categories.tree(),
    queryFn: ({ signal }) => api.get<CategoryNode[]>('/categories', signal),
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCategoryInput) => api.post<Category>('/categories', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.categories.all() }),
  });
}

export function useUpdateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateCategoryInput }) =>
      api.patch<Category>(`/categories/${id}`, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.categories.all() });
      // A rename or a trackability change is denormalised onto every product row.
      await queryClient.invalidateQueries({ queryKey: queryKeys.products.all() });
    },
  });
}

/* ---------------------------------------------------------------------- products */

export function useProducts(query: ListProductsQuery) {
  return useQuery({
    queryKey: queryKeys.products.list(query),
    queryFn: ({ signal }) => api.get<Paginated<Product>>(`/products${toSearchParams(query)}`, signal),
    // Keeps the previous page on screen while the next one loads, instead of flashing empty.
    placeholderData: (previous) => previous,
  });
}

export function useProduct(productId: string) {
  return useQuery({
    queryKey: queryKeys.products.detail(productId),
    queryFn: ({ signal }) => api.get<ProductDetail>(`/products/${productId}`, signal),
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProductInput) => api.post<Product>('/products', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
      // productCount is rendered on the category tree.
      await queryClient.invalidateQueries({ queryKey: queryKeys.categories.all() });
    },
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProductInput }) =>
      api.patch<Product>(`/products/${id}`, input),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.products.detail(variables.id) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.categories.all() });
    },
  });
}

/* --------------------------------------------------------------------- locations */

export function useZones(includeInactive = false) {
  return useQuery({
    // The flag is part of the key: without it, ticking "show archived" would serve the cached
    // active-only list and look like the toggle is broken.
    queryKey: [...queryKeys.locations.zones(), { includeInactive }],
    queryFn: ({ signal }) =>
      api.get<Zone[]>(`/locations${includeInactive ? '?includeInactive=true' : ''}`, signal),
  });
}

export function useCreateZone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateZoneInput) => api.post<Zone>('/locations/zones', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.locations.all() }),
  });
}

export function useUpdateZone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateZoneInput }) =>
      api.patch<Zone>(`/locations/zones/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.locations.all() }),
  });
}

export function useCreateCompartment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCompartmentInput) =>
      api.post<Compartment>('/locations/compartments', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.locations.all() }),
  });
}

export function useUpdateCompartment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateCompartmentInput }) =>
      api.patch<Compartment>(`/locations/compartments/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.locations.all() }),
  });
}

/* ------------------------------------------------------------------------- stock */

/**
 * What a stock write invalidates, and deliberately what it does not.
 *
 * `placementsOnly` is the move case: units changed compartment, so the product card and the
 * ledger are stale, but no total on any list row moved. Invalidating the lists as well would
 * refetch every open page for nothing — the "slow connection feels broken" failure that
 * rules/30-frontend.md is about.
 */
async function invalidateAfterStockWrite(
  queryClient: QueryClient,
  productId: string,
  options: { placementsOnly: boolean },
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: queryKeys.products.detail(productId) });
  await queryClient.invalidateQueries({ queryKey: queryKeys.ledger.all() });
  // A compartment's placementCount decides whether it can be deactivated.
  await queryClient.invalidateQueries({ queryKey: queryKeys.locations.all() });
  if (!options.placementsOnly) {
    await queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
  }
}

export function useReceiveStock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ReceiveStockInput) => api.post<void>('/stock/receive', input),
    onSuccess: (_result, input) =>
      invalidateAfterStockWrite(queryClient, input.productId, { placementsOnly: false }),
  });
}

export function useMoveStock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: MoveStockInput) => api.post<void>('/stock/move', input),
    // Both the source and the destination chip come from this one query, so invalidating the
    // product detail is what makes them both update without a manual refresh.
    onSuccess: (_result, input) =>
      invalidateAfterStockWrite(queryClient, input.productId, { placementsOnly: true }),
    onError: (error, input) => {
      // A version conflict means the screen was rendered from stock that has since moved.
      // Refetch so the user decides against the truth; never silently retry — the server
      // rejected this exact write for a reason (§7.3.2).
      if (error instanceof ApiError && error.code === ErrorCode.STOCK_VERSION_CONFLICT) {
        void invalidateAfterStockWrite(queryClient, input.productId, { placementsOnly: true });
      }
    },
  });
}

export function useAdjustStock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AdjustStockInput) => api.post<void>('/stock/adjust', input),
    onSuccess: (_result, input) =>
      invalidateAfterStockWrite(queryClient, input.productId, { placementsOnly: false }),
  });
}

/**
 * Settle quarantined quantity on a placement. RELEASE / DISPOSE both invalidate the product
 * detail so totals and chips redraw; the IM cares about the totals, not the placement row.
 */
export function useResolveQuarantine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ResolveQuarantineInput) =>
      api.post<void>('/stock/quarantine/resolve', input),
    onSuccess: (_result, input) =>
      invalidateAfterStockWrite(queryClient, input.productId, { placementsOnly: false }),
  });
}

export function useLedger(query: ListLedgerQuery) {
  return useQuery({
    queryKey: queryKeys.ledger.list(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<LedgerEntry>>(`/stock/ledger${toSearchParams(query)}`, signal),
    placeholderData: (previous) => previous,
  });
}

/**
 * Every active product, paged until the server runs out.
 *
 * D-002. The requisition form's item picker searches the catalogue client-side, so it needs the
 * whole list — but it asked for a single page of `PAGINATION_MAX_LIMIT` and stopped there. Past
 * that many products the rest were simply invisible, with nothing on screen to say so: the user
 * types a name that exists and the picker offers nothing, which reads as "we do not stock it".
 *
 * Mirrors `fetchAllProjects`, including its guard: a page with no rows ends the loop even if
 * `total` says otherwise, because a table changing under a paged read must not spin forever.
 */
export async function fetchAllProducts(
  query: ListProductsQuery,
  signal: AbortSignal | undefined,
): Promise<Product[]> {
  const items: Product[] = [];
  let page = 1;
  let total = Infinity;

  while (items.length < total) {
    const result = await api.get<Paginated<Product>>(
      `/products${toSearchParams({ ...query, page, limit: PAGINATION_MAX_LIMIT })}`,
      signal,
    );
    items.push(...result.items);
    total = result.total;
    if (result.items.length === 0) break;
    page += 1;
  }

  return items;
}

export function useAllProducts(query: ListProductsQuery) {
  return useQuery({
    // Distinct from useProducts' key for the same filters: this one holds every page, and
    // serving a paged cache entry to a caller expecting the whole catalogue is the defect again.
    queryKey: [...queryKeys.products.list(query), 'all'],
    queryFn: ({ signal }) => fetchAllProducts(query, signal),
  });
}
