import { hashApiKey } from '../cache/hashApiKey.ts'
import type { Cache } from '../cache/memoryCache.ts'
import type { MemtimeClient, MemtimeResponse } from '../memtime/memtimeClient.ts'

type Kind = 'client' | 'project' | 'task'

/** An item exactly as Memtime sent it. */
export type HierarchyItem = Record<string, unknown>

interface Options {
  client: MemtimeClient
  /** Holds list page bodies as text, keyed by key hash, path and query. */
  pages: Cache<string>
  /** Holds every client, project and task seen in a page or a lookup. */
  items: Cache<HierarchyItem>
}

export type HierarchyCache = ReturnType<typeof createHierarchyCache>

function isItem(value: unknown): value is HierarchyItem & { id: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { id?: unknown }).id === 'number'
  )
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

/** What the items in a list answer are, going by the upstream path. */
function kindOf(upstreamPath: string): Kind | undefined {
  if (upstreamPath === '/clients') return 'client'
  if (/^\/clients\/\d+\/projects$/.test(upstreamPath)) return 'project'
  if (/^\/projects\/\d+\/tasks$/.test(upstreamPath)) return 'task'
  return undefined
}

/** Sorts the params so the same query in another order shares one entry. */
function normalize(search: string): string {
  const params = new URLSearchParams(search)
  params.sort()
  return params.toString()
}

/**
 * Remembers the client, project and task lists per API key, and every item seen in them, so
 * reloads, other tabs and task lookups need no Memtime call. Only successful answers are kept.
 * Calls for the same thing that are already running share one request.
 */
export function createHierarchyCache({ client, pages, items }: Options) {
  const listsRunning = new Map<string, Promise<MemtimeResponse>>()
  const itemsRunning = new Map<string, Promise<MemtimeResponse>>()

  async function index(hash: string, kind: Kind, item: unknown) {
    if (isItem(item)) await items.set(`${hash}:${kind}:${item.id}`, item)
  }

  /** Runs `load` once for all callers asking for the same key at the same time. */
  function share(
    running: Map<string, Promise<MemtimeResponse>>,
    key: string,
    load: () => Promise<MemtimeResponse>,
  ): Promise<MemtimeResponse> {
    const existing = running.get(key)
    if (existing) return existing
    const promise = load().finally(() => {
      if (running.get(key) === promise) running.delete(key)
    })
    running.set(key, promise)
    return promise
  }

  return {
    /** A list page. `search` is the already-filtered query; the answer is cached when it is a JSON array. */
    getList(
      apiKey: string,
      upstreamPath: string,
      search: string,
      label: string,
    ): Promise<MemtimeResponse> {
      const hash = hashApiKey(apiKey)
      const key = `${hash}:${upstreamPath}?${normalize(search)}`

      return share(listsRunning, key, async () => {
        const cached = await pages.get(key)
        if (cached !== undefined) {
          return { status: 200, headers: new Headers(), body: cached }
        }

        const response = await client.get(apiKey, upstreamPath, search, label)
        const parsed = isSuccess(response.status) ? parseJson(response.body) : undefined
        if (Array.isArray(parsed)) {
          await pages.set(key, response.body)
          const kind = kindOf(upstreamPath)
          if (kind) for (const item of parsed) await index(hash, kind, item)
        }
        return response
      })
    },

    /** A project or task by id, from what has been seen, or else from Memtime. */
    getItem(
      apiKey: string,
      kind: 'project' | 'task',
      id: string,
      label: string,
    ): Promise<MemtimeResponse> {
      const hash = hashApiKey(apiKey)
      const key = `${hash}:${kind}:${id}`

      return share(itemsRunning, key, async () => {
        const cached = await items.get(key)
        if (cached !== undefined) {
          return { status: 200, headers: new Headers(), body: JSON.stringify(cached) }
        }

        const response = await client.get(apiKey, `/${kind}s/${id}`, '', label)
        if (isSuccess(response.status)) await index(hash, kind, parseJson(response.body))
        return response
      })
    },

    /** A task already seen, or undefined. Makes no Memtime call. */
    peekTask(apiKey: string, taskId: number): Promise<HierarchyItem | undefined> {
      return items.get(`${hashApiKey(apiKey)}:task:${taskId}`)
    },
  }
}
