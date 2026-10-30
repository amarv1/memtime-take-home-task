import { apiFetch } from '@/lib/api'

export interface TimeEntry {
  id: number
  taskId: number
  userId: number
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
}

export function createTaskEntry(taskId: number, entry: NewEntry): Promise<TimeEntry> {
  return apiFetch<TimeEntry>(`/api/tasks/${encodeURIComponent(String(taskId))}/entries`, {
    method: 'POST',
    body: JSON.stringify(entry),
  })
}
