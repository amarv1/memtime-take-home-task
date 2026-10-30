import { toast } from 'sonner'
import { Link, useNavigate, useParams } from 'react-router'
import { ApiError } from '@/lib/api'
import { parseTaskId, useTask } from '@/features/hierarchy/hooks'
import { AddEntryForm } from '@/features/timeEntries/AddEntryForm'

export function AddEntryPage() {
  const taskId = parseTaskId(useParams().taskId)
  const navigate = useNavigate()
  // Shares its cache entry with the tree, so this adds no request.
  const task = useTask(taskId ?? undefined)

  const entriesPath = `/tasks/${taskId}/entries`
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
          <AddEntryForm
            taskId={taskId}
            taskName={task.data?.name}
            onCancel={() => void navigate(entriesPath)}
            onCreated={(entry) => {
              toast.success(`Time entry #${entry.id} added`)
              void navigate(entriesPath)
            }}
          />
        )}
      </div>
    </main>
  )
}
