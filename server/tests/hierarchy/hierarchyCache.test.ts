import { http, HttpResponse } from 'msw'
import { createMemoryCache } from '../../src/cache/memoryCache.ts'
import { createHierarchyCache } from '../../src/hierarchy/hierarchyCache.ts'
import type { HierarchyItem } from '../../src/hierarchy/hierarchyCache.ts'
import { createMemtimeClient } from '../../src/memtime/memtimeClient.ts'
import { RateLimitedError } from '../../src/memtime/rateLimit.ts'
import { server } from '../support/server.ts'

const BASE = 'https://upstream.test/api/v1'
const TTL = 60_000

describe('hierarchyCache', () => {
  let clock: number
  let calls: { path: string; search: string; auth: string | null }[]

  function build() {
    clock = 0
    const now = () => clock
    return createHierarchyCache({
      client: createMemtimeClient({ memtimeApiUrl: BASE }),
      pages: createMemoryCache<string>({ ttlMs: TTL, maxEntries: 100, now }),
      items: createMemoryCache<HierarchyItem>({ ttlMs: TTL, maxEntries: 100, now }),
    })
  }

  /** Answers every proxied path with `respond` and records the calls. */
  function mockUpstream(respond: () => Response | Promise<Response>) {
    calls = []
    const handler = ({ request }: { request: Request }) => {
      const url = new URL(request.url)
      calls.push({
        path: url.pathname.replace('/api/v1', ''),
        search: url.search,
        auth: request.headers.get('authorization'),
      })
      return respond()
    }
    server.use(
      http.get(`${BASE}/clients`, handler),
      http.get(`${BASE}/clients/:id/projects`, handler),
      http.get(`${BASE}/projects/:id/tasks`, handler),
      http.get(`${BASE}/projects/:id`, handler),
      http.get(`${BASE}/tasks/:id`, handler),
    )
  }

  describe('getList', () => {
    it('calls upstream on a miss and serves the next request from the cache', async () => {
      mockUpstream(() => HttpResponse.json([{ id: 1, name: 'A' }]))
      const cache = build()

      const first = await cache.getList('key', '/clients', 'limit=100', 'label')
      const second = await cache.getList('key', '/clients', 'limit=100', 'label')

      expect(calls).toHaveLength(1)
      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(JSON.parse(second.body)).toEqual([{ id: 1, name: 'A' }])
      expect([...second.headers]).toEqual([])
    })

    it('shares an entry between queries that differ only in param order', async () => {
      mockUpstream(() => HttpResponse.json([]))
      const cache = build()

      await cache.getList('key', '/clients', 'limit=100&offset=0', 'label')
      await cache.getList('key', '/clients', 'offset=0&limit=100', 'label')

      expect(calls).toHaveLength(1)
      expect(calls[0]?.search).toBe('?limit=100&offset=0')
    })

    it('keeps separate entries for different paths and queries', async () => {
      mockUpstream(() => HttpResponse.json([]))
      const cache = build()

      await cache.getList('key', '/clients', 'offset=0', 'label')
      await cache.getList('key', '/clients', 'offset=100', 'label')
      await cache.getList('key', '/clients/1/projects', 'offset=0', 'label')

      expect(calls).toHaveLength(3)
    })

    it("never serves one key's page to another key", async () => {
      mockUpstream(() => HttpResponse.json([{ id: 1 }]))
      const cache = build()

      await cache.getList('key-a', '/clients', '', 'label')
      await cache.getList('key-b', '/clients', '', 'label')

      expect(calls.map((c) => c.auth)).toEqual(['Bearer key-a', 'Bearer key-b'])
    })

    it('asks upstream again once the TTL has passed', async () => {
      mockUpstream(() => HttpResponse.json([]))
      const cache = build()

      await cache.getList('key', '/clients', '', 'label')
      clock = TTL - 1
      await cache.getList('key', '/clients', '', 'label')
      expect(calls).toHaveLength(1)

      clock = TTL
      await cache.getList('key', '/clients', '', 'label')
      expect(calls).toHaveLength(2)
    })

    it.each([
      ['an error', () => HttpResponse.json([], { status: 500 })],
      ['a 404', () => HttpResponse.json([], { status: 404 })],
      ['an object', () => HttpResponse.json({})],
      ['text that is not JSON', () => new HttpResponse('nope', { status: 200 })],
    ])('does not cache %s', async (_label, respond) => {
      mockUpstream(respond)
      const cache = build()

      await cache.getList('key', '/clients', '', 'label')
      await cache.getList('key', '/clients', '', 'label')

      expect(calls).toHaveLength(2)
    })

    it('does not cache a 429', async () => {
      mockUpstream(() => HttpResponse.json([], { status: 429 }))
      const cache = build()

      const first = await cache.getList('key', '/clients', '', 'label')
      await cache.getList('key', '/clients', '', 'label')

      expect(first.status).toBe(429)
      expect(calls).toHaveLength(2)
    })

    it('shares one upstream call between concurrent misses', async () => {
      mockUpstream(() => HttpResponse.json([{ id: 1 }]))
      const cache = build()

      const results = await Promise.all([
        cache.getList('key', '/clients', '', 'label'),
        cache.getList('key', '/clients', '', 'label'),
        cache.getList('key', '/clients', '', 'label'),
      ])

      expect(calls).toHaveLength(1)
      expect(results.map((r) => r.body)).toEqual(Array(3).fill(results[0]?.body))
    })

    it('gives every waiter the same error and lets the next call try again', async () => {
      const cache = createHierarchyCache({
        client: {
          get: vi.fn().mockRejectedValue(new RateLimitedError(5)),
        } as never,
        pages: createMemoryCache<string>({ ttlMs: TTL, maxEntries: 10 }),
        items: createMemoryCache<HierarchyItem>({ ttlMs: TTL, maxEntries: 10 }),
      })

      const results = await Promise.allSettled([
        cache.getList('key', '/clients', '', 'label'),
        cache.getList('key', '/clients', '', 'label'),
      ])

      expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected'])
      const reasons = results.map((r) =>
        r.status === 'rejected' ? (r.reason as unknown) : null,
      )
      expect(reasons[0]).toBeInstanceOf(RateLimitedError)
      expect(reasons[1]).toBe(reasons[0])
      await expect(cache.getList('key', '/clients', '', 'label')).rejects.toBeInstanceOf(
        RateLimitedError,
      )
    })

    it('indexes the items so getItem needs no upstream call', async () => {
      mockUpstream(() => HttpResponse.json([{ id: 4, name: 'T', status: 'active' }]))
      const cache = build()

      await cache.getList('key', '/projects/9/tasks', '', 'label')
      const task = await cache.getItem('key', 'task', '4', 'label')

      expect(calls).toHaveLength(1)
      expect(task.status).toBe(200)
      expect(JSON.parse(task.body)).toEqual({ id: 4, name: 'T', status: 'active' })
    })

    it('indexes project lists as projects and skips items without a numeric id', async () => {
      mockUpstream(() => HttpResponse.json([{ id: 2 }, { id: '3' }, { name: 'x' }, 7]))
      const cache = build()

      await cache.getList('key', '/clients/1/projects', '', 'label')
      await cache.getItem('key', 'project', '2', 'label')
      expect(calls).toHaveLength(1)

      await cache.getItem('key', 'project', '3', 'label')
      expect(calls).toHaveLength(2)
    })

    it('does not serve an indexed item to another key', async () => {
      mockUpstream(() => HttpResponse.json([{ id: 4, status: 'active' }]))
      const cache = build()

      await cache.getList('key-a', '/projects/9/tasks', '', 'label')

      expect(await cache.peekTask('key-b', 4)).toBeUndefined()
    })
  })

  describe('getItem', () => {
    it('fetches a miss, indexes it and then serves it from the cache', async () => {
      mockUpstream(() => HttpResponse.json({ id: 42, status: 'active' }))
      const cache = build()

      const first = await cache.getItem('key', 'task', '42', 'label')
      const second = await cache.getItem('key', 'task', '42', 'label')

      expect(calls).toEqual([{ path: '/tasks/42', search: '', auth: 'Bearer key' }])
      expect(JSON.parse(first.body)).toEqual({ id: 42, status: 'active' })
      expect(JSON.parse(second.body)).toEqual({ id: 42, status: 'active' })
      expect(second.status).toBe(200)
    })

    it('looks projects up under /projects', async () => {
      mockUpstream(() => HttpResponse.json({ id: 9 }))
      const cache = build()

      await cache.getItem('key', 'project', '9', 'label')

      expect(calls[0]?.path).toBe('/projects/9')
    })

    it('passes a 404 through and does not cache it', async () => {
      mockUpstream(() => HttpResponse.json({ error: 'no' }, { status: 404 }))
      const cache = build()

      const first = await cache.getItem('key', 'task', '5', 'label')
      await cache.getItem('key', 'task', '5', 'label')

      expect(first.status).toBe(404)
      expect(JSON.parse(first.body)).toEqual({ error: 'no' })
      expect(calls).toHaveLength(2)
    })

    it('does not index a success without a numeric id', async () => {
      mockUpstream(() => HttpResponse.json({ name: 'x' }))
      const cache = build()

      await cache.getItem('key', 'task', '5', 'label')
      await cache.getItem('key', 'task', '5', 'label')

      expect(calls).toHaveLength(2)
    })

    it('shares one upstream call between concurrent misses', async () => {
      mockUpstream(() => HttpResponse.json({ id: 5 }))
      const cache = build()

      await Promise.all([
        cache.getItem('key', 'task', '5', 'label'),
        cache.getItem('key', 'task', '5', 'label'),
      ])

      expect(calls).toHaveLength(1)
    })
  })

  describe('peekTask', () => {
    it('returns a seen task without a call, and undefined otherwise', async () => {
      mockUpstream(() => HttpResponse.json([{ id: 4, status: 'active' }]))
      const cache = build()

      expect(await cache.peekTask('key', 4)).toBeUndefined()
      await cache.getList('key', '/projects/9/tasks', '', 'label')

      expect(await cache.peekTask('key', 4)).toEqual({ id: 4, status: 'active' })
      expect(await cache.peekTask('key', 5)).toBeUndefined()
      expect(calls).toHaveLength(1)
    })
  })
})
