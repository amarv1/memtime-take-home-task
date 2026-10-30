import { createHash } from 'node:crypto'
import { http, HttpResponse, delay } from 'msw'
import { createMemoryCache } from '../../src/cache/memoryCache.ts'
import type { Cache } from '../../src/cache/memoryCache.ts'
import { logger } from '../../src/logger.ts'
import { CircuitOpenError } from '../../src/memtime/circuitBreaker.ts'
import { createMemtimeClient } from '../../src/memtime/memtimeClient.ts'
import type { MemtimeResponse } from '../../src/memtime/memtimeClient.ts'
import { RateLimitedError } from '../../src/memtime/rateLimit.ts'
import { MemtimeKeyRejectedError } from '../../src/middleware/endSessionOnRevokedKey.ts'
import { HttpError } from '../../src/middleware/errorHandler.ts'
import { runInRequest } from '../../src/requestId.ts'
import type { Snapshot } from '../../src/timeEntries/entrySnapshot.ts'
import { createTimeEntryService } from '../../src/timeEntries/timeEntryService.ts'
import type { TimeEntry } from '../../src/timeEntries/timeEntryService.ts'
import { server } from '../support/server.ts'
import { buildEntry, page } from './support.ts'

const BASE = 'https://upstream.test/api/v1'
const KEY = 'secret-key-123'
const FRESH_MS = 60_000

const many = (count: number) =>
  Array.from({ length: count }, (_, i) => buildEntry(i + 1, 5))
const later = (minute: number) => new Date(Date.UTC(2025, 0, 2, 9, minute)).toISOString()
const ids = (entries: { id: number }[]) => entries.map((e) => e.id)
const asSave = <T>(fn: () => Promise<T>) =>
  runInRequest({ requestId: 'r', writing: true }, fn)

/** Lets reads through until `reads` runs out, then refuses them like the gate does; writes always pass. */
function fakeGate() {
  const gate = {
    reads: Infinity,
    run: (_key: string, kind: 'read' | 'write', call: () => Promise<MemtimeResponse>) => {
      if (kind === 'read') {
        if (gate.reads <= 0) return Promise.reject(new RateLimitedError(30))
        gate.reads -= 1
      }
      return call()
    },
  }
  return gate
}

