import { useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Trash2, Upload } from 'lucide-react';
import type { SupportingDocument } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { t } from '@/i18n/en';
import {
  useRemoveSupportingDocument,
  useUploadOrphanSupportingDocument,
  useUploadSupportingDocument,
} from '../api';

const ACCEPT = '.pdf,.png,.jpg,.jpeg';
const MAX_BYTES = 5 * 1024 * 1024;

interface Props {
  /**
   * Optional. When set, this is the post-save mode: uploads go to the existing
   * `POST /requisitions/:id/supporting-document` endpoint and the file id is
   * persisted immediately. When empty, this is the orphan mode: uploads go to
   * `POST /uploads/supporting-document`, the file id is held in local state,
   * and `onPendingChange` is called so the form page can include it in the
   * save body as `pendingSupportingDocumentId`.
   */
  requisitionId?: string;
  document: SupportingDocument | null;
  canEdit: boolean;
  /**
   * Called whenever the locally-attached orphan changes. Null when there is no
   * orphan yet; the file id when one is staged for claim-on-create.
   */
  onPendingChange?: (fileId: string | null) => void;
}

/**
 * The requester-side "Supporting document" zone on the requisition form.
 *
 * Two modes:
 *   - post-save (requisitionId set): uploads hit the existing DRAFT-only endpoint
 *     and the file id is persisted immediately.
 *   - pre-draft / orphan (requisitionId empty): uploads hit the orphan endpoint,
 *     the file id is held in local state, and the form page includes it in the
 *     save body. The create service claims it in the same transaction.
 *
 * State machine (shared):
 *   empty     → file picker is live, "Attach" CTA shows
 *   uploading → picker disabled, spinner; remove button hidden
 *   present   → file name + size shown; "Replace" + "Remove" buttons visible
 *   error     → red helper text under the picker; input is live again
 *
 * Outside DRAFT (or for a non-owner) the component collapses to a read-only display
 * identical to the detail-page thumbnail — presence without affordance.
 */
export function SupportingDocumentField({
  requisitionId,
  document,
  canEdit,
  onPendingChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  if (!canEdit) {
    return (
      <div className="rounded-[--radius-input] border border-border bg-surface-muted p-3 text-sm text-ink-muted">
        {document ? (
          <span className="flex items-center gap-2">
            <FileText aria-hidden className="size-4 text-ink-subtle" />
            <span className="font-medium text-ink">{document.originalName}</span>
            <span className="text-xs text-ink-subtle">
              ({formatBytes(document.sizeBytes)})
            </span>
          </span>
        ) : (
          <span>{t.requisitions.supportingDocument.empty}</span>
        )}
      </div>
    );
  }

  return requisitionId ? (
    <PostSaveField requisitionId={requisitionId} document={document} inputRef={inputRef} />
  ) : (
    <OrphanField onPendingChange={onPendingChange} inputRef={inputRef} />
  );
}

/**
 * Post-save mode. Identical to the original behaviour: the existing endpoint
 * handles DRAFT-only + requester-only.
 */
function PostSaveField({
  requisitionId,
  document,
  inputRef,
}: {
  requisitionId: string;
  document: SupportingDocument | null;
  inputRef: React.RefObject<HTMLInputElement>;
}) {
  const upload = useUploadSupportingDocument(requisitionId);
  const remove = useRemoveSupportingDocument(requisitionId);
  const [error, setError] = useState<string | null>(null);

  async function pickFile(file: File) {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError(t.requisitions.supportingDocument.tooLarge);
      return;
    }
    try {
      await upload.mutateAsync(file);
    } catch (err) {
      setError(t.requisitions.supportingDocument.uploadFailed);
      void err;
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {document ? (
        <AttachedRow
          document={document}
          onReplace={() => inputRef.current?.click()}
          onRemove={async () => {
            setError(null);
            try {
              await remove.mutateAsync();
            } catch {
              setError(t.requisitions.supportingDocument.uploadFailed);
            }
          }}
          replacePending={upload.isPending}
          removePending={remove.isPending}
        />
      ) : (
        <EmptyDropZone
          ctaLabel={t.requisitions.supportingDocument.pickerCta}
          pending={upload.isPending}
          onPick={() => inputRef.current?.click()}
        />
      )}

      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void pickFile(file);
        }}
      />
    </div>
  );
}

