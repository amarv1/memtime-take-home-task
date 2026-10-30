import { http, HttpResponse } from 'msw'
import type { TimeEntry } from '@/features/timeEntries/api'
import { server } from './server'

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
    start: '2025-01-01T09:00:00.000Z',
    end: '2025-01-01T10:05:00.000Z',
    createdAt: '2025-01-01T08:00:00.000Z',
    updatedAt: '2025-01-01T08:00:00.000Z',
    ...overrides,
  }
}

/**
 * Mocks `/api/tasks/:taskId/entries` like the server: slices `entries` by limit and
 * offset and adds the total. `requests` collects `pathname + search` of every call.
 */
export function mockEntries(entries: TimeEntry[]) {
  const requests: string[] = []
  server.use(
    http.get('/api/tasks/:taskId/entries', ({ request }) => {
      const url = new URL(request.url)
      requests.push(url.pathname + url.search)
      const limit = Number(url.searchParams.get('limit') ?? 25)
      const offset = Number(url.searchParams.get('offset') ?? 0)
      return HttpResponse.json({
        items: entries.slice(offset, offset + limit),
        total: entries.length,
        limit,
        offset,
      })
    }),
  )
  return { requests }
}
