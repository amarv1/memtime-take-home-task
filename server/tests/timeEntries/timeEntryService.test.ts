import { createHash } from 'node:crypto'
import { http, HttpResponse, delay } from 'msw'
import { createMemoryCache } from '../../src/cache/memoryCache.ts'
import type { Cache } from '../../src/cache/memoryCache.ts'
import { logger } from '../../src/logger.ts'
import { createMemtimeClient } from '../../src/memtime/memtimeClient.ts'
import { MemtimeKeyRejectedError } from '../../src/middleware/endSessionOnRevokedKey.ts'
import { HttpError } from '../../src/middleware/errorHandler.ts'
import { createTimeEntryService } from '../../src/timeEntries/timeEntryService.ts'
import type { TimeEntry } from '../../src/timeEntries/timeEntryService.ts'
import { server } from '../support/server.ts'
import { buildEntry, page } from './support.ts'

const BASE = 'https://upstream.test/api/v1'
const KEY = 'secret-key-123'

const many = (count: number) =>
  Array.from({ length: count }, (_, i) => buildEntry(i + 1, 5))

describe('timeEntryService', () => {
  let cache: Cache<TimeEntry[]>
  let calls: { offset: string | null; auth: string | null }[]

  const service = () =>
    createTimeEntryService({
      client: createMemtimeClient({ memtimeApiUrl: BASE }),
      cache,
    })

  function mockEntries(entries: TimeEntry[]) {
    server.use(
      http.get(`${BASE}/time-entries`, ({ request }) => {
        const url = new URL(request.url)
        calls.push({
          offset: url.searchParams.get('offset'),
          auth: request.headers.get('authorization'),
        })
        return HttpResponse.json(page(entries, url))
      }),
    )
  }

  beforeEach(() => {
    cache = createMemoryCache({ ttlMs: 60_000, maxEntries: 10 })
    calls = []
  })

  it('pages with limit 100 until a short page, and sends the key', async () => {
    mockEntries(many(250))

    const entries = await service().getAllEntries(KEY)

    expect(entries).toHaveLength(250)
    expect(calls.map((c) => c.offset)).toEqual(['0', '100', '200'])
    expect(calls[0]?.auth).toBe(`Bearer ${KEY}`)
  })

  it('asks once more when the last page is exactly full', async () => {
    mockEntries(many(200))

    await service().getAllEntries(KEY)

    expect(calls.map((c) => c.offset)).toEqual(['0', '100', '200'])
  })

  it('answers from the cache on the second call', async () => {
    mockEntries(many(3))
    const s = service()

    await s.getAllEntries(KEY)
    await s.getAllEntries(KEY)

    expect(calls).toHaveLength(1)
  })

  it('caches under a hash of the key, never the raw key', async () => {
    mockEntries(many(3))
    const keys: string[] = []
    const spy: Cache<TimeEntry[]> = {
      get: (key) => (keys.push(key), cache.get(key)),
      set: (key, value) => (keys.push(key), cache.set(key, value)),
      delete: (key) => (keys.push(key), cache.delete(key)),
    }
    const s = createTimeEntryService({
      client: createMemtimeClient({ memtimeApiUrl: BASE }),
      cache: spy,
    })

    await s.getAllEntries(KEY)
    await s.invalidate(KEY)

    const hash = createHash('sha256').update(KEY).digest('hex')
    expect(keys).toEqual([hash, hash, hash])
    expect(keys.join()).not.toContain(KEY)
  })

  it('shares one load between concurrent calls for the same key', async () => {
    server.use(
      http.get(`${BASE}/time-entries`, async () => {
        calls.push({ offset: null, auth: null })
        await delay(20)
        return HttpResponse.json(many(3))
      }),
    )
    const s = service()

    const [a, b] = await Promise.all([s.getAllEntries(KEY), s.getAllEntries(KEY)])

    expect(a).toBe(b)
    expect(calls).toHaveLength(1)
  })

  it('loads separately for different keys', async () => {
    mockEntries(many(3))
    const s = service()

    await Promise.all([s.getAllEntries('key-a'), s.getAllEntries('key-b')])

    expect(calls).toHaveLength(2)
  })

  it('loads again after invalidate', async () => {
    mockEntries(many(3))
    const s = service()
    await s.getAllEntries(KEY)

    await s.invalidate(KEY)
    await s.getAllEntries(KEY)

    expect(calls).toHaveLength(2)
  })

  describe('writes during a load', () => {
    const fresh = [buildEntry(1, 5), buildEntry(2, 5)]
    let release: () => void
    let hold: Promise<void>

    // The first load answers with the old list once released; later loads get the fresh one at once.
    function holdFirstLoad() {
      hold = new Promise<void>((resolve) => (release = resolve))
      let first = true
      server.use(
        http.get(`${BASE}/time-entries`, async () => {
          calls.push({ offset: null, auth: null })
          if (!first) return HttpResponse.json(fresh)
          first = false
          await hold
          return HttpResponse.json([buildEntry(1, 5)])
        }),
        http.post(`${BASE}/time-entries`, () => HttpResponse.json(buildEntry(2, 5))),
      )
    }

    const newEntry = { taskId: 5, comment: 'x', start: 'a', end: 'b' }

    it('does not cache a load that started before a write', async () => {
      holdFirstLoad()
      const s = service()
      const old = s.getAllEntries(KEY)
      await vi.waitFor(() => expect(calls).toHaveLength(1))

      await s.createEntry(KEY, newEntry)
      release()
      await expect(old).resolves.toHaveLength(1)

      await expect(s.getAllEntries(KEY)).resolves.toEqual(fresh)
      expect(calls).toHaveLength(2)
    })

    it('starts a new load for a call made after the write, not joining the old one', async () => {
      holdFirstLoad()
      const s = service()
      const old = s.getAllEntries(KEY)
      await vi.waitFor(() => expect(calls).toHaveLength(1))

      await s.invalidate(KEY)
      const entries = await s.getAllEntries(KEY)

      expect(entries).toEqual(fresh)
      expect(calls).toHaveLength(2)
      release()
      await old
    })

    it('keeps sharing the newer load after the old one settles', async () => {
      holdFirstLoad()
      const s = service()
      const old = s.getAllEntries(KEY)
      await vi.waitFor(() => expect(calls).toHaveLength(1))
      await s.invalidate(KEY)
      // Hold the new load too, so it is still running when the old one settles.
      let releaseNew: () => void = vi.fn()
      const holdNew = new Promise<void>((resolve) => (releaseNew = resolve))
      server.use(
        http.get(`${BASE}/time-entries`, async () => {
          calls.push({ offset: null, auth: null })
          await holdNew
          return HttpResponse.json(fresh)
        }),
      )
      const newer = s.getAllEntries(KEY)
      await vi.waitFor(() => expect(calls).toHaveLength(2))

      release()
      await old
      const joined = s.getAllEntries(KEY)
      releaseNew()

      const [a, b] = await Promise.all([newer, joined])
      expect(a).toBe(b)
      expect(calls).toHaveLength(2)
    })
  })

  describe('failures', () => {
    it('maps 429 to a friendly 429 and passes retry-after', async () => {
      server.use(
        http.get(`${BASE}/time-entries`, () =>
          HttpResponse.json(
            { error: 'Rate limit' },
            { status: 429, headers: { 'retry-after': '42' } },
          ),
        ),
      )

      const error = await service()
        .getAllEntries(KEY)
        .catch((e: unknown) => e)

      expect(error).toBeInstanceOf(HttpError)
      expect(error).toMatchObject({ status: 429, headers: { 'Retry-After': '42' } })
    })

    it('leaves retry-after out when upstream sends none', async () => {
      server.use(
        http.get(`${BASE}/time-entries`, () => HttpResponse.json({}, { status: 429 })),
      )

      await expect(service().getAllEntries(KEY)).rejects.toMatchObject({
        status: 429,
        headers: undefined,
      })
    })

    it.each([400, 404, 500, 503])('maps upstream %s to 502', async (status) => {
      vi.spyOn(logger, 'warn').mockImplementation(vi.fn())
      server.use(
        http.get(`${BASE}/time-entries`, () =>
          HttpResponse.json({ error: 'x' }, { status }),
        ),
      )

      await expect(service().getAllEntries(KEY)).rejects.toMatchObject({ status: 502 })
      vi.restoreAllMocks()
    })

    it('maps a body that is not a list to 502', async () => {
      server.use(http.get(`${BASE}/time-entries`, () => HttpResponse.json({ items: [] })))

      await expect(service().getAllEntries(KEY)).rejects.toMatchObject({ status: 502 })
    })

    it('maps 401 to MemtimeKeyRejectedError', async () => {
      server.use(
        http.get(`${BASE}/time-entries`, () => new HttpResponse('no', { status: 401 })),
      )

      await expect(service().getAllEntries(KEY)).rejects.toBeInstanceOf(
        MemtimeKeyRejectedError,
      )
    })

    it('maps a network error to 502', async () => {
      vi.spyOn(logger, 'error').mockImplementation(vi.fn())
      server.use(http.get(`${BASE}/time-entries`, () => HttpResponse.error()))

      await expect(service().getAllEntries(KEY)).rejects.toMatchObject({ status: 502 })
      vi.restoreAllMocks()
    })

    it('does not cache a failed load, even one that failed on a later page', async () => {
      let failing = true
      server.use(
        http.get(`${BASE}/time-entries`, ({ request }) => {
          const url = new URL(request.url)
          calls.push({ offset: url.searchParams.get('offset'), auth: null })
          if (failing && url.searchParams.get('offset') === '100')
            return HttpResponse.json({}, { status: 429 })
          return HttpResponse.json(page(many(150), url))
        }),
      )
      const s = service()
      await expect(s.getAllEntries(KEY)).rejects.toMatchObject({ status: 429 })

      failing = false
      const entries = await s.getAllEntries(KEY)

      expect(entries).toHaveLength(150)
      expect(calls.map((c) => c.offset)).toEqual(['0', '100', '0', '100'])
    })

    it('lets a new load start after a failed one settles', async () => {
      server.use(
        http.get(`${BASE}/time-entries`, () => HttpResponse.json({}, { status: 429 })),
      )
      const s = service()
      await expect(s.getAllEntries(KEY)).rejects.toBeDefined()

      mockEntries(many(2))

      await expect(s.getAllEntries(KEY)).resolves.toHaveLength(2)
    })
  })

  describe('writes with an unknown outcome', () => {
    const newEntry = { taskId: 5, comment: 'x', start: 'a', end: 'b' }
    type Write = (s: ReturnType<typeof service>) => Promise<unknown>
    const writes: Record<
      string,
      { method: 'post' | 'put' | 'delete'; url: string; run: Write }
    > = {
      create: {
        method: 'post',
        url: `${BASE}/time-entries`,
        run: (s) => s.createEntry(KEY, newEntry),
      },
      update: {
        method: 'put',
        url: `${BASE}/time-entries/7`,
        run: (s) => s.updateEntry(KEY, 7, newEntry),
      },
      delete: {
        method: 'delete',
        url: `${BASE}/time-entries/7`,
        run: (s) => s.deleteEntry(KEY, 7),
      },
    }

    // Loads and caches the list, then makes the write answer with `answer`.
    async function writeAfterCaching(name: string, answer: () => Response) {
      mockEntries(many(3))
      const s = service()
      await s.getAllEntries(KEY)
      const { method, url, run } = writes[name]!
      server.use(http[method](url, answer))
      const error = await run(s).catch((e: unknown) => e)
      return { s, error }
    }

    beforeEach(() => {
      vi.spyOn(logger, 'error').mockImplementation(vi.fn())
      vi.spyOn(logger, 'warn').mockImplementation(vi.fn())
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('loads again after a network error on create', async () => {
      const { s, error } = await writeAfterCaching('create', () => HttpResponse.error())

      expect(error).toMatchObject({
        status: 502,
        message: "Couldn't reach Memtime. Please try again.",
      })
      await s.getAllEntries(KEY)
      expect(calls).toHaveLength(2)
    })

    it.each(['create', 'update', 'delete'])(
      'loads again after a 500 on %s',
      async (name) => {
        const { s, error } = await writeAfterCaching(name, () =>
          HttpResponse.json({ error: 'x' }, { status: 500 }),
        )

        expect(error).toMatchObject({ status: 502 })
        await s.getAllEntries(KEY)
        expect(calls).toHaveLength(2)
      },
    )

    it.each(['create', 'update', 'delete'])(
      'keeps the cache after a 429 on %s',
      async (name) => {
        const { s, error } = await writeAfterCaching(name, () =>
          HttpResponse.json({}, { status: 429 }),
        )

        expect(error).toMatchObject({ status: 429 })
        await s.getAllEntries(KEY)
        expect(calls).toHaveLength(1)
      },
    )

    it.each(['create', 'update', 'delete'])(
      'keeps the cache after a 404 on %s',
      async (name) => {
        const { s, error } = await writeAfterCaching(name, () =>
          HttpResponse.json({ error: 'x' }, { status: 404 }),
        )

        expect(error).toMatchObject({ status: 404 })
        await s.getAllEntries(KEY)
        expect(calls).toHaveLength(1)
      },
    )

    it.each(['create', 'update', 'delete'])(
      'keeps the cache after a 401 on %s',
      async (name) => {
        const { s, error } = await writeAfterCaching(
          name,
          () => new HttpResponse('no', { status: 401 }),
        )

        expect(error).toBeInstanceOf(MemtimeKeyRejectedError)
        await s.getAllEntries(KEY)
        expect(calls).toHaveLength(1)
      },
    )
  })
})
