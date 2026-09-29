import type { ReactNode } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { t } from '@/i18n/en';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';

interface CopyableSnippetProps {
  title: string;
  text: string;
  /**
   * The copy button's accessible name, when "Copy" alone would be ambiguous — the usage panel has
   * one per write endpoint. Should start with the visible word so speech control still finds it.
   */
  copyLabel?: string;
  /** Rendered under the snippet, e.g. the warning that belongs next to the copy button. */
  children?: ReactNode;
  /** 4 when nested under another section's heading, such as inside an endpoint card. */
  headingLevel?: 3 | 4;
}

/** A titled block of copy-paste text with its own copy button. */
export function CopyableSnippet({
  title,
  text,
  copyLabel,
  children,
  headingLevel = 3,
}: CopyableSnippetProps) {
  const copy = useCopyToClipboard();
  const Heading = headingLevel === 4 ? 'h4' : 'h3';

  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Heading className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          {title}
        </Heading>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={copyLabel}
          icon={<Copy aria-hidden className="size-4" />}
          onClick={() => void copy(text)}
        >
          {t.apiKeys.copy}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-[--radius-control] bg-surface-muted p-3 font-mono text-xs text-ink">
        {text}
      </pre>
      {children}
    </section>
  );
}
