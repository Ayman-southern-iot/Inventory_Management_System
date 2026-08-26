import { useEffect } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { t } from '@/i18n/en';
import { ROUTES } from '@/routes/paths';

/**
 * D-012. Every page reported "Inventory Management System" in the tab, so a browser with four
 * IMS tabs open showed four identical ones, and browser history was a wall of the same entry.
 *
 * Driven from the route table rather than from each page, so a new screen cannot quietly ship
 * without a title, and so the titles sit together where they can be read as a set. Most specific
 * pattern first: `/boms/new` has to be tested before `/boms/:bomId`, which would otherwise
 * swallow it.
 */
const TITLES: ReadonlyArray<readonly [string, string]> = [
  [ROUTES.login, t.auth.signInTitle],
  [ROUTES.changePassword, t.auth.changePasswordTitle],
  [ROUTES.account.profile, t.nav.account],

  [ROUTES.inventory.categories, t.categories.title],
  [ROUTES.inventory.locations, t.locations.title],
  [ROUTES.inventory.products, t.inventory.title],
  [ROUTES.inventory.productPattern, t.inventory.title],

  [ROUTES.borrowing.mine, t.nav.myBorrowings],
  [ROUTES.borrowing.all, t.nav.borrowing],

  [ROUTES.reports.expenses, t.nav.expenses],

  [ROUTES.boms.new, t.boms.newBom],
  [ROUTES.boms.all, t.boms.title],
  [ROUTES.boms.detailPattern, t.boms.title],

  [ROUTES.requisitions.new, t.requisitions.newRequisition],
  [ROUTES.requisitions.editPattern, t.requisitions.newRequisition],
  [ROUTES.requisitions.mine, t.requisitions.myTitle],
  [ROUTES.requisitions.approvals, t.requisitions.approvalsTitle],
  [ROUTES.requisitions.all, t.requisitions.title],
  [ROUTES.requisitions.detailPattern, t.requisitions.title],

  [ROUTES.projects.all, t.projects.title],
  [ROUTES.projects.detailPattern, t.projects.title],

  [ROUTES.admin.users, t.users.title],
  [ROUTES.admin.departments, t.departments.title],
  [ROUTES.admin.settings, t.settings.title],
  [ROUTES.admin.auditLog, t.auditLog.title],

  [ROUTES.dashboard, t.dashboard.title],
];

/** Exported for the test, and so a caller can compose the same string for a page heading. */
export function titleForPath(pathname: string): string {
  const match = TITLES.find(([pattern]) => matchPath({ path: pattern, end: true }, pathname));
  // An unmatched path is the 404 screen, which is a real page and deserves a real title.
  return match ? match[1] : t.states.notFoundTitle;
}

/**
 * Sets `document.title` from the current route. Mounted once, above the routes, rather than
 * called by every page — a per-page call is a per-page thing to forget.
 */
export function useDocumentTitle(): void {
  const { pathname } = useLocation();

  useEffect(() => {
    document.title = `${titleForPath(pathname)} · ${t.app.shortName}`;
  }, [pathname]);
}

/** Renders nothing; exists so the hook can live above `<Routes>` without wrapping it. */
export function DocumentTitle(): null {
  useDocumentTitle();
  return null;
}
