/**
 * The app-relative routes a notification can point at.
 *
 * This mirrors `apps/web/src/routes/paths.ts` and is the one place that coupling exists. It is
 * a real coupling — the server decides where a notification goes — so it is written down in one
 * file rather than as string literals scattered through the domain services, where a route
 * rename would silently strip them.
 *
 * The failure mode is quiet, which is why this file exists: the web router ends in a
 * `path="*"` redirect to the dashboard, so a link to a route that does not exist does not 404.
 * It just takes the user somewhere unhelpful and looks like the notification was pointless.
 */
export const NOTIFICATION_LINKS = {
  dashboard: '/',
  /** Own password page — the only "account" screen that exists. */
  accountPassword: '/account/password',

  requisition: (id: string) => `/requisitions/${id}`,
  /** The approver queue. Note the path is `/approvals`, not `/requisitions/approvals`. */
  approvals: '/approvals',

  /**
   * Borrowing has no detail route — only two lists. Which one a notification should open
   * therefore depends on who is receiving it: the IM works from the all-requests queue, the
   * borrower from their own list.
   */
  borrowingQueue: '/borrowing',
  myBorrowings: '/my-borrowings',

  bom: (id: string) => `/boms/${id}`,
} as const;
