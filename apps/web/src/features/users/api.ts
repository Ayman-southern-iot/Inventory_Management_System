import { useQuery } from '@tanstack/react-query';
import type { Paginated, SelectableUser, SelectableUsersQuery } from '@ims/shared';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { toSearchParams } from '@/api/search-params';

/**
 * The name picker behind every "choose a person" control — the holder reassignment dialog, and
 * the delegate picker when that gets a UI.
 *
 * Deliberately **not** in `features/admin/api.ts`. `GET /admin/users` is `@Roles(ADMIN)` and
 * returns emails, roles and departments; `GET /users/selectable` is open to APPROVER /
 * INVENTORY_MANAGER / ADMIN and returns a name and a designation and nothing else. Putting the
 * two in one file is how an Inventory Manager's picker ends up calling the admin route and
 * 403-ing in production.
 */
export function useSelectableUsers(query: SelectableUsersQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.users.selectable(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<SelectableUser>>(`/users/selectable${toSearchParams(query)}`, signal),
    enabled,
    placeholderData: (previous) => previous,
  });
}
