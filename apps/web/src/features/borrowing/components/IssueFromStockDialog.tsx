import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  PAGINATION_MAX_LIMIT,
  formatLocation,
  issueFromStockSchema,
  type IssueFromStockInput,
  type ProductDetail,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Checkbox, SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { QuantityField } from '@/features/inventory/components/QuantityField';
import { SEARCH_DEBOUNCE_MS } from '@/features/inventory/constants';
import { useDebouncedValue } from '@/features/inventory/hooks/useDebouncedValue';
import { useSelectableUsers } from '@/features/users/api';
import { useIssueFromStock } from '../api';

/**
 * The IM recording a handover that already happened: ten arrive, the CTO takes one off the
 * shelf and says "put it against me".
 *
 * Ayman's ask #4, the first half. Distinct from Borrow, which is a *request* somebody raises
 * and the IM decides on — here the item is already in a colleague's hands and the IM is
 * catching the record up. It goes straight to ISSUED, and the person it lands on is told,
 * because they never asked for it and the notification is their proof it happened.
 *
 * Distinct again from "Change holder", which moves an already-issued loan between people and
 * touches no stock. This one does move stock: reserve then issue, in one transaction (G-14).
 */
export function IssueFromStockDialog({
  open,
  onClose,
  product,
}: {
  open: boolean;
  onClose: () => void;
  product: ProductDetail;
}) {
  const toast = useToast();
  const issueFromStock = useIssueFromStock();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);

  const borrowers = useSelectableUsers(
    {
      page: 1,
      limit: PAGINATION_MAX_LIMIT,
      ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
    },
    open,
  );

  /** Only shelves with something available — reserved units are already spoken for. */
  const sources = useMemo(
    () => product.placements.filter((placement) => placement.availableQty > 0),
    [product.placements],
  );

  const form = useForm<IssueFromStockInput>({
    resolver: zodResolver(issueFromStockSchema),
    defaultValues: {
      borrowerId: '',
      productId: product.id,
      compartmentId: '',
      quantity: undefined,
      projectId: null,
      isReturnable: product.defaultReturnable,
      expectedReturnDate: null,
      purpose: null,
    },
  });

  const compartmentId = form.watch('compartmentId');
  const isReturnable = form.watch('isReturnable');
  const selected = sources.find((placement) => placement.compartmentId === compartmentId);
  const maxQuantity = selected?.availableQty ?? 0;

  useEffect(() => {
    if (!open) return;
    setSearch('');
    form.reset({
      borrowerId: '',
      productId: product.id,
      compartmentId: sources[0]?.compartmentId ?? '',
      quantity: undefined,
      projectId: null,
      isReturnable: product.defaultReturnable,
      expectedReturnDate: null,
      purpose: null,
    });
  }, [open, product, sources, form]);

  // A consumable never comes back, so a stale return date must not linger on the form.
  useEffect(() => {
    if (!isReturnable) form.setValue('expectedReturnDate', null);
  }, [isReturnable, form]);

  async function submit(values: IssueFromStockInput) {
    try {
      await issueFromStock.mutateAsync(values);
      toast.success(t.borrowing.issuedFromStock);
      onClose();
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  const { errors, isSubmitting } = form.formState;

  return (
    <Dialog
      schema={issueFromStockSchema}
      open={open}
      onClose={onClose}
      title={`${t.borrowing.issueFromStock} — ${product.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t.common.cancel}
          </Button>
          <Button
            type="button"
            isLoading={isSubmitting}
            disabled={sources.length === 0}
            onClick={() => void form.handleSubmit(submit)()}
          >
            {t.borrowing.issueFromStock}
          </Button>
        </>
      }
    >
      {sources.length === 0 ? (
        <p className="text-sm text-ink-muted">{t.inventory.nothingToMove}</p>
      ) : (
        <form
          id="issue-from-stock-form"
          noValidate
          onSubmit={form.handleSubmit(submit)}
          className="flex flex-col gap-4"
        >
          <p className="rounded-[--radius-control] bg-surface-muted px-3 py-2 text-xs text-ink-muted">
            {t.borrowing.issueFromStockHint}
          </p>

          <TextField
            label={t.common.search}
            placeholder={t.borrowing.searchPeople}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <SelectField
            label={t.borrowing.issueTo}
            error={errors.borrowerId?.message}
            {...form.register('borrowerId')}
          >
            <option value="">{t.common.none}</option>
            {(borrowers.data?.items ?? []).map((user) => (
              <option key={user.id} value={user.id}>
                {user.fullName} — {user.designation}
              </option>
            ))}
          </SelectField>

          <SelectField
            label={t.borrowing.location}
            error={errors.compartmentId?.message}
            {...form.register('compartmentId')}
          >
            {sources.map((placement) => (
              <option key={placement.compartmentId} value={placement.compartmentId}>
                {formatLocation({
                  roomName: placement.roomName,
                  zoneName: placement.zoneName,
                  compartmentCode: placement.compartmentCode,
                })}{' '}
                — {placement.availableQty} {t.inventory.availableShort}
              </option>
            ))}
          </SelectField>

          <QuantityField
            control={form.control}
            name="quantity"
            label={t.borrowing.quantity}
            hint={`${maxQuantity} ${t.inventory.availableShort}`}
            error={errors.quantity?.message}
            min={1}
            max={Math.max(maxQuantity, 1)}
          />

          <Checkbox label={t.borrowing.returnable} {...form.register('isReturnable')} />

          {isReturnable ? (
            <TextField
              type="date"
              label={t.borrowing.expectedReturn}
              error={errors.expectedReturnDate?.message}
              {...form.register('expectedReturnDate')}
            />
          ) : null}

          <TextAreaField
            label={t.borrowing.purpose}
            error={errors.purpose?.message}
            {...form.register('purpose')}
          />
        </form>
      )}
    </Dialog>
  );
}
