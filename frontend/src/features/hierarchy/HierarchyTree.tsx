import { Loader2 } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ClientItem } from './HierarchyNodes'
import { useClients } from './hooks'
import { NodeList } from './NodeList'
import { TreeContext } from './treeContext'
import { useTreeKeyboard } from './useTreeKeyboard'

/** Clients, their projects and their tasks. Each level loads when its parent is expanded. */
export function HierarchyTree() {
  const clients = useClients()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const treeRef = useRef<HTMLUListElement>(null)

  function toggle(key: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }
  const onKeyDown = useTreeKeyboard(toggle)

  // If the item that was in the tab order is gone (its parent collapsed, or a
  // "Load more" row vanished), fall back to the first item so Tab still reaches the tree.
  // Runs after every render on purpose: the DOM can change without activeKey changing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const tree = treeRef.current
    if (
      activeKey !== null &&
      tree &&
      !tree.querySelector(`[data-node-key="${activeKey}"]`)
    ) {
      setActiveKey(null)
    }
  })

  if (clients.isPending) {
    return (
      <div role="status" className="flex flex-col gap-2">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading clients…
        </span>
        <div className="flex flex-col gap-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      </div>
    )
  }

  if (clients.isError && !clients.data) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <p className="text-sm">Couldn't load clients. {clients.error.message}</p>
        <Button variant="outline" onClick={() => void clients.refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  if (clients.data?.length === 0) {
    return <p className="text-sm text-muted-foreground">No clients yet.</p>
  }

  const first = clients.data?.[0]
  const firstKey = first ? `client:${first.id}` : ''

  return (
    <TreeContext.Provider
      value={{
        tabKey: activeKey ?? firstKey,
        isExpanded: (key) => expanded.has(key),
        toggle,
      }}
    >
      <ul
        ref={treeRef}
        role="tree"
        aria-label="Clients, projects and tasks"
        onKeyDown={onKeyDown}
        onFocus={(event) => {
          const item = (event.target as HTMLElement).closest<HTMLElement>(
            '[role="treeitem"]',
          )
          if (item?.dataset.nodeKey) setActiveKey(item.dataset.nodeKey)
        }}
      >
        <NodeList
          query={clients}
          level={1}
          parentKey=""
          noun="clients"
          render={(client) => <ClientItem key={client.id} client={client} />}
        />
      </ul>
    </TreeContext.Provider>
  )
}
