import { BorrowStatus, type BorrowRequest } from '@ims/shared';
import { Badge } from '@/components/ui/primitives';
import { t } from '@/i18n/en';

/**
 * The tracker's colour language, defined once: green means settled, amber means waiting or
 * late, red means refused. Reusing the semantic tokens keeps it consistent with every other
 * status in the app rather than inventing a second vocabulary here.
 */
const TONE: Record<BorrowStatus, 'neutral' | 'success' | 'pending' | 'danger' | 'info'> = {
  [BorrowStatus.PENDING]: 'pending',
  [BorrowStatus.REJECTED]: 'danger',
  [BorrowStatus.ISSUED]: 'info',
  [BorrowStatus.PARTIALLY_RETURNED]: 'info',
  [BorrowStatus.RETURNED]: 'success',
  [BorrowStatus.CANCELLED]: 'neutral',
};

export function BorrowStatusBadge({ borrow }: { borrow: BorrowRequest }) {
  return (
    <div className="flex flex-wrap gap-1">
      <Badge tone={TONE[borrow.status]}>{t.borrowing.status[borrow.status]}</Badge>
      {/* Overdue sits alongside the status rather than replacing it — "out" and "late" are
          two different facts and the IM needs both. */}
      {borrow.isOverdue ? <Badge tone="danger">{t.borrowing.overdue}</Badge> : null}
    </div>
  );
}
