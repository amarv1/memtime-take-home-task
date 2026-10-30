import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { parseTaskId, useTask } from '@/features/hierarchy/hooks'
import { parseEntryId, type TimeEntry } from '@/features/timeEntries/api'
import { EntryForm } from '@/features/timeEntries/EntryForm'
import { useTaskEntry, useUpdateEntry } from '@/features/timeEntries/hooks'
import { ApiError } from '@/lib/api'

function useEntryParams() {
  const params = useParams()
  const taskId = parseTaskId(params.taskId)
  const entryId = parseEntryId(params.entryId)
  return { taskId, entryId }
}

export function EditEntryPage() {
  const { taskId, entryId } = useEntryParams()
  // Shares its cache entry with the tree, so this adds no request.
  const task = useTask(taskId ?? undefined)
  const entry = useTaskEntry(taskId ?? undefined, entryId ?? undefined)

  return (
    <main className="px-6 py-8">
      <title>Edit time entry · Memtime</title>
      <h1 className="text-2xl font-semibold">Edit time entry</h1>
      <div className="mt-6">
        {taskId === null || entryId === null ? (
          <NotFound />
        ) : entry.isError ? (
          entry.error instanceof ApiError && entry.error.status === 404 ? (
            <NotFound taskId={taskId} />
          ) : (
            <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
              <p>{`Couldn't load the time entry. ${entry.error.message}`}</p>
              <Button variant="outline" size="sm" onClick={() => void entry.refetch()}>
                Try again
              </Button>
            </div>
          )
        ) : !entry.data ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading time entry…
          </p>
        ) : (
          <EditEntry taskId={taskId} taskName={task.data?.name} entry={entry.data} />
        )}
      </div>
    </main>
  )
}

function NotFound({ taskId }: { taskId?: number }) {
  return (
    <p className="text-sm text-muted-foreground">
      That time entry doesn't exist.{' '}
      <Link
        to={taskId === undefined ? '/' : `/tasks/${taskId}/entries`}
        className="underline"
      >
        {taskId === undefined
          ? 'Pick a task from the list'
          : 'Back to the task’s entries'}
      </Link>
      .
    </p>
  )
}

interface EditEntryProps {
  taskId: number
  taskName: string | undefined
  entry: TimeEntry
}

function EditEntry({ taskId, taskName, entry }: EditEntryProps) {
  const navigate = useNavigate()
  const save = useUpdateEntry(taskId, entry.id)
  const entriesPath = `/tasks/${taskId}/entries`

  return (
    <EntryForm
      taskId={taskId}
      taskName={taskName}
      entry={entry}
      save={save}
      submitLabel="Save changes"
      notFoundMessage="This time entry doesn't exist any more."
      onCancel={() => void navigate(entriesPath)}
      onUnchanged={() => {
        toast.info('No changes to save')
        void navigate(entriesPath)
      }}
      onSaved={(updated) => {
        toast.success(`Time entry #${updated.id} updated`)
        void navigate(entriesPath)
      }}
    />
  )
}
