import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query'
import {
  getProject,
  getTask,
  listClients,
  listProjects,
  listTasks,
  PAGE_SIZE,
  type Project,
  type Task,
} from './api'

export const hierarchyKeys = {
  clients: () => ['clients'] as const,
  projects: (clientId: number) => ['clients', clientId, 'projects'] as const,
  tasks: (projectId: number) => ['projects', projectId, 'tasks'] as const,
  // Singular on purpose: `['projects', id]` would be a prefix of the task lists' keys.
  project: (projectId: number) => ['project', projectId] as const,
  task: (taskId: number) => ['task', taskId] as const,
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

/**
 * Finds an item in the pages already loaded by the lists under `root`
 * (`['clients', id, 'projects']` or `['projects', id, 'tasks']`), with when they were fetched.
 */
function findInLists<T extends { id: number }>(
  queryClient: QueryClient,
  root: 'clients' | 'projects',
  segment: 'projects' | 'tasks',
  id: number,
) {
  for (const query of queryClient.getQueryCache().findAll({ queryKey: [root] })) {
    if (query.queryKey[2] !== segment) continue
    const pages = (query.state.data as InfiniteData<T[]> | undefined)?.pages
    const data = pages?.flat().find((item) => item.id === id)
    if (data) return { data, updatedAt: query.state.dataUpdatedAt }
  }
  return undefined
}

// Both lookups start from the loaded lists, so selecting an item already in the tree
// costs no request. Only a cold link (a pasted URL) asks the API.
export function useTask(taskId: number | undefined) {
  const queryClient = useQueryClient()
  const cached = () =>
    taskId === undefined
      ? undefined
      : findInLists<Task>(queryClient, 'projects', 'tasks', taskId)
  return useQuery({
    queryKey: hierarchyKeys.task(taskId ?? 0),
    queryFn: () => getTask(taskId ?? 0),
    enabled: taskId !== undefined,
    staleTime: STALE_TIME,
    initialData: () => cached()?.data,
    initialDataUpdatedAt: () => cached()?.updatedAt,
  })
}

export function useProject(projectId: number | undefined) {
  const queryClient = useQueryClient()
  const cached = () =>
    projectId === undefined
      ? undefined
      : findInLists<Project>(queryClient, 'clients', 'projects', projectId)
  return useQuery({
    queryKey: hierarchyKeys.project(projectId ?? 0),
    queryFn: () => getProject(projectId ?? 0),
    enabled: projectId !== undefined,
    staleTime: STALE_TIME,
    initialData: () => cached()?.data,
    initialDataUpdatedAt: () => cached()?.updatedAt,
  })
}

// Same rule as the server: a positive integer without leading zeros.
const TASK_ID_PATTERN = /^[1-9]\d{0,9}$/

/** The task id from the URL, or null when it is missing or not a valid id. */
export function parseTaskId(raw: string | undefined): number | null {
  return raw !== undefined && TASK_ID_PATTERN.test(raw) ? Number(raw) : null
}
