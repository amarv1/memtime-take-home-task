import { Loader2 } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { RATE_LIMITED_MESSAGE, isRateLimited, useCountdown } from '@/lib/rateLimit'
import { ClientItem } from './HierarchyNodes'
import { parseTaskId, useClients, useProject, useTask } from './hooks'
import { NodeList } from './NodeList'
import { TaskLinkNotice } from './TaskLinkNotice'
import { TreeContext, type TreeTarget } from './treeContext'
import { useTreeKeyboard } from './useTreeKeyboard'

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
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [activeKey, setActiveKey] = useState<string | null>(null)
  // What the selection has already been revealed and scrolled to, so that it happens once
  // per selection and a collapsed client isn't forced open again.
  const [revealedTaskId, setRevealedTaskId] = useState<number | null>(null)
  const [shownKey, setShownKey] = useState<string | null>(null)
  const treeRef = useRef<HTMLUListElement>(null)

  const target: TreeTarget | null =
    task.data && project.data
      ? {
          clientId: project.data.clientId,
          projectId: task.data.projectId,
          taskId: task.data.id,
        }
      : null

  // Adjusting state while rendering (not in an effect) keeps the tree from flashing collapsed.
  if (taskId === null && (revealedTaskId !== null || shownKey !== null)) {
    setRevealedTaskId(null)
    setShownKey(null)
  }
  if (target && target.taskId !== revealedTaskId) {
    const clientKey = `client:${target.clientId}`
    setRevealedTaskId(target.taskId)
    setExpanded(
      (current) =>
        new Set([...current, clientKey, `${clientKey}/project:${target.projectId}`]),
    )
  }

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

  const first = clients.data?.[0]
  const firstKey = first ? `client:${first.id}` : ''

  return (
    <TreeContext.Provider
      value={{
        tabKey: activeKey ?? firstKey,
        isExpanded: (key) => expanded.has(key),
        toggle,
        selectedTaskId: taskId,
        selectTask: (id) => {
          if (id !== taskId) void navigate(`/tasks/${id}/entries`)
        },
        target,
        onSelectedRow: (element, key) => {
          if (!element || key === shownKey) return
          // Make it the tab stop and bring it into view, but leave focus alone: moving it
          // on page load would hijack a screen reader. A click has already focused the row.
          setShownKey(key)
          setActiveKey(key)
          element.scrollIntoView({ block: 'nearest' })
        },
      }}
    >
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
          if (item?.dataset.nodeKey) setActiveKey(item.dataset.nodeKey)
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
