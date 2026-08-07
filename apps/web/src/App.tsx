import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Role } from '@ims/shared';
import { ApiError } from '@/api/client';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState } from '@/components/ui/states';
import { ToastProvider } from '@/components/ui/Toast';
import { AuthProvider } from '@/features/auth/auth-context';
import { ChangePasswordPage } from '@/features/auth/pages/ChangePasswordPage';
import { ProfilePage } from '@/features/profile/pages/ProfilePage';
import { LoginPage } from '@/features/auth/pages/LoginPage';
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage';
import { DepartmentsPage } from '@/features/admin/pages/DepartmentsPage';
import { InventoryPage } from '@/features/inventory/pages/InventoryPage';
import { ProductDetailPage } from '@/features/inventory/pages/ProductDetailPage';
import { CategoriesPage } from '@/features/inventory/pages/CategoriesPage';
import { LocationsPage } from '@/features/inventory/pages/LocationsPage';
import { BorrowingPage } from '@/features/borrowing/pages/BorrowingPage';
import { RequisitionsPage } from '@/features/requisitions/pages/RequisitionsPage';
import { ExpensesPage } from '@/features/reports/pages/ExpensesPage';
import { RequisitionFormPage } from '@/features/requisitions/pages/RequisitionFormPage';
import { RequisitionDetailPage } from '@/features/requisitions/pages/RequisitionDetailPage';
import { BomsPage } from '@/features/boms/pages/BomsPage';
import { BomGeneratePage } from '@/features/boms/pages/BomGeneratePage';
import { BomDetailPage } from '@/features/boms/pages/BomDetailPage';
import { ProjectsPage } from '@/features/projects/pages/ProjectsPage';
import { SettingsPage } from '@/features/admin/pages/SettingsPage';
import { UsersPage } from '@/features/admin/pages/UsersPage';
import { AuditLogPage } from '@/features/admin/pages/AuditLogPage';
import { t } from '@/i18n/en';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { ROUTES } from '@/routes/paths';

const RETRYABLE_ATTEMPTS = 2;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Retrying a 401/403/404 just delays the error the user needs to see.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < RETRYABLE_ATTEMPTS;
      },
    },
    mutations: { retry: false },
  },
});

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {/* Opt into the v7 behaviours now, while the router surface is small enough that a
            difference in transition timing is cheap to notice. */}
        <BrowserRouter
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          {/* AuthProvider needs the query client (it clears the cache on sign-out) and the
              router (routes read the user), so it sits inside both. */}
          <ToastProvider>
            <AuthProvider>
              <Routes>
                <Route path={ROUTES.login} element={<LoginPage />} />

                <Route element={<ProtectedRoute />}>
                  <Route element={<AppShell />}>
                    <Route path={ROUTES.dashboard} element={<DashboardPage />} />
                    <Route path={ROUTES.changePassword} element={<ChangePasswordPage />} />
                    <Route path={ROUTES.account.profile} element={<ProfilePage />} />
                    {/* Anyone may borrow, so My borrowings is not role-gated. */}
                    <Route path={ROUTES.borrowing.mine} element={<BorrowingPage mine />} />

                    {/* The project hub is shared context — every role sees it, so no guard. */}
                    <Route path={ROUTES.projects.all} element={<ProjectsPage />} />

                    {/* Anyone may raise a requisition and follow their own. The API decides
                        what each caller sees, so these are not role-gated. New before the
                        :id pattern is unnecessary — React Router ranks static segments above
                        dynamic ones — but the edit route must sit alongside the detail one. */}
                    <Route path={ROUTES.requisitions.mine} element={<RequisitionsPage mode="mine" />} />
                    <Route path={ROUTES.requisitions.new} element={<RequisitionFormPage />} />
                    <Route path={ROUTES.requisitions.editPattern} element={<RequisitionFormPage />} />
                    <Route path={ROUTES.requisitions.detailPattern} element={<RequisitionDetailPage />} />

                    {/* The approver's queue. IM and admin hold approval duties too. */}
                    <Route
                      element={
                        <ProtectedRoute
                          roles={[Role.APPROVER, Role.INVENTORY_MANAGER, Role.ADMIN]}
                        />
                      }
                    >
                      <Route
                        path={ROUTES.requisitions.approvals}
                        element={<RequisitionsPage mode="approvals" />}
                      />
                      {/* Same guard as the approver queue: an approver needs the shape of the
                          spend they are sanctioning, a requester has no business with it. */}
                      <Route path={ROUTES.reports.expenses} element={<ExpensesPage />} />
                    </Route>

                    {/* Browsing the catalogue is everyone's — a general user has to find a
                        product before they can borrow it (task 2.7). The stock actions on
                        these pages are gated by role, and by the API regardless. */}
                    <Route path={ROUTES.inventory.products} element={<InventoryPage />} />
                    <Route
                      path={ROUTES.inventory.productPattern}
                      element={<ProductDetailPage />}
                    />

                    {/* Managing the register, and seeing everyone's borrows, is the IM's. */}
                    <Route
                      element={
                        <ProtectedRoute roles={[Role.INVENTORY_MANAGER, Role.ADMIN]} />
                      }
                    >
                      <Route path={ROUTES.inventory.categories} element={<CategoriesPage />} />
                      <Route path={ROUTES.inventory.locations} element={<LocationsPage />} />
                      <Route path={ROUTES.borrowing.all} element={<BorrowingPage />} />
                      <Route
                        path={ROUTES.requisitions.all}
                        element={<RequisitionsPage mode="all" />}
                      />
                      <Route path={ROUTES.boms.all} element={<BomsPage />} />
                      <Route path={ROUTES.boms.new} element={<BomGeneratePage />} />
                      <Route path={ROUTES.boms.detailPattern} element={<BomDetailPage />} />
                    </Route>

                    <Route element={<ProtectedRoute roles={[Role.ADMIN]} />}>
                      <Route path={ROUTES.admin.users} element={<UsersPage />} />
                      <Route path={ROUTES.admin.departments} element={<DepartmentsPage />} />
                      <Route path={ROUTES.admin.settings} element={<SettingsPage />} />
                      <Route path={ROUTES.admin.auditLog} element={<AuditLogPage />} />
                    </Route>

                    <Route
                      path="*"
                      element={
                        <EmptyState
                          title={t.states.notFoundTitle}
                          body={t.states.notFoundBody}
                        />
                      }
                    />
                  </Route>
                </Route>

                <Route path="*" element={<Navigate to={ROUTES.dashboard} replace />} />
              </Routes>
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
