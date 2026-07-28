import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ErrorCode, type Role } from '@ims/shared';
import { ApiError } from '@/api/client';
import { LoadingState, ErrorState } from '@/components/ui/states';
import { useAuth } from '@/features/auth/auth-context';
import { ROUTES } from './paths';

/**
 * The client-side gate is for navigation, not security — the API enforces the same rules and
 * would 403 anyway. Its job is that a user never sees a link to a page they cannot open.
 */
export function ProtectedRoute({ roles }: { roles?: Role[] }) {
  const { user, isRestoring, hasRole } = useAuth();
  const location = useLocation();

  if (isRestoring) return <LoadingState />;

  if (!user) {
    return <Navigate to={ROUTES.login} replace state={{ from: location.pathname }} />;
  }

  // A forced password change blocks everything except the change-password screen itself.
  if (user.mustChangePassword && location.pathname !== ROUTES.changePassword) {
    return <Navigate to={ROUTES.changePassword} replace />;
  }

  if (roles && roles.length > 0 && !hasRole(...roles)) {
    // Rendered as the real thing so the "not allowed" screen is identical whether the block
    // came from the router or from a 403 the API returned.
    return <ErrorState error={new ApiError(ErrorCode.FORBIDDEN, 'Forbidden', 403)} />;
  }

  return <Outlet />;
}
