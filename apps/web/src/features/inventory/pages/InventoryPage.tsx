import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PAGINATION_DEFAULT_LIMIT, Role, type ListProductsQuery, type Product } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Checkbox, SelectField, TextField } from '@/components/ui/Field';
import { Badge, PageHeader, Pagination, Panel, Table } from '@/components/ui/primitives';
import { EmptyState, QueryBoundary, SkeletonRows } from '@/components/ui/states';
import { useAuth } from '@/features/auth/auth-context';
import { t } from '@/i18n/en';
import { ROUTES } from '@/routes/paths';
import { useCategoryTree, useProducts } from '../api';
import { flattenCategoryTree, indentFor } from '../category-tree';
import { SEARCH_DEBOUNCE_MS } from '../constants';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { ProductFormDialog } from '../components/ProductFormDialog';
import { inventoryExportPath } from '@/features/reports/api';
import { useExportDownload } from '@/features/reports/use-export-download';
import { messageForError } from '@/lib/error-message';
import { useToast } from '@/components/ui/Toast';

export function InventoryPage() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  // The catalogue list is open to every authenticated user; only IM/Admin can add a product.
  // The server enforces this on POST too — hiding the button just removes a dead-end 403.
  const canManageStock = hasRole(Role.INVENTORY_MANAGER, Role.ADMIN);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);

  // The search hits a trigram index, but a request per keystroke would still queue behind
  // itself on a slow link.
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);

  const query = useMemo<ListProductsQuery>(
    () => ({
      page,
      limit: PAGINATION_DEFAULT_LIMIT,
      includeInactive,
      inStockOnly,
      ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
      ...(categoryId ? { categoryId } : {}),
    }),
    [page, includeInactive, inStockOnly, debouncedSearch, categoryId],
  );

  const products = useProducts(query);
  const categories = useCategoryTree();
  const categoryOptions = useMemo(
    () => flattenCategoryTree(categories.data ?? []),
    [categories.data],
  );

  /**
   * EX-02, requirements §10: inventory records exportable as PDF for Accounts. One hook per
   * button, matching the expense report — a slow PDF render must not disable the CSV button.
   *
   * The export carries the filters currently on screen, so the IM exports what they are looking
   * at rather than a different report that happens to share a name. Paging is deliberately not
   * passed: a printed stock report is the whole filtered set, not page 3 of it.
   */
  const csvExport = useExportDownload();
  const pdfExport = useExportDownload();
  const toast = useToast();

  async function runInventoryExport(format: 'csv' | 'pdf'): Promise<void> {
    try {
      await (format === 'csv' ? csvExport : pdfExport).download(
        inventoryExportPath(
          {
            includeInactive,
            inStockOnly,
            ...(categoryId ? { categoryId } : {}),
          },
          format,
        ),
        `inventory-${new Date().toISOString().slice(0, 10)}.${format}`,
      );
    } catch (error) {
      // These figures go to Accounts on paper. A silent failure is what D-024 was.
      toast.error(messageForError(error));
    }
  }

  const resetToFirstPage = () => setPage(1);

  return (
    <>
      <PageHeader
        title={t.inventory.title}
        subtitle={t.inventory.subtitle}
        action={
          canManageStock ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {/* EX-02: requirements §10 wants inventory records on paper for Accounts. Guarded
                  by the same role check as the rest of this bar — the API refuses a General user
                  regardless, and offering a button that 403s is not a courtesy. */}
              <Button
                variant="ghost"
                size="sm"
                isLoading={csvExport.pending}
                onClick={() => void runInventoryExport('csv')}
              >
                {t.inventory.downloadCsv}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                isLoading={pdfExport.pending}
                onClick={() => void runInventoryExport('pdf')}
              >
                {t.inventory.downloadPdf}
              </Button>
              <Button icon={<Plus aria-hidden className="size-4" />} onClick={() => setFormOpen(true)}>
                {t.inventory.newProduct}
              </Button>
            </div>
          ) : undefined
        }
      />

      <Panel>
        <div className="flex flex-wrap items-end gap-4 border-b border-border px-4 py-3">
          <div className="min-w-56 flex-1">
            <TextField
              label={t.common.search}
              placeholder={t.inventory.searchPlaceholder}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                resetToFirstPage();
              }}
            />
          </div>
          <div className="min-w-48">
            <SelectField
              label={t.inventory.category}
              value={categoryId}
              onChange={(event) => {
                setCategoryId(event.target.value);
                resetToFirstPage();
              }}
            >
              <option value="">{t.inventory.allCategories}</option>
              {categoryOptions.map((category) => (
                <option key={category.id} value={category.id}>
                  {indentFor(category.depth)}
                  {category.name}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="flex flex-col gap-2 pb-2.5">
            <Checkbox
              label={t.inventory.inStockOnly}
              checked={inStockOnly}
              onChange={(event) => {
                setInStockOnly(event.target.checked);
                resetToFirstPage();
              }}
            />
            <Checkbox
              label={t.inventory.showInactive}
              checked={includeInactive}
              onChange={(event) => {
                setIncludeInactive(event.target.checked);
                resetToFirstPage();
              }}
            />
          </div>
        </div>

        <QueryBoundary
          isLoading={products.isPending}
          error={products.error}
          data={products.data}
          onRetry={() => void products.refetch()}
          loadingFallback={<SkeletonRows columns={6} />}
          isEmpty={(data) => data.items.length === 0}
          emptyFallback={
            <EmptyState title={t.inventory.emptyTitle} body={t.inventory.emptyBody} />
          }
        >
          {(data) => (
            <>
              <Table
                headers={[
                  t.inventory.productCode,
                  t.inventory.name,
                  t.inventory.category,
                  t.inventory.totalOwned,
                  t.inventory.inProjectUse,
                  t.inventory.available,
                  t.users.status,
                ]}
              >
                {data.items.map((product: Product) => (
                  <tr
                    key={product.id}
                    onClick={() => navigate(ROUTES.inventory.product(product.id))}
                    className="cursor-pointer hover:bg-surface-muted/50"
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-ink-muted">
                      {product.productCode}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-ink">{product.name}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{product.categoryName}</td>
                    <td className="px-4 py-2.5 tabular-nums text-ink">
                      {product.totalOwned} {product.unit}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-ink">
                      {product.totalInUse > 0 ? (
                        <span className="font-medium">{product.totalInUse}</span>
                      ) : (
                        <span className="text-ink-subtle">0</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-ink">{product.totalAvailable}</td>
                    <td className="px-4 py-2.5">
                      {!product.isActive ? (
                        <Badge tone="danger">{t.inventory.archived}</Badge>
                      ) : product.isTrackable ? (
                        <Badge tone="success">{t.common.active}</Badge>
                      ) : (
                        <Badge tone="neutral">{t.inventory.notTracked}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
              <Pagination
                page={data.page}
                limit={data.limit}
                total={data.total}
                onPageChange={setPage}
              />
            </>
          )}
        </QueryBoundary>
      </Panel>

      <ProductFormDialog open={formOpen} onClose={() => setFormOpen(false)} />
    </>
  );
}
