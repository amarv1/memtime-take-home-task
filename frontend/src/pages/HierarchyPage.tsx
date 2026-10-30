import { useParams } from 'react-router'
import { parseTaskId, useTask } from '@/features/hierarchy/hooks'
import { HierarchyTree } from '@/features/hierarchy/HierarchyTree'

export function HierarchyPage() {
  // Shares its cache entry with the tree, so this adds no request.
  const taskId = parseTaskId(useParams().taskId)
  const task = useTask(taskId ?? undefined)

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <title>{task.data ? `${task.data.name} · Memtime` : 'Clients · Memtime'}</title>
      <h1 className="text-2xl font-semibold">Clients &amp; projects</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        Expand a client to see its projects, and a project to see its tasks.
      </p>
      <HierarchyTree />
    </main>
  )
}
