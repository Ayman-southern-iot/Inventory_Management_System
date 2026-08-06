import { Link } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { Role } from '@ims/shared';
import { PageHeader, Panel } from '@/components/ui/primitives';
import { UserIdentity } from '@/components/UserIdentity';
import { t } from '@/i18n/en';
import { useAuth } from '@/features/auth/auth-context';
import { ROUTES } from '@/routes/paths';
import { SignaturePanel } from './SignaturePanel';

/**
 * The signed-in user's own account: who they are, the signature applied when they approve, and
 * the way to their password.
 *
 * The route is deliberately not role-gated — everyone has an account. The signature panel gates
 * itself, because the API refuses a non-signer and showing a control that 403s is worse than not
 * showing it at all.
 */
export function ProfilePage() {
  const { user, hasRole } = useAuth();
  const canSign = hasRole(Role.APPROVER, Role.INVENTORY_MANAGER, Role.ADMIN);

  if (!user) return null;

  return (
    <div className="mx-auto max-w-md">
      <PageHeader title={t.nav.account} />

      <Panel className="p-5">
        <UserIdentity user={user} />
      </Panel>

      {canSign && (
        <div className="mt-8">
          <SignaturePanel />
        </div>
      )}

      <Link
        to={ROUTES.changePassword}
        className="mt-8 flex items-center gap-2 text-sm text-ink-muted hover:text-ink"
      >
        <KeyRound aria-hidden className="size-4" />
        {t.account.changePassword}
      </Link>
    </div>
  );
}
