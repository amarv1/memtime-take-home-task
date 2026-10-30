import { useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/features/hierarchy/StatusBadge'
import { parseTaskId, useTask } from '@/features/hierarchy/hooks'
import { ENTRIES_PAGE_SIZE } from '@/features/timeEntries/api'
import { EntriesPagination } from '@/features/timeEntries/EntriesPagination'
import { EntriesTable } from '@/features/timeEntries/EntriesTable'
import { useTaskEntries } from '@/features/timeEntries/hooks'
import { ApiError } from '@/lib/api'

const PAGE_PATTERN = /^[1-9]\d{0,6}$/

/** The `?page=N` param, 1-based; anything that isn't a positive whole number counts as 1. */
function parsePage(raw: string | null): number {
  return raw !== null && PAGE_PATTERN.test(raw) ? Number(raw) : 1
}

export function TaskEntriesPage() {
  const taskId = parseTaskId(useParams().taskId)
  const [searchParams, setSearchParams] = useSearchParams()
  const page = parsePage(searchParams.get('page'))

  // Shares its cache entry with the tree, so this adds no request.
  const task = useTask(taskId ?? undefined)
  const entries = useTaskEntries(taskId ?? undefined, page)

  const total = entries.data?.total
  // While the next page loads, `data` is still the previous one; its total is fine to use.
  const lastPage =
    total === undefined ? undefined : Math.max(1, Math.ceil(total / ENTRIES_PAGE_SIZE))

  function goToPage(next: number) {
    setSearchParams((current) => {
      const params = new URLSearchParams(current)
      params.set('page', String(next))
      return params
    })
  }

  // A page past the end (a stale link, or entries that were removed) goes to the last page.
  useEffect(() => {
    if (lastPage !== undefined && page > lastPage && !entries.isPlaceholderData) {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current)
          params.set('page', String(lastPage))
          return params
        },
        { replace: true },
      )
    }
  }, [page, lastPage, entries.isPlaceholderData, setSearchParams])

  return (
    <main className="px-6 py-8">
      <title>
        {task.data ? `${task.data.name} · Memtime` : 'Time entries · Memtime'}
      </title>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">
          {taskId === null ? 'Task not found' : (task.data?.name ?? `Task #${taskId}`)}
        </h1>
        {task.data && <StatusBadge status={task.data.status} />}
      </div>
      {taskId !== null && (
        <p className="mt-1 text-sm text-muted-foreground">
          {task.data ? `Task #${task.data.id} · ` : ''}Time entries
        </p>
      )}

      <section aria-label="Time entries" className="mt-6">
        {taskId === null ? (
          <p className="text-sm text-muted-foreground">That task link isn't valid.</p>
        ) : entries.isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
            <p>{errorMessage(entries.error)}</p>
            <Button variant="outline" size="sm" onClick={() => void entries.refetch()}>
              Try again
            </Button>
          </div>
        ) : !entries.data ? (
          <Loading />
        ) : entries.data.total === 0 ? (
          <p className="text-sm text-muted-foreground">
            No time entries for this task yet.
          </p>
        ) : (
          <div aria-busy={entries.isPlaceholderData}>
            <EntriesTable entries={entries.data.items} />
            <EntriesPagination
              page={page}
              pageSize={ENTRIES_PAGE_SIZE}
              total={entries.data.total}
              onPageChange={(next) => goToPage(next)}
            />
          </div>
        )}
      </section>
    </main>
  )
}

function errorMessage(error: Error): string {
  if (error instanceof ApiError && error.status === 429) {
    return 'Memtime is receiving too many requests right now. Wait a minute, then try again.'
  }
  return `Couldn't load time entries. ${error.message}`
}

/** The first load can take a few seconds: the server reads all of the user's entries. */
function Loading() {
  return (
    <div role="status">
      <p className="mb-3 text-sm text-muted-foreground">Loading time entries…</p>
      <div className="flex flex-col gap-2" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-8 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    </div>
  )
}
