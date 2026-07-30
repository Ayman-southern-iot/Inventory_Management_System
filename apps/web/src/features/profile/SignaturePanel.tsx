import { useEffect, useRef, useState } from 'react';
import { PenLine, Trash2, Upload } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { messageForError } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { t } from '@/i18n/en';
import { useDeleteSignature, useMySignature, useUploadSignature } from './api';

/**
 * Upload, preview and remove the signature applied to BOMs when this user approves with it.
 *
 * The preview is fetched as a blob rather than pointed at by an `<img src>`: the endpoint is
 * bearer-authenticated and an img tag cannot carry the token. The resulting object URL is revoked
 * on replacement and unmount, or every upload leaks a few hundred KB for the life of the tab.
 */
export function SignaturePanel() {
  const toast = useToast();
  const signature = useMySignature();
  const upload = useUploadSignature();
  const remove = useDeleteSignature();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const signatureId = signature.data?.signature?.id ?? null;

  useEffect(() => {
    if (!signatureId) {
      setPreviewUrl(null);
      return undefined;
    }

    let objectUrl: string | null = null;
    let cancelled = false;

    void api
      .blob('/me/signature/content')
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      // A failed preview is not worth a toast — the metadata below still renders.
      .catch(() => setPreviewUrl(null));

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [signatureId]);

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset immediately so picking the same file twice still fires a change event.
    event.target.value = '';
    if (!file) return;

    try {
      await upload.mutateAsync(file);
      toast.success(t.signature.uploaded);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  async function onRemove() {
    try {
      await remove.mutateAsync();
      toast.success(t.signature.removed);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  const current = signature.data?.signature ?? null;

  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-ink">{t.signature.title}</h2>
      <p className="mb-3 text-sm text-ink-muted">{t.signature.subtitle}</p>

      <Panel>
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
          <div className="flex h-24 w-56 shrink-0 items-center justify-center rounded-[--radius-control] border border-dashed border-border bg-surface-muted">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={t.signature.preview}
                className="max-h-20 max-w-52 object-contain"
              />
            ) : (
              <PenLine aria-hidden className="size-6 text-ink-subtle" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            {current ? (
              <>
                <p className="truncate text-sm font-medium text-ink">{current.originalName}</p>
                <p className="text-xs text-ink-subtle">
                  {t.signature.uploadedOn(formatDateTime(current.createdAt))}
                </p>
              </>
            ) : (
              <p className="text-sm text-ink-muted">{t.signature.none}</p>
            )}
            <p className="mt-1 text-xs text-ink-subtle">{t.signature.accepted}</p>
          </div>

          <div className="flex shrink-0 gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              onChange={(event) => void onPick(event)}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => inputRef.current?.click()}
              isLoading={upload.isPending}
              icon={<Upload aria-hidden className="size-4" />}
            >
              {current ? t.signature.replace : t.signature.upload}
            </Button>
            {current && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void onRemove()}
                isLoading={remove.isPending}
                icon={<Trash2 aria-hidden className="size-4" />}
              >
                {t.signature.remove}
              </Button>
            )}
          </div>
        </div>
      </Panel>
    </section>
  );
}
