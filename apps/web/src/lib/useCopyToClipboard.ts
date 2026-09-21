import { useCallback } from 'react';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';

/**
 * Copy text, and say whether it worked.
 *
 * `navigator.clipboard` is undefined outside a secure context, which on this project is not a
 * hypothetical: the LAN deployment is served over plain HTTP to an IP address, and that is the
 * exact situation where an admin is copying an API key. The failure has to be visible and has
 * to tell them what to do instead, because the key cannot be shown again.
 */
export function useCopyToClipboard(): (text: string) => Promise<boolean> {
  const toast = useToast();

  return useCallback(
    async (text: string) => {
      try {
        if (!navigator.clipboard) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(text);
        toast.success(t.apiKeys.copied);
        return true;
      } catch {
        toast.error(t.apiKeys.copyFailed);
        return false;
      }
    },
    [toast],
  );
}
