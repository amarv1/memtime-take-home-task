import { ChevronRight } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { useIsFetching } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { indent, rowClass } from './rowStyle'
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
}

/** One client, project or task. Items with `children` can be expanded. */
export function TreeItem({
  level,
  nodeKey,
  name,
  details,
  childrenQueryKey,
  children,
}: Props) {
  const { tabKey, isExpanded, toggle } = useTree()
  const nameId = useId()
  const fetching = useIsFetching({ queryKey: childrenQueryKey ?? [nodeKey] })
  const expandable = children !== undefined
  const expanded = expandable && isExpanded(nodeKey)

  return (
    // `aria-selected` is optional in the APG tree pattern; nothing here is selectable.
    <li
      // eslint-disable-next-line jsx-a11y/role-has-required-aria-props
      role="treeitem"
      aria-level={level}
      aria-expanded={expandable ? expanded : undefined}
      aria-busy={expanded && childrenQueryKey && fetching > 0 ? true : undefined}
      aria-labelledby={nameId}
      tabIndex={nodeKey === tabKey ? 0 : -1}
      data-node-key={nodeKey}
      className="group/item outline-none"
    >
      {/* Keyboard users toggle through the tree's own key handler (Enter, Space, arrows). */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className={rowClass}
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
        {details}
      </div>
      {expanded && <ul role="group">{children}</ul>}
    </li>
  )
}
