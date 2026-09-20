import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAGINATION_MAX_LIMIT, ProjectStatus } from '@ims/shared';
import type {
  CreateProjectInput,
  DecideProjectInput,
  ListProjectItemsQuery,
  Paginated,
  Project,
  ProjectDetail,
  ProjectItem,
} from '@ims/shared';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { toSearchParams } from '@/api/search-params';

/**
 * Every project, for the hub list and the pickers in the borrow dialog and requisition form.
 *
 * `GET /projects` is paginated (rules/40-database.md) and cannot return more than
 * `PAGINATION_MAX_LIMIT` in one call, so a single request silently truncates once the project
 * count passes 100 — realistic for this org per OQ-19. Neither picker has search or "load more",
 * so truncation would just make a project disappear with no signal. Instead this pages through
 * with the server's own `total` as the stop condition and concatenates, so the hook still
 * resolves to a plain `Project[]` and no consumer needs to change.
 */
/** Exported only for the pagination unit test — not part of the feature's public surface. */
export async function fetchAllProjects(
  signal: AbortSignal | undefined,
  status?: ProjectStatus,
): Promise<Project[]> {
  const items: Project[] = [];
  let page = 1;
  let total = Infinity;
  const statusFilter = status ? `&status=${status}` : '';

  while (items.length < total) {
    const result = await api.get<Paginated<Project>>(
      `/projects?page=${page}&limit=${PAGINATION_MAX_LIMIT}${statusFilter}`,
      signal,
    );
    items.push(...result.items);
    total = result.total;
    // A page with no rows but a total the loop hasn't reached would spin forever; treat it as
    // the end rather than trust `total` to be perfectly in sync with a concurrently-changing table.
    if (result.items.length === 0) break;
    page += 1;
  }

  return items;
}

/** The hub's list: every project, whatever its status, so the IM can see what is waiting. */
export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects.list(),
    queryFn: ({ signal }) => fetchAllProjects(signal),
  });
}

/**
 * What a picker offers. Only accepted projects: a proposal is not something a borrow or a
 * requisition may be charged to, which is the whole point of the propose-then-approve flow.
 */
export function useSelectableProjects() {
  return useQuery({
    queryKey: queryKeys.projects.list(ProjectStatus.ACTIVE),
    queryFn: ({ signal }) => fetchAllProjects(signal, ProjectStatus.ACTIVE),
  });
}

export function useDecideProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: DecideProjectInput & { id: string }) =>
      api.post<Project>(`/projects/${id}/decision`, body),
    onSuccess: async (_project, { id }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects.all() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(id) });
    },
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: queryKeys.projects.detail(id),
    queryFn: ({ signal }) => api.get<ProjectDetail>(`/projects/${id}`, signal),
    enabled: id.length > 0,
  });
}

export function useProjectItems(id: string, query: ListProjectItemsQuery) {
  return useQuery({
    queryKey: queryKeys.projects.items(id, query),
    queryFn: ({ signal }) =>
      api.get<Paginated<ProjectItem>>(`/projects/${id}/items${toSearchParams(query)}`, signal),
    enabled: id.length > 0,
    placeholderData: (previous) => previous,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) => api.post<Project>('/projects', input),
    // A new project only changes the list — no existing project's detail or items move.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.projects.list() }),
  });
}

/** Detach, not delete: the borrowing record is kept, it just leaves this project. */
export function useRemoveProjectItem(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (borrowRequestId: string) =>
      api.del<void>(`/projects/${projectId}/items/${borrowRequestId}`),
    onSuccess: async () => {
      // Both this project's item pages and its in-use/returned counts move; nothing else does.
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects.itemsFor(projectId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
    },
  });
}
