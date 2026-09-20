import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  PAGINATION_MAX_LIMIT,
  assignHolderSchema,
  type AssignHolderInput,
  type BorrowRequest,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { SEARCH_DEBOUNCE_MS } from '@/features/inventory/constants';
import { useDebouncedValue } from '@/features/inventory/hooks/useDebouncedValue';
import { useSelectableUsers } from '@/features/users/api';
import { useAssignHolder } from '../api';

/**
 * Move an issued loan onto somebody else's name.
 *
 * The dialog says plainly that nothing moves on the shelf, because the alternative an IM has
 * been using until now is "record a return, then issue it again" — which puts two movements in
 * the ledger that never physically happened. This writes no stock at all; it moves who the
 * overdue reminder chases and whose name the kit sits against.
 *
 * The current holder is shown rather than assumed: on a loan that has already changed hands
 * once, the person who asked for it is not the person it is coming off.
 */
export function ReassignHolderDialog({
  borrow,
  onClose,
}: {
  borrow?: BorrowRequest;
  onClose: () => void;
}) {
  const toast = useToast();
  const assignHolder = useAssignHolder();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);

  const candidates = useSelectableUsers(
    {
      page: 1,
      limit: PAGINATION_MAX_LIMIT,
      ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
    },
    // No point holding a user list open for a dialog nobody has opened.
    borrow !== undefined,
  );

  /**
   * The person who already holds it is filtered out of the list rather than left in and
   * refused. The server refuses it (409, and a CHECK behind that), but offering a choice that
   * can only fail is a worse dialog than not offering it.
   */
  const options = useMemo(
    () => (candidates.data?.items ?? []).filter((user) => user.id !== borrow?.currentHolderId),
    [candidates.data, borrow?.currentHolderId],
  );

  const form = useForm<AssignHolderInput>({
    resolver: zodResolver(assignHolderSchema),
    defaultValues: { holderId: '', reason: '' },
  });

  useEffect(() => {
    if (!borrow) return;
    form.reset({ holderId: '', reason: '' });
    setSearch('');
  }, [borrow, form]);

  async function onSubmit(values: AssignHolderInput) {
    if (!borrow) return;
    try {
      await assignHolder.mutateAsync({ id: borrow.id, input: values });
      toast.success(t.borrowing.reassigned);
      onClose();
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  const { errors, isSubmitting } = form.formState;

  return (
    <Dialog
      schema={assignHolderSchema}
      open={borrow !== undefined}
      onClose={onClose}
      title={`${t.borrowing.reassignTitle}${borrow ? ` — ${borrow.borrowNo}` : ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t.common.cancel}
          </Button>
          {/*
            `onClick` rather than `form="…" type="submit"`. `Dialog` renders the footer outside
            the form, so that pattern relies on the HTML form-owner attribute — which a real
            browser honours and jsdom does not, leaving the button untestable. Going through
            `handleSubmit` directly works in both, and the `<form onSubmit>` below still
            handles Enter pressed inside a field.
          */}
          <Button
            type="button"
            isLoading={isSubmitting}
            onClick={() => void form.handleSubmit(onSubmit)()}
          >
            {t.borrowing.reassign}
          </Button>
        </>
      }
    >
      <form
        id="reassign-holder-form"
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-4"
      >
        <p className="rounded-[--radius-control] bg-surface-muted px-3 py-2 text-xs text-ink-muted">
          {t.borrowing.reassignNoStockHint}
        </p>

        <p className="text-sm text-ink-muted">
          {t.borrowing.reassignCurrent}:{' '}
          <span className="font-medium text-ink">{borrow?.currentHolderName}</span>
        </p>

        <TextField
          label={t.common.search}
          placeholder={t.borrowing.searchPlaceholder}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <SelectField
          label={t.borrowing.reassignHolder}
          hint={t.borrowing.reassignHolderHint}
          error={errors.holderId?.message}
          {...form.register('holderId')}
        >
          <option value="">{t.common.none}</option>
          {options.map((user) => (
            <option key={user.id} value={user.id}>
              {user.fullName} — {user.designation}
            </option>
          ))}
        </SelectField>

        <TextAreaField
          label={t.borrowing.reassignReason}
          hint={t.borrowing.reassignReasonHint}
          error={errors.reason?.message}
          rows={3}
          {...form.register('reason')}
        />
      </form>
    </Dialog>
  );
}
