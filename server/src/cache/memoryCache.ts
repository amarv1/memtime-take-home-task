interface Options<T> {
  ttlMs: number
  /** Most items held; the oldest inserted is dropped beyond it. */
  maxEntries?: number
  /** Most total size held, as measured by `sizeOf`; the oldest inserted is dropped beyond it. */
  maxSize?: number
  /** Size of one value, for `maxSize` (default 1). */
  sizeOf?: (value: T) => number
  now?: () => number
}

export interface Cache<T> {
  get(key: string): Promise<T | undefined>
  set(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
}

/**
 * A very basic in-memory cache: a TTL per item and caps on count and total size, no timers
 * and no LRU. The newest item is always kept, even if it alone is over the size cap.
 * Expired items are removed when read. The methods are async so Redis can replace it
 * later without changing callers.
 */
export function createMemoryCache<T>({
  ttlMs,
  maxEntries = Infinity,
  maxSize = Infinity,
  sizeOf = () => 1,
  now = Date.now,
}: Options<T>): Cache<T> {
  const items = new Map<string, { value: T; size: number; expiresAt: number }>()
  let totalSize = 0

  const remove = (key: string) => {
    const item = items.get(key)
    if (!item) return
    totalSize -= item.size
    items.delete(key)
  }

  return {
    get(key) {
      const item = items.get(key)
      if (item && item.expiresAt <= now()) {
        remove(key)
        return Promise.resolve(undefined)
      }
      return Promise.resolve(item?.value)
    },

    set(key, value) {
      // Delete first so a rewritten key counts as the newest.
      remove(key)
      const size = sizeOf(value)
      items.set(key, { value, size, expiresAt: now() + ttlMs })
      totalSize += size
      while (items.size > 1 && (items.size > maxEntries || totalSize > maxSize)) {
        const oldest = items.keys().next().value
        if (oldest === undefined) break
        remove(oldest)
      }
      return Promise.resolve()
    },

    delete(key) {
      remove(key)
      return Promise.resolve()
    },
  }
}
