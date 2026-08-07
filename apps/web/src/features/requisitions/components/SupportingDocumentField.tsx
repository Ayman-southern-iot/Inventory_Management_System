import { useRef, useState } from 'react';
import { FileText, Loader2, Trash2, Upload } from 'lucide-react';
import type { SupportingDocument } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { t } from '@/i18n/en';
import {
  useRemoveSupportingDocument,
  useUploadSupportingDocument,
} from '../api';

const ACCEPT = '.pdf,.png,.jpg,.jpeg';
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * The requester-side "Supporting document" zone on the requisition form.
 *
 * State machine:
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
}: {
  requisitionId: string;
  document: SupportingDocument | null;
  canEdit: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadSupportingDocument(requisitionId);
  const remove = useRemoveSupportingDocument(requisitionId);
  const [error, setError] = useState<string | null>(null);

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
      // The error surface is for the user, not the console.
      void err;
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {document ? (
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
              isLoading={upload.isPending}
              onClick={() => inputRef.current?.click()}
            >
              {t.requisitions.supportingDocument.replace}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={<Trash2 aria-hidden className="size-4 text-danger" />}
              isLoading={remove.isPending}
              onClick={async () => {
                setError(null);
                try {
                  await remove.mutateAsync();
                } catch {
                  setError(t.requisitions.supportingDocument.uploadFailed);
                }
              }}
            >
              {t.requisitions.supportingDocument.remove}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[--radius-input] border border-dashed border-border bg-surface-muted px-3 py-3 text-sm text-ink-muted">
          <span>{t.requisitions.supportingDocument.empty}</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={
              upload.isPending ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <Upload aria-hidden className="size-4" />
              )
            }
            isLoading={upload.isPending}
            onClick={() => inputRef.current?.click()}
          >
            {t.requisitions.supportingDocument.pickerCta}
          </Button>
        </div>
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
          // Clear the input so picking the same file twice still fires onChange.
          event.target.value = '';
          if (file) void pickFile(file);
        }}
      />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}