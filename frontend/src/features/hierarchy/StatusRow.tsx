import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useSecondsUntil } from '@/lib/rateLimit'
import { cn } from '@/lib/utils'
import { indent, rowClass } from './rowStyle'
import { useIsTabStop, useTreeSelector } from './treeContext'

interface Props {
  level: number
  nodeKey: string
  /** Makes the row an action (click, Enter or Space). */
  onActivate?: () => void
  disabled?: boolean
  children: ReactNode
}

/**
 * A leaf treeitem for loading, empty, error and "load more" states, so arrow keys
 * can reach it like any other item.
 */
export function StatusRow({ level, nodeKey, onActivate, disabled, children }: Props) {
  const tabStop = useIsTabStop(nodeKey)
  const actionable = onActivate !== undefined

  return (
    // The keyboard handler lives on the tree root, which calls `click()` for Enter and Space.
    // `aria-selected` is optional in the APG tree pattern; only tasks are selectable.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <li
      // eslint-disable-next-line jsx-a11y/role-has-required-aria-props
      role="treeitem"
      aria-level={level}
      aria-disabled={disabled ? true : undefined}
      tabIndex={tabStop ? 0 : -1}
      data-node-key={nodeKey}
      className="group/item outline-none"
      onClick={actionable && !disabled ? onActivate : undefined}
    >
      <div
        className={cn(
          rowClass,
          'text-muted-foreground',
          !actionable && 'cursor-default hover:bg-transparent',
          disabled && 'cursor-default',
        )}
        style={indent(level)}
      >
        <span className="size-4 shrink-0" aria-hidden />
        {children}
      </div>
    </li>
  )
}

/** Seconds until the tree's pause ends. Its own component, so only it re-renders each second. */
export function PauseSeconds() {
  return useSecondsUntil(useTreeSelector((s) => s.pausedUntil))
}

export function Spinner() {
  return <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
}
