import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { createTaskEntry, ENTRIES_PAGE_SIZE, listTaskEntries, type NewEntry } from './api'

// Starts with 'entries', never ['task', id]: that key is the task detail, and
// invalidating or matching one by prefix must not touch the other.
export const entryKeys = {
  /** Every page of one task's entries. */
  forTask: (taskId: number) => ['entries', taskId] as const,
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

/** Creates an entry on a task; every cached page of that task's entries is refetched after. */
export function useCreateEntry(taskId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['entries', 'create'],
    mutationFn: (entry: NewEntry) => createTaskEntry(taskId, entry),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: entryKeys.forTask(taskId) }),
  })
}
