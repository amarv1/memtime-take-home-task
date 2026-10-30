import { hashApiKey } from '../cache/hashApiKey.ts'
import type { Cache } from '../cache/memoryCache.ts'
import { CircuitOpenError } from '../memtime/circuitBreaker.ts'
import type { MemtimeClient, MemtimeResponse } from '../memtime/memtimeClient.ts'
import { MemtimeKeyRejectedError } from '../middleware/endSessionOnRevokedKey.ts'
import { HttpError } from '../middleware/errorHandler.ts'
import { RateLimitedError, throwIfRateLimited } from '../memtime/rateLimit.ts'
import { isWritingRequest } from '../requestId.ts'
import {
  addReloadPage,
  applyChanges,
  applyDeleted,
  applySaved,
  countCheckOffset,
  countMatches,
  emptySnapshot,
  isNotBefore,
  markStale,
  merge,
  startReload,
  type Snapshot,
} from './entrySnapshot.ts'

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
  /** Holds each key's snapshot; its TTL is how long an unused list is kept. */
  cache: Cache<Snapshot>
  /** How long a list is used before Memtime is asked what changed. */
  freshMs: number
  now?: () => number
}

// The largest page the API serves. A shorter page is the last one.
const PAGE_SIZE = 100

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

/** Whether a saved entry Memtime sent back can go into the list as it is. */
function isFullEntry(entry: object): entry is TimeEntry {
  const e = entry as Partial<Record<keyof TimeEntry, unknown>>
  return (
    typeof e.id === 'number' &&
    typeof e.taskId === 'number' &&
    typeof e.start === 'string' &&
    typeof e.end === 'string' &&
    typeof e.updatedAt === 'string' &&
    !Number.isNaN(Date.parse(e.updatedAt))
  )
}

const isRateLimit = (err: unknown) => err instanceof HttpError && err.status === 429

const cacheKey = hashApiKey

export interface NewEntry {
  taskId: number
  comment: string
  start: string
  end: string
}

interface PageQuery {
  sortBy: 'id' | 'updatedAt'
  order: 'asc' | 'desc'
  offset: number
  limit?: number
}

export type TimeEntryService = ReturnType<typeof createTimeEntryService>

/**
 * Keeps all of a key owner's time entries on the server (the API has no per-task filter).
 * The first read loads the whole list, resuming across rate-limit windows if it is long. After
 * that, saves made here update the list in place, and a stale list is brought up to date by
 * asking Memtime for entries changed since the newest `updatedAt` seen, plus a count check
 * that reveals deletes. Only a count mismatch reads the whole list again.
 */
