import type { AuthUser } from '@ims/shared';
import { Badge } from '@/components/ui/primitives';
import { t } from '@/i18n/en';

/**
 * Who the signed-in user is: name, email, designation, roles. Rendered both in the header dropdown
 * and on the account page, which must not drift apart — a role badge showing in one place and not
 * the other reads as a permissions bug rather than a markup one.
 */
export function UserIdentity({ user }: { user: AuthUser }) {
  return (
    <>
      <p className="text-sm font-medium text-ink">{user.fullName}</p>
      <p className="text-xs text-ink-muted">{user.email}</p>
      <p className="mt-1 text-xs text-ink-subtle">{user.designation}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {user.roles.map((role) => (
          <Badge key={role} tone="info">
            {t.roles[role]}
          </Badge>
        ))}
      </div>
    </>
  );
}
