import { createHash } from 'node:crypto'
import type { Cache } from '../cache/memoryCache.ts'
import type { MemtimeClient } from '../memtime/memtimeClient.ts'
import { HttpError } from '../middleware/errorHandler.ts'

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

interface Options {
  client: MemtimeClient
  cache: Cache<TimeEntry[]>
}

// The largest page the API serves. A shorter page is the last one.
const PAGE_SIZE = 100

// Entries belong to the key's owner, so the key (hashed, never stored raw) is the cache key.
const cacheKey = (apiKey: string) => createHash('sha256').update(apiKey).digest('hex')

export type TimeEntryService = ReturnType<typeof createTimeEntryService>

/** Loads all of a key owner's time entries (the API has no per-task filter) and caches them. */
export function createTimeEntryService({ client, cache }: Options) {
  // One load per key at a time; callers that arrive meanwhile wait for the same one.
  const inFlight = new Map<string, Promise<TimeEntry[]>>()

  async function fetchPage(apiKey: string, offset: number): Promise<TimeEntry[]> {
    const { status, headers, body } = await client.get(
      apiKey,
      '/time-entries',
      new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      }).toString(),
      '/api/tasks/:taskId/entries',
    )

    if (status === 429) {
      const retryAfter = headers.get('retry-after')
      throw new HttpError(
        429,
        'Memtime is receiving too many requests. Please try again in a minute.',
        retryAfter === null ? undefined : { 'Retry-After': retryAfter },
      )
    }
    if (status < 200 || status >= 300)
      throw new HttpError(502, 'Memtime could not return the time entries.')

    try {
      const page: unknown = JSON.parse(body)
      if (Array.isArray(page)) return page as TimeEntry[]
    } catch {
      // Falls through to the error below.
    }
    throw new HttpError(502, 'Memtime sent an unexpected answer.')
  }

  async function load(apiKey: string): Promise<TimeEntry[]> {
    const entries: TimeEntry[] = []
    for (;;) {
      const page = await fetchPage(apiKey, entries.length)
      entries.push(...page)
      if (page.length < PAGE_SIZE) return entries
    }
  }

  return {
    async getAllEntries(apiKey: string): Promise<TimeEntry[]> {
      const key = cacheKey(apiKey)
      const cached = await cache.get(key)
      if (cached) return cached

      const running = inFlight.get(key)
      if (running) return running

      // Only a complete list is cached; any failure leaves the cache untouched.
      const promise = load(apiKey)
        .then(async (entries) => {
          await cache.set(key, entries)
          return entries
        })
        .finally(() => inFlight.delete(key))
      inFlight.set(key, promise)
      return promise
    },

    /** For create, update and delete of entries to call, so the next read loads fresh data. */
    async invalidate(apiKey: string): Promise<void> {
      await cache.delete(cacheKey(apiKey))
    },
  }
}