export function createTimeEntryService({
  client,
  cache,
  freshMs,
  now = Date.now,
}: Options) {
  // One sync per key at a time; callers that arrive meanwhile wait for the same one.
  // `writing`: started while handling a save, so it may use the calls kept in reserve for writes.
  const inFlight = new Map<string, { promise: Promise<TimeEntry[]>; writing: boolean }>()
  // Changes to a key's snapshot run one at a time, so none is lost to another.
  const locks = new Map<string, Promise<void>>()

  const isStale = (snapshot: Snapshot) => now() - snapshot.checkedAt >= freshMs

  function update(
    key: string,
    change: (current: Snapshot) => Snapshot,
  ): Promise<Snapshot> {
    const run = async () => {
      const next = change((await cache.get(key)) ?? emptySnapshot)
      await cache.set(key, next)
      return next
    }
    const result = (locks.get(key) ?? Promise.resolve()).then(run)
    const done = result.then(
      () => undefined,
      () => undefined,
    )
    locks.set(key, done)
    void done.then(() => {
      if (locks.get(key) === done) locks.delete(key)
    })
    return result
  }

  async function fetchPage(
    apiKey: string,
    { sortBy, order, offset, limit = PAGE_SIZE }: PageQuery,
  ): Promise<TimeEntry[]> {
    const { status, headers, body } = await client.get(
      apiKey,
      '/time-entries',
      new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
        sortBy,
        order,
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

  /** First read: the newest page tells where changes start, and for a short list it is all of it. */
  async function start(apiKey: string, key: string, seen: Snapshot) {
    const newest = await fetchPage(apiKey, {
      sortBy: 'updatedAt',
      order: 'desc',
      offset: 0,
    })
    const since = newest[0]?.updatedAt ?? null
    await update(key, (current) => {
      // A save ran meanwhile, so this read may miss it: read again.
      if (current.version !== seen.version || current.entries || current.reload)
        return current
      if (newest.length < PAGE_SIZE)
        return {
          ...current,
          entries: merge([], newest),
          highWater: since,
          checkedAt: now(),
        }
      return startReload(current, since)
    })
  }

  /** Reads the next page of a full read, in id order, so pages hold still while entries change. */
  async function readPage(
    apiKey: string,
    key: string,
    seen: Snapshot & { reload: object },
  ) {
    const page = await fetchPage(apiKey, {
      sortBy: 'id',
      order: 'asc',
      offset: seen.reload.offset,
    })
    await update(key, (current) =>
      // A save ran meanwhile and may have moved Memtime's list: read this page again.
      current.version === seen.version
        ? addReloadPage(current, page, PAGE_SIZE, now())
        : current,
    )
  }

  /**
   * Entries changed since `highWater`, newest first. Stops at the first page that reaches an
   * entry older than `highWater`, or one at `highWater` that is held unchanged, so a run of
   * entries sharing that `updatedAt` is not read again each time.
   */
  async function readChanges(apiKey: string, held: Snapshot & { entries: TimeEntry[] }) {
    const { highWater } = held
    const heldAt = new Map(held.entries.map((e) => [e.id, e.updatedAt]))
    const isHeld = (e: TimeEntry) => heldAt.get(e.id) === e.updatedAt
    const reachesSeen = (e: TimeEntry) =>
      highWater !== null &&
      (!isNotBefore(e.updatedAt, highWater) ||
        (Date.parse(e.updatedAt) === Date.parse(highWater) && isHeld(e)))

    const changes: TimeEntry[] = []
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await fetchPage(apiKey, { sortBy: 'updatedAt', order: 'desc', offset })
      changes.push(
        ...page.filter((e) => isNotBefore(e.updatedAt, highWater) && !isHeld(e)),
      )
      if (page.some(reachesSeen) || page.length < PAGE_SIZE) return changes
    }
  }

  /**
   * Brings a stale list up to date. `countCheck` also asks whether anything was deleted, and
   * starts a full read if so; a save skips it to keep its calls for the write itself.
   */
  async function refresh(
    apiKey: string,
    key: string,
    seen: Snapshot & { entries: TimeEntry[] },
    countCheck: boolean,
  ) {
    const changes = await readChanges(apiKey, seen)
    let deleted = false
    let refused: HttpError | undefined
    if (countCheck) {
      const entries = merge(seen.entries, changes)
      try {
        const tail = await fetchPage(apiKey, {
          sortBy: 'id',
          order: 'asc',
          offset: countCheckOffset(entries),
          limit: 2,
        })
        deleted = !countMatches(entries, tail)
      } catch (err) {
        // The changes are worth keeping; the count is checked next time.
        if (!(err instanceof HttpError && err.status === 429)) throw err
        refused = err
      }
    }

    await update(key, (current) => {
      // A save ran meanwhile (a delete would come back with these changes): check again.
      if (current.version !== seen.version || !current.entries) return current
      let next = applyChanges(current, changes)
      if (countCheck && refused === undefined) next = { ...next, checkedAt: now() }
      if (deleted && !next.reload) next = startReload(next, next.highWater)
      return next
    })
    if (refused !== undefined) throw refused
  }

  async function sync(
    apiKey: string,
    key: string,
    writing: boolean,
  ): Promise<TimeEntry[]> {
    for (;;) {
      const seen = (await cache.get(key)) ?? emptySnapshot
      const { entries, reload } = seen
      try {
        if (!entries) {
          if (reload) await readPage(apiKey, key, { ...seen, reload })
          else await start(apiKey, key, seen)
          continue
        }
        // A save works with the list it has; checking for deletes and full reads are left to page views.
        if (writing) {
          if (isStale(seen)) await refresh(apiKey, key, { ...seen, entries }, false)
          return (await cache.get(key))?.entries ?? entries
        }
        if (reload) {
          await readPage(apiKey, key, { ...seen, reload })
          continue
        }
        if (!isStale(seen)) return entries
        await refresh(apiKey, key, { ...seen, entries }, true)
      } catch (err) {
        // Out of budget: the list we have is better than none, and the next read goes on from here.
        if (entries && isRateLimit(err)) return (await cache.get(key))?.entries ?? entries
        throw err
      }
    }
  }

  async function getAllEntries(apiKey: string): Promise<TimeEntry[]> {
    const key = cacheKey(apiKey)
    const cached = await cache.get(key)
    if (cached?.entries && !cached.reload && !isStale(cached)) return cached.entries

    const writing = isWritingRequest()
    const running = inFlight.get(key)
    if (running) {
      // A save need not wait for a page view's check or full read.
      if (writing && cached?.entries) return cached.entries
      if (running.writing || !writing) return running.promise
      // A save joined a first read a page view started, which stops at the reserve. If that
      // refused, read again as a save, which may use the reserve.
      return running.promise.catch((err: unknown) => {
        if (err instanceof RateLimitedError) return getAllEntries(apiKey)
        throw err
      })
    }

    const promise: Promise<TimeEntry[]> = sync(apiKey, key, writing).finally(() => {
      if (inFlight.get(key)?.promise === promise) inFlight.delete(key)
    })
    inFlight.set(key, { promise, writing })
    return promise
  }

  /**
   * Runs a write call. If its outcome is unknown (an error other than a rejected key, an open
   * circuit or a refusal by our own rate-limit check, which sent nothing, or a 5xx), Memtime may
   * still have applied it, so the next read checks Memtime for changes and deletes.
   */
  async function write(
    apiKey: string,
    call: () => Promise<MemtimeResponse>,
  ): Promise<MemtimeResponse> {
    let response: MemtimeResponse
    try {
      response = await call()
    } catch (err) {
      if (!(
        err instanceof MemtimeKeyRejectedError ||
        err instanceof CircuitOpenError ||
        err instanceof RateLimitedError
      ))
        await update(cacheKey(apiKey), markStale)
      throw err
    }
    if (response.status >= 500) await update(cacheKey(apiKey), markStale)
    return response
  }

  async function saved(
    apiKey: string,
    { status, headers, body }: MemtimeResponse,
    notFound: { message: string; goneId?: number },
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
    if (status === 404) {
      const { goneId } = notFound
      if (goneId !== undefined)
        await update(cacheKey(apiKey), (s) => applyDeleted(s, goneId))
      throw new HttpError(404, notFound.message)
    }
    if (status < 200 || status >= 300)
      throw new HttpError(502, 'Memtime could not save the time entry.')

    // The change is made upstream from here on, so the list changes whatever the body says.
    let entry: unknown
    try {
      entry = JSON.parse(body)
    } catch {
      // Handled below.
    }
    if (typeof entry === 'object' && entry !== null && isFullEntry(entry)) {
      const savedEntry = entry
      await update(cacheKey(apiKey), (s) => applySaved(s, savedEntry))
      return savedEntry
    }
    await update(cacheKey(apiKey), markStale)
    if (typeof entry === 'object' && entry !== null && 'id' in entry)
      return entry as TimeEntry
    throw new HttpError(502, 'Memtime sent an unexpected answer.')
  }

  return {
    getAllEntries,

    /** Creates an entry for the key's owner and adds it to the list. */
    async createEntry(apiKey: string, entry: NewEntry): Promise<TimeEntry> {
      const response = await write(apiKey, () =>
        client.post(apiKey, '/time-entries', entry, '/api/tasks/:taskId/entries'),
      )
      return saved(apiKey, response, { message: 'Task not found' })
    },

    /** Replaces an entry of the key's owner and in the list; drops it from the list if Memtime no longer has it. */
    async updateEntry(apiKey: string, id: number, entry: NewEntry): Promise<TimeEntry> {
      const response = await write(apiKey, () =>
        client.put(
          apiKey,
          `/time-entries/${id}`,
          entry,
          '/api/tasks/:taskId/entries/:entryId',
        ),
      )
      return saved(apiKey, response, { message: 'Time entry not found', goneId: id })
    },

    /** Deletes an entry of the key's owner and drops it from the list (also when Memtime no longer had it). */
    async deleteEntry(apiKey: string, id: number): Promise<void> {
      const { status, headers } = await write(apiKey, () =>
        client.delete(
          apiKey,
          `/time-entries/${id}`,
          '/api/tasks/:taskId/entries/:entryId',
        ),
      )

      throwIfRateLimited(status, headers)
      if (status === 404) {
        await update(cacheKey(apiKey), (s) => applyDeleted(s, id))
        throw new HttpError(404, 'Time entry not found')
      }
      if (status < 200 || status >= 300)
        throw new HttpError(502, 'Memtime could not delete the time entry.')

      await update(cacheKey(apiKey), (s) => applyDeleted(s, id))
    },
  }
}
