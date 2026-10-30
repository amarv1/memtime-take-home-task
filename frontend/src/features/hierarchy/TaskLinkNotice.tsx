import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'

/** The part of a query the notice needs. */
interface LookupQuery {
  isError: boolean
  error: Error | null
  refetch: () => unknown
}

interface Props {
  /** Null when the URL id isn't a valid task id. */
  taskId: number | null
  task: LookupQuery
  project: LookupQuery
  onClear: () => void
}

const isNotFound = (error: Error | null) =>
  error instanceof ApiError && error.status === 404

/** What went wrong (or is still going on) while opening a task from the URL. */
export function TaskLinkNotice({ taskId, task, project, onClear }: Props) {
  if (taskId === null) {
    return (
      <Alert onClear={onClear}>
        <p>That task link isn't valid.</p>
      </Alert>
    )
  }

  const label = `#${taskId}`
  const failed = task.isError ? task : project.isError ? project : null

  if (!failed) {
    return (
      <p
        role="status"
        className="mb-4 flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Opening task {label}…
      </p>
    )
  }

  if (isNotFound(failed.error)) {
    return (
      <Alert onClear={onClear}>
        <p>
          {failed === task
            ? `Task ${label} wasn't found.`
            : `Couldn't find the project for task ${label}.`}
        </p>
      </Alert>
    )
  }

  return (
    <Alert onRetry={() => void failed.refetch()}>
      <p>
        Couldn't open task {label}. {failed.error?.message}
      </p>
    </Alert>
  )
}

function Alert({
  children,
  onClear,
  onRetry,
}: {
  children: ReactNode
  onClear?: () => void
  onRetry?: () => void
}) {
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 text-sm">
      {children}
      <Button variant="outline" size="sm" onClick={onClear ?? onRetry}>
        {onClear ? 'Clear selection' : 'Try again'}
      </Button>
    </div>
  )
}
