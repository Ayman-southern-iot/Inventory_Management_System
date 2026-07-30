import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useRenderBom } from '../api';

/**
 * Sends POST /boms/:id/render and toasts the outcome.
 *
 * The mutation is idempotent at the API level (the controller hashes the
 * `Idempotency-Key` header and replays the cached response), so a double-click
 * cannot fire Chromium twice. The button also disables itself while
 * `isPending` so the click is single-shot.
 */
export function BomRenderButton({ id, hasPdf }: { id: string; hasPdf: boolean }) {
  const toast = useToast();
  const render = useRenderBom();

  async function onClick() {
    try {
      await render.mutateAsync({ id });
      toast.success(t.boms.renderToast);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      icon={<FileText aria-hidden className="size-4" />}
      isLoading={render.isPending}
      disabled={render.isPending}
      onClick={onClick}
    >
      {hasPdf ? t.boms.reRender : t.boms.render}
    </Button>
  );
}
