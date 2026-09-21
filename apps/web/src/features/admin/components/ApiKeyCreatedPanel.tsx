import { AlertTriangle, Copy } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { t } from '@/i18n/en';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';

/**
 * The one-time reveal.
 *
 * The key is stored as a sha256 hash, so this is genuinely the only moment it can be read —
 * not a convention we could relax later, a property of the table. An admin who dismisses this
 * without copying has to revoke the key and issue another.
 *
 * The protection against that is the warning, not a trapped modal. The first version swallowed
 * `onClose` so the dialog could only be dismissed by the confirm button — but `Dialog` still
 * renders its own X, which then did nothing at all. A dead control is a worse failure than an
 * easy dismissal: the admin clicks it, nothing happens, and they have no idea whether the app
 * is broken or the key is unsaved. Every exit now works and every exit says the same thing.
 */
export function ApiKeyCreatedPanel({ token, onClose }: { token: string; onClose: () => void }) {
  const copy = useCopyToClipboard();

  return (
    <Dialog
      open
      onClose={onClose}
      icon={<AlertTriangle aria-hidden className="size-4" />}
      title={t.apiKeys.createdTitle}
      footer={<Button onClick={onClose}>{t.apiKeys.done}</Button>}
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-muted">{t.apiKeys.createdBody}</p>

        <div className="flex items-stretch gap-2">
          {/*
            `readOnly` rather than a <code> block: it has to be selectable with a keyboard and
            usable when the clipboard API is missing, which on the LAN deployment (plain HTTP,
            not a secure context) is the normal case rather than the edge one.
          */}
          <input
            readOnly
            value={token}
            aria-label={t.apiKeys.prefix}
            onFocus={(event) => event.currentTarget.select()}
            className="min-w-0 flex-1 rounded-[--radius-control] border border-border bg-surface-muted px-3 py-2 font-mono text-xs text-ink"
          />
          <Button
            variant="secondary"
            icon={<Copy aria-hidden className="size-4" />}
            onClick={() => void copy(token)}
          >
            {t.apiKeys.copy}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
