import { Pencil } from 'lucide-react'
import { Link } from 'react-router'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { TimeEntry } from './api'
import { formatDateTime, formatDuration } from './format'

/** The entries as rows: ID, Task ID, Comment, Start, End, Duration and Created At, with an Edit link. */
export function EntriesTable({ entries }: { entries: TimeEntry[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>ID</TableHead>
          <TableHead>Task ID</TableHead>
          <TableHead>Comment</TableHead>
          <TableHead>Start</TableHead>
          <TableHead>End</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Created At</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell className="tabular-nums">{entry.id}</TableCell>
            <TableCell className="tabular-nums">{entry.taskId}</TableCell>
            <TableCell className="max-w-xs break-words whitespace-normal">
              {entry.comment}
            </TableCell>
            <TableCell className="whitespace-nowrap">
              {formatDateTime(entry.start)}
            </TableCell>
            <TableCell className="whitespace-nowrap">
              {formatDateTime(entry.end)}
            </TableCell>
            <TableCell className="whitespace-nowrap tabular-nums">
              {formatDuration(entry.start, entry.end)}
            </TableCell>
            <TableCell className="whitespace-nowrap">
              {formatDateTime(entry.createdAt)}
            </TableCell>
            <TableCell>
              <Link
                to={`/tasks/${entry.taskId}/entries/${entry.id}/edit`}
                aria-label={`Edit entry ${entry.id}`}
                className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
              >
                <Pencil className="size-3.5" aria-hidden />
                Edit
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
