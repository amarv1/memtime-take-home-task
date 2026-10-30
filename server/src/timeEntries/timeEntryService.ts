import { createHash } from 'node:crypto'
import type { Cache } from '../cache/memoryCache.ts'
import type { MemtimeClient, MemtimeResponse } from '../memtime/memtimeClient.ts'
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

/** An entry as the browser may see it: Memtime puts the API key in `userId`. */
export type PublicTimeEntry = Omit<TimeEntry, 'userId'>

export function toPublicEntry({ userId: _userId, ...entry }: TimeEntry): PublicTimeEntry {
  return entry
}

interface Options {
  client: MemtimeClient
  cache: Cache<TimeEntry[]>
}

// The largest page the API serves. A shorter page is the last one.
const PAGE_SIZE = 100

function throwIfRateLimited(status: number, headers: Headers) {
  if (status !== 429) return
  const retryAfter = headers.get('retry-after')
  throw new HttpError(
    429,
    'Memtime is receiving too many requests. Please try again in a minute.',
    retryAfter === null ? undefined : { 'Retry-After': retryAfter },
  )
}

// Entries belong to the key's owner, so the key (hashed, never stored raw) is the cache key.
const cacheKey = (apiKey: string) => createHash('sha256').update(apiKey).digest('hex')

export interface NewEntry {
  taskId: number
  comment: string
  start: string
  end: string
}

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

    throwIfRateLimited(status, headers)
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

  async function invalidate(apiKey: string): Promise<void> {
    await cache.delete(cacheKey(apiKey))
  }

  async function saved(
    apiKey: string,
    { status, headers, body }: MemtimeResponse,
    notFound: string,
  ): Promise<TimeEntry> {
    throwIfRateLimited(status, headers)
    if (status === 400)
      throw new HttpError(400, 'Memtime did not accept this time entry.')
    if (status === 404) throw new HttpError(404, notFound)
    if (status < 200 || status >= 300)
      throw new HttpError(502, 'Memtime could not save the time entry.')

    // The change is made upstream from here on, so the cache is stale whatever the body says.
    await invalidate(apiKey)
    try {
      const entry: unknown = JSON.parse(body)
      if (typeof entry === 'object' && entry !== null && 'id' in entry)
        return entry as TimeEntry
    } catch {
      // Falls through to the error below.
    }
    throw new HttpError(502, 'Memtime sent an unexpected answer.')
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

    /** Creates an entry for the key's owner, then drops the cached list so the next read has it. */
    async createEntry(apiKey: string, entry: NewEntry): Promise<TimeEntry> {
      const response = await client.post(
        apiKey,
        '/time-entries',
        entry,
        '/api/tasks/:taskId/entries',
      )
      return saved(apiKey, response, 'Task not found')
    },

    /** Replaces an entry of the key's owner, then drops the cached list. */
    async updateEntry(apiKey: string, id: number, entry: NewEntry): Promise<TimeEntry> {
      const response = await client.put(
        apiKey,
        `/time-entries/${id}`,
        entry,
        '/api/tasks/:taskId/entries/:entryId',
      )
      return saved(apiKey, response, 'Time entry not found')
    },

    /** Deletes an entry of the key's owner, then drops the cached list. */
    async deleteEntry(apiKey: string, id: number): Promise<void> {
      const { status, headers } = await client.delete(
        apiKey,
        `/time-entries/${id}`,
        '/api/tasks/:taskId/entries/:entryId',
      )

      throwIfRateLimited(status, headers)
      if (status === 404) throw new HttpError(404, 'Time entry not found')
      if (status < 200 || status >= 300)
        throw new HttpError(502, 'Memtime could not delete the time entry.')

      await invalidate(apiKey)
    },

    /** For create, update and delete of entries to call, so the next read loads fresh data. */
    invalidate,
  }
}
