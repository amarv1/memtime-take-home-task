import { HierarchyTree } from '@/features/hierarchy/HierarchyTree'

export function HierarchyPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <title>Clients · Memtime</title>
      <h1 className="text-2xl font-semibold">Clients &amp; projects</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        Expand a client to see its projects, and a project to see its tasks.
      </p>
      <HierarchyTree />
    </main>
  )
}
