import { useParams } from 'react-router'
import { parseTaskId, useTask } from '@/features/hierarchy/hooks'

export function HierarchyPage() {
  // Shares its cache entry with the tree, so this adds no request.
  const taskId = parseTaskId(useParams().taskId)
  const task = useTask(taskId ?? undefined)

  return (
    <main className="px-6 py-8">
      <title>{task.data ? `${task.data.name} · Memtime` : 'Clients · Memtime'}</title>
      <h1 className="text-2xl font-semibold">{task.data?.name ?? 'Select a task'}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {task.data
          ? `Task #${task.data.id}`
          : 'Expand a client to see its projects, and a project to see its tasks.'}
      </p>
    </main>
  )
}