describe('timeEntryService', () => {
  let cache: Cache<Snapshot>
  let clock: number
  // Memtime's list for KEY; handlers read it on every call, so tests change it in place.
  let db: TimeEntry[]
  // Each list call as `sortBy:order:offset:limit`.
  let calls: string[]
  let auths: (string | null)[]

  const service = (gate?: ReturnType<typeof fakeGate>) =>
    createTimeEntryService({
      client: createMemtimeClient({ memtimeApiUrl: BASE, gate }),
      cache,
      freshMs: FRESH_MS,
      now: () => clock,
    })

  const describeCall = (url: URL) => {
    const q = url.searchParams
    return `${q.get('sortBy')}:${q.get('order')}:${q.get('offset')}:${q.get('limit')}`
  }

  function mockList() {
    server.use(
      http.get(`${BASE}/time-entries`, ({ request }) => {
        const url = new URL(request.url)
        calls.push(describeCall(url))
        auths.push(request.headers.get('authorization'))
        return HttpResponse.json(page(db, url))
      }),
    )
  }

  /** Changes an entry in Memtime as another app would, bumping its `updatedAt`. */
  function editElsewhere(id: number, minute: number) {
    db = db.map((e) =>
      e.id === id ? { ...e, comment: 'edited elsewhere', updatedAt: later(minute) } : e,
    )
  }

  beforeEach(() => {
    cache = createMemoryCache({ ttlMs: 3_600_000, maxEntries: 10 })
    clock = 1_000_000
    db = many(3)
    calls = []
    auths = []
  })

  describe('first read', () => {
    it('reads a short list in one call, newest first, and sends the key', async () => {
      mockList()

      const entries = await service().getAllEntries(KEY)

      expect(ids(entries)).toEqual([1, 2, 3])
      expect(calls).toEqual(['updatedAt:desc:0:100'])
      expect(auths).toEqual([`Bearer ${KEY}`])
    })

    it('reads a long list by id after the newest page, until a short page', async () => {
      db = many(250)
      mockList()

      const entries = await service().getAllEntries(KEY)

      expect(entries).toHaveLength(250)
      expect(calls).toEqual([
        'updatedAt:desc:0:100',
        'id:asc:0:100',
        'id:asc:100:100',
        'id:asc:200:100',
      ])
    })

    it('asks once more when the last page is exactly full', async () => {
      db = many(200)
      mockList()

      await service().getAllEntries(KEY)

      expect(calls.slice(1)).toEqual(['id:asc:0:100', 'id:asc:100:100', 'id:asc:200:100'])
    })

    it('goes on from where a refused read stopped, without starting over', async () => {
      db = many(250)
      mockList()
      const gate = fakeGate()
      gate.reads = 2
      const s = service(gate)

      const refused = await s.getAllEntries(KEY).catch((e: unknown) => e)
      expect(refused).toBeInstanceOf(RateLimitedError)

      gate.reads = Infinity
      const entries = await s.getAllEntries(KEY)

      expect(entries).toHaveLength(250)
      expect(calls).toEqual([
        'updatedAt:desc:0:100',
        'id:asc:0:100',
        'id:asc:100:100',
        'id:asc:200:100',
      ])
    })

    it('shares one read between concurrent calls for the same key', async () => {
      server.use(
        http.get(`${BASE}/time-entries`, async () => {
          calls.push('list')
          await delay(20)
          return HttpResponse.json(many(3))
        }),
      )
      const s = service()

      const [a, b] = await Promise.all([s.getAllEntries(KEY), s.getAllEntries(KEY)])

      expect(a).toBe(b)
      expect(calls).toHaveLength(1)
    })

    it("lets a save that joined a page view's refused read read again as a save", async () => {
      let attempt = 0
      server.use(
        http.get(`${BASE}/time-entries`, async () => {
          await delay(20)
          return HttpResponse.json(many(3))
        }),
      )
      const gate = {
        run: async (
          _key: string,
          kind: 'read' | 'write',
          call: () => Promise<MemtimeResponse>,
        ) => {
          attempt += 1
          if (kind === 'read') throw new RateLimitedError(30)
          return call()
        },
      }
      const s = createTimeEntryService({
        client: createMemtimeClient({ memtimeApiUrl: BASE, gate }),
        cache,
        freshMs: FRESH_MS,
      })

      const view = s.getAllEntries(KEY).catch((e: unknown) => e)
      const save = asSave(() => s.getAllEntries(KEY))

      expect(await view).toBeInstanceOf(RateLimitedError)
      expect(await save).toHaveLength(3)
      expect(attempt).toBe(2)
    })

    it('reads separately for different keys', async () => {
      mockList()
      const s = service()

      await Promise.all([s.getAllEntries('key-a'), s.getAllEntries('key-b')])

      expect(calls).toHaveLength(2)
    })

    it('keeps the list under a hash of the key, never the raw key', async () => {
      mockList()
      const keys: string[] = []
      const spy: Cache<Snapshot> = {
        get: (key) => (keys.push(key), cache.get(key)),
        set: (key, value) => (keys.push(key), cache.set(key, value)),
        delete: (key) => (keys.push(key), cache.delete(key)),
      }
      const s = createTimeEntryService({
        client: createMemtimeClient({ memtimeApiUrl: BASE }),
        cache: spy,
        freshMs: FRESH_MS,
      })

      await s.getAllEntries(KEY)

      const hash = createHash('sha256').update(KEY).digest('hex')
      expect(new Set(keys)).toEqual(new Set([hash]))
    })

    it('reads again when a save lands during the first read', async () => {
      let release: () => void = vi.fn()
      const hold = new Promise<void>((resolve) => (release = resolve))
      server.use(
        http.get(`${BASE}/time-entries`, async ({ request }) => {
          calls.push(describeCall(new URL(request.url)))
          // The first answer is the list from before the save.
          const before = calls.length === 1
          if (before) await hold
          return HttpResponse.json(before ? many(1) : many(2))
        }),
        http.post(`${BASE}/time-entries`, () =>
          HttpResponse.json(buildEntry(2, 5), { status: 201 }),
        ),
      )
      const s = service()
      const read = s.getAllEntries(KEY)
      await vi.waitFor(() => expect(calls).toHaveLength(1))

      await s.createEntry(KEY, { taskId: 5, comment: 'x', start: 'a', end: 'b' })
      release()

      expect(ids(await read)).toEqual([1, 2])
      expect(calls).toHaveLength(2)
    })
  })

  describe('later reads', () => {
    it('answer from memory while the list is fresh', async () => {
      mockList()
      const s = service()

      await s.getAllEntries(KEY)
      clock += FRESH_MS - 1
      await s.getAllEntries(KEY)

      expect(calls).toHaveLength(1)
    })

    it('ask only for changes and check the count once the list is stale', async () => {
      db = many(250)
      mockList()
      const s = service()
      await s.getAllEntries(KEY)
      calls = []

      editElsewhere(7, 1)
      db = [...db, buildEntry(251, 5, { updatedAt: later(2) })]
      clock += FRESH_MS
      const entries = await s.getAllEntries(KEY)

      expect(calls).toEqual(['updatedAt:desc:0:100', 'id:asc:250:2'])
      expect(entries).toHaveLength(251)
      expect(entries.find((e) => e.id === 7)?.comment).toBe('edited elsewhere')
    })

    it('read changes past one page until an older entry shows up', async () => {
      db = many(250)
      mockList()
      const s = service()
      await s.getAllEntries(KEY)
      calls = []

      for (let id = 1; id <= 120; id++) editElsewhere(id, 1)
      clock += FRESH_MS
      const entries = await s.getAllEntries(KEY)

      expect(calls).toEqual([
        'updatedAt:desc:0:100',
        'updatedAt:desc:100:100',
        'id:asc:249:2',
      ])
      expect(entries.filter((e) => e.comment === 'edited elsewhere')).toHaveLength(120)
    })

    it('read past the entries this server saved since the last check', async () => {
      db = many(250)
      mockList()
      server.use(
        http.put(`${BASE}/time-entries/:id`, ({ params }) => {
          editElsewhere(Number(params.id), 2)
          return HttpResponse.json(db.find((e) => e.id === Number(params.id)))
        }),
      )
      const s = service()
      await s.getAllEntries(KEY)
      const newEntry = { taskId: 5, comment: 'x', start: 'a', end: 'b' }
      for (let id = 1; id <= 100; id++) await s.updateEntry(KEY, id, newEntry)
      calls = []

      // Older than this server's saves, so it sorts after all of them.
      editElsewhere(200, 1)
      clock += FRESH_MS
      const entries = await s.getAllEntries(KEY)

      expect(calls).toEqual([
        'updatedAt:desc:0:100',
        'updatedAt:desc:100:100',
        'id:asc:249:2',
      ])
      expect(entries.find((e) => e.id === 200)?.comment).toBe('edited elsewhere')
    })

    it('read the whole list again when the count shows a delete made elsewhere', async () => {
      mockList()
      const s = service()
      await s.getAllEntries(KEY)
      calls = []

      db = db.filter((e) => e.id !== 2)
      clock += FRESH_MS
      const entries = await s.getAllEntries(KEY)

      expect(ids(entries)).toEqual([1, 3])
      expect(calls).toEqual(['updatedAt:desc:0:100', 'id:asc:2:2', 'id:asc:0:100'])
    })

    it('serve the old list while a full read waits for budget, then finish it', async () => {
      db = many(250)
      mockList()
      const gate = fakeGate()
      const s = service(gate)
      await s.getAllEntries(KEY)
      calls = []

      db = db.filter((e) => e.id !== 2)
      clock += FRESH_MS
      gate.reads = 3
      const during = await s.getAllEntries(KEY)
      expect(during).toHaveLength(250)

      gate.reads = Infinity
      const after = await s.getAllEntries(KEY)

      expect(after).toHaveLength(249)
      expect(calls).toEqual([
        'updatedAt:desc:0:100',
        'id:asc:249:2',
        'id:asc:0:100',
        'id:asc:100:100',
        'id:asc:200:100',
      ])
    })

    it('serve the old list when the budget runs out before the check', async () => {
      mockList()
      const gate = fakeGate()
      const s = service(gate)
      await s.getAllEntries(KEY)

      gate.reads = 0
      clock += FRESH_MS

      await expect(s.getAllEntries(KEY)).resolves.toHaveLength(3)
      expect(calls).toHaveLength(1)
    })

    it('let a save with a stale list ask for changes but skip the count check', async () => {
      mockList()
      const s = service()
      await s.getAllEntries(KEY)
      calls = []

      clock += FRESH_MS
      await asSave(() => s.getAllEntries(KEY))

      expect(calls).toEqual(['updatedAt:desc:0:100'])
    })
  })

  describe('saves', () => {
    const newEntry = { taskId: 5, comment: 'x', start: 'a', end: 'b' }

    async function loaded() {
      mockList()
      const s = service()
      await s.getAllEntries(KEY)
      calls = []
      return s
    }

    it('add a created entry to the list without reading it again', async () => {
      const s = await loaded()
      server.use(
        http.post(`${BASE}/time-entries`, () =>
          HttpResponse.json(buildEntry(4, 5, { updatedAt: later(1) }), { status: 201 }),
        ),
      )

      await s.createEntry(KEY, newEntry)

      expect(ids(await s.getAllEntries(KEY))).toEqual([1, 2, 3, 4])
      expect(calls).toEqual([])
    })

    it('replace an updated entry in the list', async () => {
      const s = await loaded()
      server.use(
        http.put(`${BASE}/time-entries/2`, () =>
          HttpResponse.json(buildEntry(2, 5, { comment: 'saved', updatedAt: later(1) })),
        ),
      )

      await s.updateEntry(KEY, 2, newEntry)

      const entries = await s.getAllEntries(KEY)
      expect(entries.find((e) => e.id === 2)?.comment).toBe('saved')
      expect(calls).toEqual([])
    })

    it('drop a deleted entry from the list', async () => {
      const s = await loaded()
      server.use(http.delete(`${BASE}/time-entries/2`, () => HttpResponse.json({})))

      await s.deleteEntry(KEY, 2)

      expect(ids(await s.getAllEntries(KEY))).toEqual([1, 3])
      expect(calls).toEqual([])
    })

    it.each([
      ['update', (s: ReturnType<typeof service>) => s.updateEntry(KEY, 2, newEntry)],
      ['delete', (s: ReturnType<typeof service>) => s.deleteEntry(KEY, 2)],
    ])('drop an entry Memtime no longer has when an %s answers 404', async (_, run) => {
      const s = await loaded()
      server.use(
        http.put(`${BASE}/time-entries/2`, () => HttpResponse.json({}, { status: 404 })),
        http.delete(`${BASE}/time-entries/2`, () =>
          HttpResponse.json({}, { status: 404 }),
        ),
      )

      await expect(run(s)).rejects.toMatchObject({ status: 404 })

      expect(ids(await s.getAllEntries(KEY))).toEqual([1, 3])
    })

    it('check Memtime on the next read when the saved entry sent back is incomplete', async () => {
      const s = await loaded()
      server.use(
        http.post(`${BASE}/time-entries`, () =>
          HttpResponse.json({ id: 4 }, { status: 201 }),
        ),
      )

      await expect(s.createEntry(KEY, newEntry)).resolves.toEqual({ id: 4 })
      await s.getAllEntries(KEY)

      expect(calls).toEqual(['updatedAt:desc:0:100', 'id:asc:2:2'])
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

    it('passes a 502 on during a check of a loaded list', async () => {
      vi.spyOn(logger, 'warn').mockImplementation(vi.fn())
      mockList()
      const s = service()
      await s.getAllEntries(KEY)

      server.use(
        http.get(`${BASE}/time-entries`, () => HttpResponse.json({}, { status: 500 })),
      )
      clock += FRESH_MS

      await expect(s.getAllEntries(KEY)).rejects.toMatchObject({ status: 502 })
      vi.restoreAllMocks()
    })

    it('lets a new read start after a failed one settles', async () => {
      server.use(
        http.get(`${BASE}/time-entries`, () => HttpResponse.json({}, { status: 429 })),
      )
      const s = service()
      await expect(s.getAllEntries(KEY)).rejects.toBeDefined()

      mockList()

      await expect(s.getAllEntries(KEY)).resolves.toHaveLength(3)
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

    // Loads the list, then makes the write answer with `answer`.
    async function writeAfterLoading(name: string, answer: () => Response) {
      mockList()
      const s = service()
      await s.getAllEntries(KEY)
      const { method, url, run } = writes[name]!
      server.use(http[method](url, answer))
      const error = await run(s).catch((e: unknown) => e)
      return { s, error }
    }

    // The first read plus, when checked, the changes and the count.
    const CHECKED = 3

    beforeEach(() => {
      vi.spyOn(logger, 'error').mockImplementation(vi.fn())
      vi.spyOn(logger, 'warn').mockImplementation(vi.fn())
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('checks Memtime on the next read after a network error on create', async () => {
      const { s, error } = await writeAfterLoading('create', () => HttpResponse.error())

      expect(error).toMatchObject({
        status: 502,
        message: "Couldn't reach Memtime. Please try again.",
      })
      await s.getAllEntries(KEY)
      expect(calls).toHaveLength(CHECKED)
    })

    it.each(['create', 'update', 'delete'])(
      'checks Memtime on the next read after a 500 on %s',
      async (name) => {
        const { s, error } = await writeAfterLoading(name, () =>
          HttpResponse.json({ error: 'x' }, { status: 500 }),
        )

        expect(error).toMatchObject({ status: 502 })
        await s.getAllEntries(KEY)
        expect(calls).toHaveLength(CHECKED)
      },
    )

    it.each(['create', 'update', 'delete'])(
      'keeps the list after a 429 on %s',
      async (name) => {
        const { s, error } = await writeAfterLoading(name, () =>
          HttpResponse.json({}, { status: 429 }),
        )

        expect(error).toMatchObject({ status: 429 })
        await s.getAllEntries(KEY)
        expect(calls).toHaveLength(1)
      },
    )

    it.each(['create', 'update', 'delete'])(
      'keeps the list after a 404 on %s',
      async (name) => {
        const { s, error } = await writeAfterLoading(name, () =>
          HttpResponse.json({ error: 'x' }, { status: 404 }),
        )

        expect(error).toMatchObject({ status: 404 })
        await s.getAllEntries(KEY)
        expect(calls).toHaveLength(1)
      },
    )

    it.each(['create', 'update', 'delete'])(
      'keeps the list after a 401 on %s',
      async (name) => {
        const { s, error } = await writeAfterLoading(
          name,
          () => new HttpResponse('no', { status: 401 }),
        )

        expect(error).toBeInstanceOf(MemtimeKeyRejectedError)
        await s.getAllEntries(KEY)
        expect(calls).toHaveLength(1)
      },
    )

    it.each([
      ['the circuit is open', () => Promise.reject(new CircuitOpenError(30))],
      [
        'our own rate-limit check refuses',
        () => Promise.reject(new RateLimitedError(30)),
      ],
    ])('keeps the list when %s, since nothing was sent', async (_, refuse) => {
      mockList()
      const real = createMemtimeClient({ memtimeApiUrl: BASE })
      const s = createTimeEntryService({
        client: { ...real, post: refuse, put: refuse, delete: refuse },
        cache,
        freshMs: FRESH_MS,
        now: () => clock,
      })
      await s.getAllEntries(KEY)

      for (const { run } of Object.values(writes)) await run(s).catch(() => undefined)

      await s.getAllEntries(KEY)
      expect(calls).toHaveLength(1)
    })
  })
})
