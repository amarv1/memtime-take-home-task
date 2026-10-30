import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Warning } from '@/lib/api'
import { formatDateTime } from './format'

interface Props {
  warnings: Warning[]
  disabled: boolean
  onConfirm: () => void
  onKeepEditing: () => void
}

function OverlapList({ entries }: { entries: NonNullable<Warning['entries']> }) {
  return (
    <ul className="mt-1 list-disc pl-5">
      {entries.map((entry) => (
        <li key={entry.id}>
          Task #{entry.taskId}, {formatDateTime(entry.start)} –{' '}
          {formatDateTime(entry.end)}
        </li>
      ))}
    </ul>
  )
}

/** Things the user may still want to fix; saving is allowed once they confirm. */
export function WarningPanel({ warnings, disabled, onConfirm, onKeepEditing }: Props) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
    >
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <ul className="flex flex-col gap-2">
          {warnings.map((warning) => (
            <li key={warning.code}>
              {warning.message}
              {warning.entries && <OverlapList entries={warning.entries} />}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex gap-3">
        <Button type="button" size="sm" disabled={disabled} onClick={onConfirm}>
          Save anyway
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onKeepEditing}>
          Keep editing
        </Button>
      </div>
    </div>
  )
}
