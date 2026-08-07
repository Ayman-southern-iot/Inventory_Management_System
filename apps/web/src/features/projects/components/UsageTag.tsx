import { ProjectUsage } from '@ims/shared';
import { Badge } from '@/components/ui/primitives';
import { t } from '@/i18n/en';

/**
 * `pending` for in use and `success` for returned: an item still out is an open obligation,
 * a returned one is settled. Tones come from the token set so the tracker's colours are
 * defined once.
 */
export function UsageTag({ usage }: { usage: ProjectUsage }) {
  return usage === ProjectUsage.RETURNED ? (
    <Badge tone="success">{t.projects.tagReturned}</Badge>
  ) : (
    <Badge tone="pending">{t.projects.tagInUse}</Badge>
  );
}