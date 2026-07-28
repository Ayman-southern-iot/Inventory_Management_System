import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApproverSlot,
  CreateDepartmentInput,
  CreateUserInput,
  Department,
  ListDepartmentsQuery,
  ListUsersQuery,
  Paginated,
  ResetPasswordInput,
  Setting,
  SetApproverSlotInput,
  UpdateDepartmentInput,
  UpdateSettingInput,
  UpdateUserInput,
  User,
} from '@ims/shared';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { toSearchParams } from '@/api/search-params';

/* ---------------------------------- users ---------------------------------- */

export function useUsers(query: ListUsersQuery) {
  return useQuery({
    queryKey: queryKeys.users.list(query),
    queryFn: ({ signal }) => api.get<Paginated<User>>(`/admin/users${toSearchParams(query)}`, signal),
    // Keeps the previous page on screen while the next one loads, instead of flashing empty.
    placeholderData: (previous) => previous,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) => api.post<User>('/admin/users', input),
    // Precise invalidation: a new user changes the list, not the settings or department pages.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.users.all() }),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUserInput }) =>
      api.patch<User>(`/admin/users/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.users.all() }),
  });
}

export function useSetUserActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch<User>(`/admin/users/${id}/active`, { isActive }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.all() });
      // Deactivating a user can free an approver slot, so those are stale too.
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings.approverSlots() });
    },
  });
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ResetPasswordInput }) =>
      api.post<void>(`/admin/users/${id}/password`, input),
  });
}

/* ------------------------------- departments ------------------------------- */

export function useDepartments(query: ListDepartmentsQuery) {
  return useQuery({
    queryKey: queryKeys.departments.list(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<Department>>(`/departments${toSearchParams(query)}`, signal),
    placeholderData: (previous) => previous,
  });
}

export function useCreateDepartment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDepartmentInput) => api.post<Department>('/departments', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.departments.all() }),
  });
}

export function useUpdateDepartment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateDepartmentInput }) =>
      api.patch<Department>(`/departments/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.departments.all() }),
  });
}

/* --------------------------------- settings -------------------------------- */

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings.list(),
    queryFn: ({ signal }) => api.get<Setting[]>('/admin/settings', signal),
  });
}

export function useUpdateSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSettingInput) => api.put<Setting>('/admin/settings', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings.list() }),
  });
}

export function useApproverSlots() {
  return useQuery({
    queryKey: queryKeys.settings.approverSlots(),
    queryFn: ({ signal }) => api.get<ApproverSlot[]>('/admin/settings/approver-slots', signal),
  });
}

export function useSetApproverSlot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SetApproverSlotInput) =>
      api.put<ApproverSlot[]>('/admin/settings/approver-slots', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings.approverSlots() }),
  });
}
