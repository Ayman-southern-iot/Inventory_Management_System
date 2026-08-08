import { useEffect, useRef, useState } from 'react';
import { ExternalLink, FileText, Loader2 } from 'lucide-react';
import type { SupportingDocument } from '@ims/shared';
import { api } from '@/api/client';
import { t } from '@/i18n/en';

const PAPER_WIDTH = 'w-[140px]';
const PAPER_HEIGHT = 'h-[180px]';

/**
 * The "paper thumbnail" card shown on the requisition detail page, sitting as the right
 * column of the status box (next to the badges + requested/sanctioned/approvers figures).
 *
 * Visual:
 *   - a small white rectangle (~140×180px) with a subtle drop shadow and a folded corner
 *   - inside: a generic file glyph plus, for PDFs, the file name laid out like a title
 *   - below: the original file name + size
 *   - whole thing is a button that opens the bytes in a new tab
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
      className="group inline-flex w-fit flex-col items-center gap-1.5 text-left disabled:cursor-wait"
      disabled={pending}
    >
      <div
        className={`relative ${PAPER_WIDTH} ${PAPER_HEIGHT} rounded-sm border border-border bg-white shadow-[0_4px_12px_-4px_rgba(15,23,42,0.18)] transition-shadow group-hover:shadow-[0_6px_18px_-4px_rgba(15,23,42,0.28)]`}
      >
        {/* Folded corner */}
        <div className="absolute right-0 top-0 h-5 w-5 bg-surface-muted [clip-path:polygon(100%_0,0_0,100%_100%)]" />
        <div className="absolute right-0 top-0 h-5 w-5 border-l border-b border-border [clip-path:polygon(100%_0,0_0,100%_100%)]" />

        <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
          {pending ? (
            <Loader2 aria-hidden className="size-10 animate-spin text-ink-subtle" />
          ) : (
            <FileText aria-hidden className="size-10 text-ink-subtle" />
          )}
          <span className="line-clamp-3 text-xs font-medium leading-tight text-ink">
            {document.originalName}
          </span>
        </div>
      </div>

      <div className="flex flex-col items-center text-center">
        <span className="text-xs font-medium text-ink">
          {t.requisitions.supportingDocumentCard.label}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-ink-subtle">
          <span className="tabular-nums">{formatBytes(document.sizeBytes)}</span>
          <ExternalLink aria-hidden className="size-3" />
        </span>
        {error ? (
          <span role="alert" className="mt-0.5 text-[11px] text-danger">
            {error}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}