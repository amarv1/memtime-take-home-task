import { cn } from '@/lib/utils'

const KNOWN: Record<string, { label: string; className: string }> = {
  pending: {
    label: 'Pending',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  },
  'in-progress': {
    label: 'In progress',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
  },
  completed: {
    label: 'Completed',
    className:
      'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
}

/** A status pill. The text carries the meaning; colour is only a hint. */
export function StatusBadge({ status }: { status: string }) {
  const known = KNOWN[status]
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
        known?.className ?? 'bg-muted text-muted-foreground',
      )}
    >
      {known?.label ?? status}
    </span>
  )
}
