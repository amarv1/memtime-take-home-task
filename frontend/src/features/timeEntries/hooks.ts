import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  createTaskEntry,
  getTaskEntry,
  ENTRIES_PAGE_SIZE,
  listTaskEntries,
  type NewEntry,
  updateTaskEntry,
} from './api'

// Starts with 'entries', never ['task', id]: that key is the task detail, and
// invalidating or matching one by prefix must not touch the other.
export const entryKeys = {
  /** Every page of one task's entries. */
  forTask: (taskId: number) => ['entries', taskId] as const,
  detail: (taskId: number, entryId: number) =>
    ['entries', taskId, 'detail', entryId] as const,
  list: (taskId: number, page: number) => ['entries', taskId, page] as const,
}

/** One page (1-based) of a task's time entries. The previous page stays on screen while the next loads. */
export function useTaskEntries(taskId: number | undefined, page: number) {
  return useQuery({
    queryKey: entryKeys.list(taskId ?? 0, page),
    queryFn: () =>
      listTaskEntries(taskId ?? 0, ENTRIES_PAGE_SIZE, (page - 1) * ENTRIES_PAGE_SIZE),
    enabled: taskId !== undefined,
    placeholderData: keepPreviousData,
  })
}

/** Creates an entry on a task; every cached page of that task's entries is marked stale. */
export function useCreateEntry(taskId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['entries', 'create'],
    mutationFn: (entry: NewEntry) => createTaskEntry(taskId, entry),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: entryKeys.forTask(taskId),
        // The form that saved is about to close; whatever shows these next refetches on mount.
        refetchType: 'none',
      }),
  })
}

/** One entry of a task, for the edit form. Refetched after any change to the task's entries. */
export function useTaskEntry(taskId: number | undefined, entryId: number | undefined) {
  return useQuery({
    queryKey: entryKeys.detail(taskId ?? 0, entryId ?? 0),
    queryFn: () => getTaskEntry(taskId ?? 0, entryId ?? 0),
    enabled: taskId !== undefined && entryId !== undefined,
  })
}

/** Replaces an entry's comment and times; the task's cached entries are marked stale. */
export function useUpdateEntry(taskId: number, entryId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['entries', 'update'],
    mutationFn: (entry: NewEntry) => updateTaskEntry(taskId, entryId, entry),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: entryKeys.forTask(taskId),
        // The form that saved is about to close; whatever shows these next refetches on mount.
        refetchType: 'none',
      }),
  })
}
