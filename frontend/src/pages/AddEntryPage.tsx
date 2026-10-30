import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { parseTaskId, useTask } from '@/features/hierarchy/hooks'
import { EntryForm } from '@/features/timeEntries/EntryForm'
import { useCreateEntry } from '@/features/timeEntries/hooks'
import { ApiError } from '@/lib/api'

export function AddEntryPage() {
  const taskId = parseTaskId(useParams().taskId)
  // Shares its cache entry with the tree, so this adds no request.
  const task = useTask(taskId ?? undefined)
  const unknownTask = task.error instanceof ApiError && task.error.status === 404

  return (
    <main className="px-6 py-8">
      <title>Add time entry · Memtime</title>
      <h1 className="text-2xl font-semibold">Add time entry</h1>
      <div className="mt-6">
        {taskId === null || unknownTask ? (
          <p className="text-sm text-muted-foreground">
            That task doesn't exist.{' '}
            <Link to="/" className="underline">
              Pick another from the list
            </Link>
            .
          </p>
        ) : (
          <AddEntry taskId={taskId} taskName={task.data?.name} />
        )}
      </div>
    </main>
  )
}

function AddEntry({ taskId, taskName }: { taskId: number; taskName?: string }) {
  const navigate = useNavigate()
  const save = useCreateEntry(taskId)
  const entriesPath = `/tasks/${taskId}/entries`

  return (
    <EntryForm
      taskId={taskId}
      taskName={taskName}
      save={save}
      submitLabel="Add entry"
      notFoundMessage="This task doesn't exist any more."
      onCancel={() => void navigate(entriesPath)}
      onSaved={(entry) => {
        toast.success(`Time entry #${entry.id} added`)
        void navigate(entriesPath)
      }}
    />
  )
}