/**
 * Pre-draft / orphan mode. The file is uploaded immediately to the orphan
 * endpoint, then the local `pending` state holds it until the form page calls
 * `onPendingChange(fileId)`. The form page includes the id in the save body.
 *
 * When the form page navigates to the saved requisition's detail page, this
 * component unmounts (the route changed) — the local state is discarded, and
 * the new detail page shows the file because the create service claimed it.
 */
function OrphanField({
  onPendingChange,
  inputRef,
}: {
  onPendingChange?: (fileId: string | null) => void;
  inputRef: React.RefObject<HTMLInputElement>;
}) {
  const upload = useUploadOrphanSupportingDocument();
  const [pending, setPending] = useState<SupportingDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Lift the file id to the form whenever it changes. Clear on unmount so a
  // navigation away doesn't carry a stale id into the next save.
  useEffect(() => {
    onPendingChange?.(pending?.fileId ?? null);
    return () => onPendingChange?.(null);
  }, [pending, onPendingChange]);

  async function pickFile(file: File) {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError(t.requisitions.supportingDocument.tooLarge);
      return;
    }
    try {
      const stored = await upload.mutateAsync(file);
      setPending(stored);
    } catch (err) {
      setError(t.requisitions.supportingDocument.uploadFailed);
      void err;
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {pending ? (
        <AttachedRow
          document={pending}
          onReplace={() => inputRef.current?.click()}
          onRemove={() => {
            setPending(null);
            setError(null);
          }}
          replacePending={upload.isPending}
          removePending={false}
        />
      ) : (
        <EmptyDropZone
          ctaLabel={t.requisitions.supportingDocument.pickerCta}
          pending={upload.isPending}
          onPick={() => inputRef.current?.click()}
        />
      )}

      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void pickFile(file);
        }}
      />
    </div>
  );
}

function AttachedRow({
  document,
  onReplace,
  onRemove,
  replacePending,
  removePending,
}: {
  document: SupportingDocument;
  onReplace: () => void;
  onRemove: () => void | Promise<void>;
  replacePending: boolean;
  removePending: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[--radius-input] border border-border bg-surface-muted px-3 py-2">
      <span className="flex min-w-0 items-center gap-2 text-sm">
        <FileText aria-hidden className="size-4 shrink-0 text-ink-subtle" />
        <span className="truncate font-medium text-ink">{document.originalName}</span>
        <span className="shrink-0 text-xs text-ink-subtle">
          ({formatBytes(document.sizeBytes)})
        </span>
      </span>
      <div className="flex shrink-0 gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          icon={<Upload aria-hidden className="size-4" />}
          isLoading={replacePending}
          onClick={onReplace}
        >
          {t.requisitions.supportingDocument.replace}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={<Trash2 aria-hidden className="size-4 text-danger" />}
          isLoading={removePending}
          onClick={onRemove}
        >
          {t.requisitions.supportingDocument.remove}
        </Button>
      </div>
    </div>
  );
}

function EmptyDropZone({
  ctaLabel,
  pending,
  onPick,
}: {
  ctaLabel: string;
  pending: boolean;
  onPick: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[--radius-input] border border-dashed border-border bg-surface-muted px-3 py-3 text-sm text-ink-muted">
      <span>{t.requisitions.supportingDocument.empty}</span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        icon={
          pending ? (
            <Loader2 aria-hidden className="size-4 animate-spin" />
          ) : (
            <Upload aria-hidden className="size-4" />
          )
        }
        isLoading={pending}
        onClick={onPick}
      >
        {ctaLabel}
      </Button>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
