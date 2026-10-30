import { hashApiKey } from '../cache/hashApiKey.ts'
import type { Cache } from '../cache/memoryCache.ts'
import type { MemtimeClient, MemtimeResponse } from '../memtime/memtimeClient.ts'
import { MemtimeKeyRejectedError } from '../middleware/endSessionOnRevokedKey.ts'
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

export function throwIfRateLimited(status: number, headers: Headers) {
  if (status !== 429) return
  const retryAfter = headers.get('retry-after')
  throw new HttpError(
    429,
    'Memtime is receiving too many requests. Please try again in a minute.',
    retryAfter === null ? undefined : { 'Retry-After': retryAfter },
  )
}

/** The `error` text of a Memtime error body (`{ "error": "..." }`), if it has one. */
function upstreamReason(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      const { error } = parsed
      if (typeof error === 'string' && error.trim() !== '') return error.trim()
    }
  } catch {
    // Not JSON: no reason to show.
  }
  return undefined
}

const cacheKey = hashApiKey

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
  // Bumped on every write, so a load that started before it is not cached. One number per key that ever wrote.
  const generations = new Map<string, number>()

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
    const key = cacheKey(apiKey)
    generations.set(key, (generations.get(key) ?? 0) + 1)
    // Later callers start a fresh load instead of joining one that began before the write.
    inFlight.delete(key)
    await cache.delete(key)
  }

  /**
   * Runs a write call. If its outcome is unknown (an error other than a rejected key, or a 5xx),
   * Memtime may still have applied it, so the cached list is dropped.
   */
  async function write(
    apiKey: string,
    call: () => Promise<MemtimeResponse>,
  ): Promise<MemtimeResponse> {
    let response: MemtimeResponse
    try {
      response = await call()
    } catch (err) {
      if (!(err instanceof MemtimeKeyRejectedError)) await invalidate(apiKey)
      throw err
    }
    if (response.status >= 500) await invalidate(apiKey)
    return response
  }

  async function saved(
    apiKey: string,
    { status, headers, body }: MemtimeResponse,
    notFound: string,
  ): Promise<TimeEntry> {
    throwIfRateLimited(status, headers)
    if (status === 400) {
      const reason = upstreamReason(body)
      throw new HttpError(
        400,
        reason
          ? `Memtime did not accept this time entry: ${reason}`
          : 'Memtime did not accept this time entry.',
      )
    }
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
      // A write meanwhile makes the list stale: its waiting callers still get it, but it is not cached.
      const generation = generations.get(key) ?? 0
      const promise: Promise<TimeEntry[]> = load(apiKey)
        .then(async (entries) => {
          if ((generations.get(key) ?? 0) === generation) await cache.set(key, entries)
          return entries
        })
        .finally(() => {
          if (inFlight.get(key) === promise) inFlight.delete(key)
        })
      inFlight.set(key, promise)
      return promise
    },

    /** Creates an entry for the key's owner, then drops the cached list (also when the outcome is unknown). */
    async createEntry(apiKey: string, entry: NewEntry): Promise<TimeEntry> {
      const response = await write(apiKey, () =>
        client.post(apiKey, '/time-entries', entry, '/api/tasks/:taskId/entries'),
      )
      return saved(apiKey, response, 'Task not found')
    },

    /** Replaces an entry of the key's owner, then drops the cached list (also when the outcome is unknown). */
    async updateEntry(apiKey: string, id: number, entry: NewEntry): Promise<TimeEntry> {
      const response = await write(apiKey, () =>
        client.put(
          apiKey,
          `/time-entries/${id}`,
          entry,
          '/api/tasks/:taskId/entries/:entryId',
        ),
      )
      return saved(apiKey, response, 'Time entry not found')
    },

    /** Deletes an entry of the key's owner, then drops the cached list (also when the outcome is unknown). */
    async deleteEntry(apiKey: string, id: number): Promise<void> {
      const { status, headers } = await write(apiKey, () =>
        client.delete(
          apiKey,
          `/time-entries/${id}`,
          '/api/tasks/:taskId/entries/:entryId',
        ),
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
