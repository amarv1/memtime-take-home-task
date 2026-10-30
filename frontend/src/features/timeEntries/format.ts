import { differenceInSeconds, format, isValid, parseISO } from 'date-fns'
import type { TimeEntry } from './api'

const EMPTY = '—'

/** Longest comment a toast shows; a longer one is cut with an ellipsis. */
const TOAST_COMMENT_LENGTH = 80

/** "Jan 1, 2025 9:00 AM" in the viewer's time zone. */
export function formatDateTime(iso: string): string {
  const date = parseISO(iso)
  return isValid(date) ? format(date, 'PP p') : EMPTY
}

/** "1h 5m", "12m" or "30s"; seconds only show when under an hour. */
export function formatDuration(startIso: string, endIso: string): string {
  const start = parseISO(startIso)
  const end = parseISO(endIso)
  if (!isValid(start) || !isValid(end)) return EMPTY

  const total = Math.max(0, differenceInSeconds(end, start))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const parts = [
    hours && `${hours}h`,
    minutes && `${minutes}m`,
    hours === 0 && seconds && `${seconds}s`,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : '0s'
}

/** "Fix the header · Jan 1, 2025 9:00 AM – Jan 1, 2025 10:05 AM · 1h 5m", for a toast. */
export function describeEntry(
  entry: Pick<TimeEntry, 'comment' | 'start' | 'end'>,
): string {
  const comment =
    entry.comment.length > TOAST_COMMENT_LENGTH
      ? `${entry.comment.slice(0, TOAST_COMMENT_LENGTH - 1).trimEnd()}…`
      : entry.comment
  const range = `${formatDateTime(entry.start)} – ${formatDateTime(entry.end)}`
  return `${comment} · ${range} · ${formatDuration(entry.start, entry.end)}`
}

/** The value a `datetime-local` input takes: local time, no zone, to the minute. */
export function toDateTimeInput(date: Date): string {
  return format(date, "yyyy-MM-dd'T'HH:mm")
}
