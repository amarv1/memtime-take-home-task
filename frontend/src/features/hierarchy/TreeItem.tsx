import { ChevronRight } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { useIsFetching } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { ancestorRowClass, indent, rowClass, selectedRowClass } from './rowStyle'
import { useTree } from './treeContext'

interface Props {
  level: number
  nodeKey: string
  name: string
  /** Shown after the name: badge, id. */
  details?: ReactNode
  /** Cache key of the children, to mark the item busy while they load. */
  childrenQueryKey?: readonly unknown[]
  /** Children are only rendered while expanded, so that is also when they are fetched. */
  children?: ReactNode
  /** Only for selectable items (tasks). Sets `aria-selected`. */
  selected?: boolean
  /** Holds the selected task; marked so it can be found again while collapsed. */
  ancestor?: boolean
  onSelect?: () => void
}

/** One client, project or task. Items with `children` can be expanded. */
export function TreeItem({
  level,
  nodeKey,
  name,
  details,
  childrenQueryKey,
  children,
  selected,
  ancestor,
  onSelect,
}: Props) {
  const { tabKey, isExpanded, toggle, onSelectedRow } = useTree()
  const nameId = useId()
  const fetching = useIsFetching({ queryKey: childrenQueryKey ?? [nodeKey] })
  const expandable = children !== undefined
  const expanded = expandable && isExpanded(nodeKey)

  return (
    // Enter and Space reach `onSelect` as a click: the tree's key handler calls `click()`.
    // `aria-selected` is set on tasks only; clients and projects use `aria-expanded`.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <li
      ref={selected ? (element) => onSelectedRow(element, nodeKey) : undefined}
      role="treeitem"
      aria-level={level}
      aria-expanded={expandable ? expanded : undefined}
      aria-selected={selected}
      aria-current={ancestor ? true : undefined}
      aria-busy={expanded && childrenQueryKey && fetching > 0 ? true : undefined}
      aria-labelledby={nameId}
      tabIndex={nodeKey === tabKey ? 0 : -1}
      data-node-key={nodeKey}
      className="group/item outline-none"
      onClick={onSelect}
    >
      {/* Keyboard users toggle through the tree's own key handler (Enter, Space, arrows). */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className={cn(
          rowClass,
          ancestor && ancestorRowClass,
          selected && selectedRowClass,
        )}
        style={indent(level)}
        onClick={expandable ? () => toggle(nodeKey) : undefined}
      >
        {expandable ? (
          <ChevronRight
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              expanded && 'rotate-90',
            )}
            aria-hidden
          />
        ) : (
          <span className="size-4 shrink-0" aria-hidden />
        )}
        <span id={nameId} className="truncate font-medium">
          {name}
        </span>
        {ancestor && (
          <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden />
        )}
        {details}
      </div>
      {expanded && <ul role="group">{children}</ul>}
    </li>
  )
}
