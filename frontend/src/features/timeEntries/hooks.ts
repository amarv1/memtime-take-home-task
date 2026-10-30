import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ENTRIES_PAGE_SIZE, listTaskEntries } from './api'

// Starts with 'entries', never ['task', id]: that key is the task detail, and
// invalidating or matching one by prefix must not touch the other.
export const entryKeys = {
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
