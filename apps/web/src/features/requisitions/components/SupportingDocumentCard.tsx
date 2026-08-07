import { ExternalLink, FileText } from 'lucide-react';
import type { SupportingDocument } from '@ims/shared';
import { t } from '@/i18n/en';

const PAPER_WIDTH = 'w-[140px]';
const PAPER_HEIGHT = 'h-[180px]';

/**
 * The "paper thumbnail" card shown on the requisition detail page above the status panel.
 *
 * Visual:
 *   - a small white rectangle (~140×180px) with a subtle drop shadow and a folded corner
 *   - inside: a generic file glyph plus, for PDFs, the file name laid out like a title
 *   - below: the original file name + size
 *   - whole thing is a link that opens the bytes in a new tab
 *
 * When no document is attached, the card renders `null`. Absence is the signal "nothing to
 * look at" — no empty-state copy, no placeholder.
 */
export function SupportingDocumentCard({
  document,
  url,
}: {
  document: SupportingDocument | null;
  url: string | null;
}) {
  if (!document || !url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex w-fit flex-col items-center gap-1.5 text-left"
    >
      <div
        className={`relative ${PAPER_WIDTH} ${PAPER_HEIGHT} rounded-sm border border-border bg-white shadow-[0_4px_12px_-4px_rgba(15,23,42,0.18)] transition-shadow group-hover:shadow-[0_6px_18px_-4px_rgba(15,23,42,0.28)]`}
      >
        {/* Folded corner */}
        <div className="absolute right-0 top-0 h-5 w-5 bg-surface-muted [clip-path:polygon(100%_0,0_0,100%_100%)]" />
        <div className="absolute right-0 top-0 h-5 w-5 border-l border-b border-border [clip-path:polygon(100%_0,0_0,100%_100%)]" />

        <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
          <FileText aria-hidden className="size-10 text-ink-subtle" />
          <span className="line-clamp-3 text-xs font-medium leading-tight text-ink">
            {document.originalName}
          </span>
        </div>
      </div>

      <div className="flex flex-col items-center text-center">
        <span className="text-xs font-medium text-ink">{t.requisitions.supportingDocumentCard.label}</span>
        <span className="flex items-center gap-1 text-[11px] text-ink-subtle">
          <span className="tabular-nums">{formatBytes(document.sizeBytes)}</span>
          <ExternalLink aria-hidden className="size-3" />
        </span>
      </div>
    </a>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}