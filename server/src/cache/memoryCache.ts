interface Options {
  ttlMs: number
  /** Most items held; the oldest inserted is dropped beyond it. */
  maxEntries: number
  now?: () => number
}

export interface Cache<T> {
  get(key: string): Promise<T | undefined>
  set(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
}

/**
 * A very basic in-memory cache: a TTL per item and a size cap, no timers and no LRU.
 * Expired items are removed when read. The methods are async so Redis can replace it
 * later without changing callers.
 */
export function createMemoryCache<T>({
  ttlMs,
  maxEntries,
  now = Date.now,
}: Options): Cache<T> {
  const items = new Map<string, { value: T; expiresAt: number }>()

  return {
    get(key) {
      const item = items.get(key)
      if (item && item.expiresAt <= now()) {
        items.delete(key)
        return Promise.resolve(undefined)
      }
      return Promise.resolve(item?.value)
    },

    set(key, value) {
      // Delete first so a rewritten key counts as the newest.
      items.delete(key)
      items.set(key, { value, expiresAt: now() + ttlMs })
      while (items.size > maxEntries) {
        const oldest = items.keys().next().value
        if (oldest === undefined) break
        items.delete(oldest)
      }
      return Promise.resolve()
    },

    delete(key) {
      items.delete(key)
      return Promise.resolve()
    },
  }
}
