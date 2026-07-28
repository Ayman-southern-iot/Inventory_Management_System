import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Role } from '@ims/shared';
import { ApiError } from '@/api/client';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState } from '@/components/ui/states';
import { ToastProvider } from '@/components/ui/Toast';
import { AuthProvider } from '@/features/auth/auth-context';
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { DepartmentsPage } from '@/features/admin/DepartmentsPage';
import { InventoryPage } from '@/features/inventory/InventoryPage';
import { ProductDetailPage } from '@/features/inventory/ProductDetailPage';
import { CategoriesPage } from '@/features/inventory/CategoriesPage';
import { LocationsPage } from '@/features/inventory/LocationsPage';
import { SettingsPage } from '@/features/admin/SettingsPage';
import { UsersPage } from '@/features/admin/UsersPage';
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

                    {/* The stock register belongs to the Inventory Manager; an admin gets it
                        too, since they are the fallback when the IM is away. */}
                    <Route
                      element={
                        <ProtectedRoute roles={[Role.INVENTORY_MANAGER, Role.ADMIN]} />
                      }
                    >
                      <Route path={ROUTES.inventory.products} element={<InventoryPage />} />
                      <Route
                        path={ROUTES.inventory.productPattern}
                        element={<ProductDetailPage />}
                      />
                      <Route path={ROUTES.inventory.categories} element={<CategoriesPage />} />
                      <Route path={ROUTES.inventory.locations} element={<LocationsPage />} />
                    </Route>

                    <Route element={<ProtectedRoute roles={[Role.ADMIN]} />}>
                      <Route path={ROUTES.admin.users} element={<UsersPage />} />
                      <Route path={ROUTES.admin.departments} element={<DepartmentsPage />} />
                      <Route path={ROUTES.admin.settings} element={<SettingsPage />} />
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
