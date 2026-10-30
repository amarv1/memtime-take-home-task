import { Loader2 } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { RATE_LIMITED_MESSAGE, isRateLimited, useCountdown } from '@/lib/rateLimit'
import { ClientItem } from './HierarchyNodes'
import { parseTaskId, useClients, useProject, useTask } from './hooks'
import { NodeList } from './NodeList'
import { TaskLinkNotice } from './TaskLinkNotice'
import {
  TreeContext,
  createTreeStore,
  type TreeApi,
  type TreeSnapshot,
  type TreeStore,
  type TreeTarget,
} from './treeContext'
import { useTreeKeyboard } from './useTreeKeyboard'

/** Subscribes the tree itself, which owns the store and so has no context yet. */
function useStoreValue<T>(store: TreeStore, select: (snapshot: TreeSnapshot) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getSnapshot()))
}

/**
 * Clients, their projects and their tasks. Each level loads when its parent is expanded.
 * The task in the URL (`/tasks/:taskId/entries`) is the selection; opening it reveals its path.
 */
export function HierarchyTree() {
  const clients = useClients()
  const secondsLeft = useCountdown(clients.error)
  const navigate = useNavigate()
  const { taskId: rawTaskId } = useParams()
  const taskId = parseTaskId(rawTaskId)
  const task = useTask(taskId ?? undefined)
  const project = useProject(task.data?.projectId)
  const [store] = useState(createTreeStore)
  // Collapsing or expanding changes the DOM the fallback below looks at.
  useStoreValue(store, (s) => s.expanded)
  const activeKey = useStoreValue(store, (s) => s.activeKey)
  // What the selection has already been revealed and scrolled to, so that it happens once
  // per selection and a collapsed client isn't forced open again.
  const revealedTaskId = useRef<number | null>(null)
  const shownKey = useRef<string | null>(null)
  const treeRef = useRef<HTMLUListElement>(null)
  // Latest values for the stable callbacks below.
  const navigateRef = useRef(navigate)
  useLayoutEffect(() => {
    navigateRef.current = navigate
  })

  const clientId = project.data?.clientId
  const projectId = task.data?.projectId
  const loadedTaskId = task.data?.id
  const target = useMemo<TreeTarget | null>(
    () =>
      clientId !== undefined && projectId !== undefined && loadedTaskId !== undefined
        ? { clientId, projectId, taskId: loadedTaskId }
        : null,
    [clientId, projectId, loadedTaskId],
  )
  const firstId = clients.data?.[0]?.id
  const firstKey = firstId === undefined ? '' : `client:${firstId}`

  // Rows read these through the store. Layout effects run before paint, so rows never show
  // the old selection, and a revealed path doesn't flash collapsed.
  useLayoutEffect(() => {
    if (taskId === null) {
      revealedTaskId.current = null
      shownKey.current = null
    }
    store.set({ selectedTaskId: taskId, firstKey, target })
    if (target && target.taskId !== revealedTaskId.current) {
      revealedTaskId.current = target.taskId
      const clientKey = `client:${target.clientId}`
      store.expand([clientKey, `${clientKey}/project:${target.projectId}`])
    }
  }, [store, taskId, firstKey, target])

  const api = useMemo<TreeApi>(
    () => ({
      store,
      toggle: store.toggle,
      selectTask: (id) => {
        if (id !== store.getSnapshot().selectedTaskId)
          void navigateRef.current(`/tasks/${id}/entries`)
      },
      onSelectedRow: (element, key) => {
        if (!element || key === shownKey.current) return
        // Make it the tab stop and bring it into view, but leave focus alone: moving it
        // on page load would hijack a screen reader. A click has already focused the row.
        shownKey.current = key
        store.set({ activeKey: key })
        element.scrollIntoView({ block: 'nearest' })
      },
    }),
    [store],
  )
  const onKeyDown = useTreeKeyboard(store.toggle)

  // If the item that was in the tab order is gone (its parent collapsed, or a
  // "Load more" row vanished), fall back to the first item so Tab still reaches the tree.
  // Runs after every render on purpose: the DOM can change without activeKey changing.
  useLayoutEffect(() => {
    const tree = treeRef.current
    if (
      activeKey !== null &&
      tree &&
      !tree.querySelector(`[data-node-key="${activeKey}"]`)
    ) {
      store.set({ activeKey: null })
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
        <p className="text-sm">
          {isRateLimited(clients.error)
            ? RATE_LIMITED_MESSAGE
            : `Couldn't load clients. ${clients.error.message}`}
        </p>
        <Button
          variant="outline"
          disabled={secondsLeft > 0}
          onClick={() => void clients.refetch()}
        >
          {secondsLeft > 0 ? `Try again in ${secondsLeft}s` : 'Try again'}
        </Button>
      </div>
    )
  }

  if (clients.data?.length === 0) {
    return <p className="text-sm text-muted-foreground">No clients yet.</p>
  }

  return (
    <TreeContext.Provider value={api}>
      {rawTaskId !== undefined && !target && (
        <TaskLinkNotice
          taskId={taskId}
          task={task}
          project={project}
          onClear={() => void navigate('/', { replace: true })}
        />
      )}
      <ul
        ref={treeRef}
        role="tree"
        aria-label="Clients, projects and tasks"
        onKeyDown={onKeyDown}
        onFocus={(event) => {
          const item = (event.target as HTMLElement).closest<HTMLElement>(
            '[role="treeitem"]',
          )
          if (item?.dataset.nodeKey) store.set({ activeKey: item.dataset.nodeKey })
        }}
      >
        <NodeList
          query={clients}
          level={1}
          parentKey=""
          noun="clients"
          targetId={target?.clientId}
          render={(client) => <ClientItem key={client.id} client={client} />}
        />
      </ul>
    </TreeContext.Provider>
  )
}
