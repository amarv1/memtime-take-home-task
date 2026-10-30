import { apiFetch } from '@/lib/api'

export interface TimeEntry {
  id: number
  taskId: number
  comment: string
  start: string
  end: string
  createdAt: string
  updatedAt: string
}

export interface TimeEntryPage {
  items: TimeEntry[]
  /** All of the task's entries, not just this page. */
  total: number
  limit: number
  offset: number
}

export const ENTRIES_PAGE_SIZE = 25

/** One page of a task's entries, newest first. */
export function listTaskEntries(
  taskId: number,
  limit: number,
  offset: number,
): Promise<TimeEntryPage> {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  return apiFetch<TimeEntryPage>(
    `/api/tasks/${encodeURIComponent(String(taskId))}/entries?${query}`,
  )
}

export interface NewEntry {
  comment: string
  /** ISO 8601 */
  start: string
  /** ISO 8601 */
  end: string
  /** Codes of the warnings the user has confirmed (see the 409 answer). */
  acceptedWarnings?: string[]
}

export function createTaskEntry(taskId: number, entry: NewEntry): Promise<TimeEntry> {
  return apiFetch<TimeEntry>(`/api/tasks/${encodeURIComponent(String(taskId))}/entries`, {
    method: 'POST',
    body: JSON.stringify(entry),
  })
}

export function getTaskEntry(taskId: number, entryId: number): Promise<TimeEntry> {
  return apiFetch<TimeEntry>(`/api/tasks/${taskId}/entries/${entryId}`)
}

export function updateTaskEntry(
  taskId: number,
  entryId: number,
  entry: NewEntry,
): Promise<TimeEntry> {
  return apiFetch<TimeEntry>(`/api/tasks/${taskId}/entries/${entryId}`, {
    method: 'PUT',
    body: JSON.stringify(entry),
  })
}

// Same rule as the server. Unlike task ids, entry ids can be 0.
const ENTRY_ID_PATTERN = /^(0|[1-9]\d{0,9})$/

/** The entry id from the URL, or null when it is missing or not a valid id. */
export function parseEntryId(raw: string | undefined): number | null {
  return raw !== undefined && ENTRY_ID_PATTERN.test(raw) ? Number(raw) : null
}

export function deleteTaskEntry(taskId: number, entryId: number): Promise<void> {
  return apiFetch<void>(`/api/tasks/${taskId}/entries/${entryId}`, { method: 'DELETE' })
}
