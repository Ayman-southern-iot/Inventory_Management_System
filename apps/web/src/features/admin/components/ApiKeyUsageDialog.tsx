import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { QueryBoundary, SkeletonRows } from '@/components/ui/states';
import { t } from '@/i18n/en';
import { useApiKeyUsage } from '../api';
import { ApiKeyUsagePanel } from './ApiKeyUsagePanel';

interface ApiKeyUsageDialogProps {
  open: boolean;
  onClose: () => void;
}

/** The generated instructions, in a dialog. Shares the page's cached usage document. */
export function ApiKeyUsageDialog({ open, onClose }: ApiKeyUsageDialogProps) {
  const usage = useApiKeyUsage();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={t.apiKeys.usageTitle}
      footer={<Button onClick={onClose}>{t.common.close}</Button>}
    >
      <QueryBoundary
        isLoading={usage.isPending}
        error={usage.error}
        data={usage.data}
        onRetry={() => void usage.refetch()}
        loadingFallback={<SkeletonRows columns={1} />}
      >
        {(data) => <ApiKeyUsagePanel usage={data} />}
      </QueryBoundary>
    </Dialog>
  );
}
