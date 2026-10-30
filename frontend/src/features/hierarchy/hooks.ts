import { useInfiniteQuery } from '@tanstack/react-query'
import { listClients, listProjects, listTasks, PAGE_SIZE } from './api'

export const hierarchyKeys = {
  clients: () => ['clients'] as const,
  projects: (clientId: number) => ['clients', clientId, 'projects'] as const,
  tasks: (projectId: number) => ['projects', projectId, 'tasks'] as const,
}

// The app only reads this data, so re-expanding a node within this window must not refetch.
const STALE_TIME = 5 * 60_000

/** Shared paging: a full page means there may be more, a short one means we're done. */
function paged<T>(fetchPage: (offset: number) => Promise<T[]>) {
  return {
    queryFn: ({ pageParam }: { pageParam: number }) => fetchPage(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last: T[], all: T[][]) =>
      last.length < PAGE_SIZE ? undefined : all.reduce((sum, p) => sum + p.length, 0),
    select: (data: { pages: T[][] }) => data.pages.flat(),
    staleTime: STALE_TIME,
  }
}

export function useClients() {
  return useInfiniteQuery({
    queryKey: hierarchyKeys.clients(),
    ...paged(listClients),
  })
}

// The hooks below are only called by components that render while their node is
// expanded, so a level is fetched only when the user opens it.
export function useProjects(clientId: number) {
  return useInfiniteQuery({
    queryKey: hierarchyKeys.projects(clientId),
    ...paged((offset) => listProjects(clientId, offset)),
  })
}

export function useTasks(projectId: number) {
  return useInfiniteQuery({
    queryKey: hierarchyKeys.tasks(projectId),
    ...paged((offset) => listTasks(projectId, offset)),
  })
}
