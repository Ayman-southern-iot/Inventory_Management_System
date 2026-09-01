import { useEffect, useRef, useState } from 'react';
import { ExternalLink, FileText, Loader2 } from 'lucide-react';
import type { SupportingDocument } from '@ims/shared';
import { api } from '@/api/client';
import { t } from '@/i18n/en';

/**
 * The attachment, as one row of the requisition summary.
 *
 * Was a 140×180 paper thumbnail with a folded corner, sized to fill a column of its own beside
 * the money figures. That column is gone — the attachment is a row of the summary grid now —
 * and a 180px graphic standing in for a filename made the card twice as tall as its content.
 * The approving-view template uses a chip: icon, name, size, on one line.
 *
 * Still a button that opens the bytes in a new tab.
 *
 * Why a button instead of `<a href={url}>`: the download endpoint sits behind
 * `JwtAuthGuard`, so a plain anchor would open the new tab with no Authorization header
 * and the API would return 401. The browser cannot attach a bearer token to a top-level
 * navigation. We `api.blob()` (which carries the token and the silent refresh dance), then
 * open a `URL.createObjectURL(blob)` in a new tab. The blob URL is revoked on unmount and
 * whenever the document prop changes — leaving it alive would leak the bytes for the lifetime
 * of the page.
 *
 * When no document is attached, the card renders `null`. Absence is the signal "nothing to
 * look at" — no empty-state copy, no placeholder, and the status box collapses to one column.
 */
export function SupportingDocumentCard({
  document,
  url,
}: {
  document: SupportingDocument | null;
  url: string | null;
}) {
  if (!document || !url) return null;
  return <OpenCard document={document} url={url} />;
}

function OpenCard({
  document,
  url,
}: {
  document: SupportingDocument;
  url: string;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The single in-flight request is tracked so a second click before the first resolves
  // is a no-op (the user gets a button that's already pending), not a parallel fetch.
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    // New document, new URL — drop the previous blob URL, otherwise it leaks.
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  useEffect(() => {
    // Hard reset on unmount and on document swap.
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);
    setError(null);
    setPending(false);
    inFlight.current?.abort();
    inFlight.current = null;
  }, [document.fileId, document.originalName]); // eslint-disable-line react-hooks/exhaustive-deps

  async function open() {
    if (pending) return;
    setError(null);
    setPending(true);
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const blob = await api.blob(url, controller.signal);
      if (controller.signal.aborted) return;
      const objectUrl = URL.createObjectURL(blob);
      setBlobUrl(objectUrl);
      window.open(objectUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(t.requisitions.supportingDocumentCard.openFailed);
      void err;
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={pending}
      className={[
        'group inline-flex max-w-full items-center gap-3 rounded-[--radius-control]',
        'border border-border bg-surface-muted px-3 py-2 text-left',
        'hover:border-border-strong disabled:opacity-70',
      ].join(' ')}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-[--radius-control] bg-brand-subtle">
        {pending ? (
          <Loader2 aria-hidden className="size-4 animate-spin text-brand" />
        ) : (
          <FileText aria-hidden className="size-4 text-brand" />
        )}
      </span>

      <span className="min-w-0">
        {/* One line, ellipsised. A long filename must not stretch the grid column it sits in. */}
        <span className="block truncate text-sm font-medium text-ink">
          {document.originalName}
        </span>
        <span className="block text-xs text-ink-subtle">
          <span className="tabular-nums">{formatBytes(document.sizeBytes)}</span>
        </span>
        {error ? (
          <span role="alert" className="block text-xs text-danger">
            {error}
          </span>
        ) : null}
      </span>

      <ExternalLink aria-hidden className="size-4 shrink-0 text-ink-subtle" />
    </button>
  );
}
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}