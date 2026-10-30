import type { TimeEntry } from '../../src/timeEntries/timeEntryService.ts'

/** A time entry with fixed dates; `start` is minutes after a base time so order is easy to set. */
export function buildEntry(
  id: number,
  taskId: number,
  overrides: Partial<TimeEntry> = {},
): TimeEntry {
  return {
    id,
    taskId,
    userId: 1,
    comment: `Entry ${id}`,
    start: new Date(Date.UTC(2025, 0, 1, 9, id)).toISOString(),
    end: new Date(Date.UTC(2025, 0, 1, 10, id)).toISOString(),
    createdAt: '2025-01-01T08:00:00.000Z',
    updatedAt: '2025-01-01T08:00:00.000Z',
    ...overrides,
  }
}

/** Slices like the real API: a bare array. */
export function page(entries: TimeEntry[], url: URL) {
  const limit = Number(url.searchParams.get('limit') ?? 10)
  const offset = Number(url.searchParams.get('offset') ?? 0)
  return entries.slice(offset, offset + limit)
}
