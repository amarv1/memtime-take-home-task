import { differenceInSeconds, format, isValid, parseISO } from 'date-fns'

const EMPTY = '—'

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
