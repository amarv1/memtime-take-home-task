import { createMemoryCache } from '../../src/cache/memoryCache.ts'

describe('createMemoryCache', () => {
  it('returns what was set, and undefined for an unknown key', async () => {
    const cache = createMemoryCache<number>({ ttlMs: 1000, maxEntries: 10 })

    await cache.set('a', 1)

    expect(await cache.get('a')).toBe(1)
    expect(await cache.get('b')).toBeUndefined()
  })

  it('drops an item once its TTL has passed', async () => {
    let now = 0
    const cache = createMemoryCache<number>({
      ttlMs: 1000,
      maxEntries: 10,
      now: () => now,
    })
    await cache.set('a', 1)

    now = 999
    expect(await cache.get('a')).toBe(1)
    now = 1000
    expect(await cache.get('a')).toBeUndefined()
  })

  it('starts the TTL again when a key is set again', async () => {
    let now = 0
    const cache = createMemoryCache<number>({
      ttlMs: 1000,
      maxEntries: 10,
      now: () => now,
    })
    await cache.set('a', 1)
    now = 800
    await cache.set('a', 2)

    now = 1500
    expect(await cache.get('a')).toBe(2)
  })

  it('drops the oldest item when over the size cap', async () => {
    const cache = createMemoryCache<number>({ ttlMs: 1000, maxEntries: 2 })

    await cache.set('a', 1)
    await cache.set('b', 2)
    await cache.set('c', 3)

    expect(await cache.get('a')).toBeUndefined()
    expect(await cache.get('b')).toBe(2)
    expect(await cache.get('c')).toBe(3)
  })

  it('deletes an item', async () => {
    const cache = createMemoryCache<number>({ ttlMs: 1000, maxEntries: 2 })
    await cache.set('a', 1)

    await cache.delete('a')

    expect(await cache.get('a')).toBeUndefined()
  })
})
