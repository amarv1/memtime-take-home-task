import { http, HttpResponse } from 'msw'
import request from 'supertest'
import { createApp } from '../../src/app.ts'
import { loadEnv } from '../../src/env.ts'
import { createSessionStore } from '../../src/sessions/sessionStore.ts'
import { server } from '../support/server.ts'
import { buildEntry, page } from './support.ts'

const BASE = 'https://upstream.test/api/v1'
const KEY = 'secret-key-123'

interface Body {
  items: { id: number; taskId: number }[]
  total: number
  limit: number
  offset: number
  error: string
}
const json = (res: { body: unknown }) => res.body as Body

describe('GET /api/tasks/:taskId/entries', () => {
  const store = createSessionStore({ ttlMs: 60_000 })
  afterAll(() => store.stop())

  // A new app per test, so no test sees another's cached entries.
  let app: ReturnType<typeof createApp>
  beforeEach(() => {
    app = createApp({ env: loadEnv({ MEMTIME_API_URL: BASE }), sessionStore: store })
  })

  const cookie = (key = KEY) => `memtime_sid=${store.create(key).id}`
  let upstreamCalls: { auth: string | null }[]

  function mockEntries(byKey: Record<string, ReturnType<typeof buildEntry>[]>) {
    upstreamCalls = []
    server.use(
      http.get(`${BASE}/time-entries`, ({ request }) => {
        const auth = request.headers.get('authorization')
        upstreamCalls.push({ auth })
        const key = auth?.replace('Bearer ', '') ?? ''
        return HttpResponse.json(page(byKey[key] ?? [], new URL(request.url)))
      }),
    )
  }

  // Task 5 has entries 1-30 (a later id starts later), task 6 has two.
  const entries = [
    ...Array.from({ length: 30 }, (_, i) => buildEntry(i + 1, 5)),
    buildEntry(31, 6),
    buildEntry(32, 6),
  ]

  it('answers 401 without a session and makes no upstream call', async () => {
    mockEntries({ [KEY]: entries })

    const res = await request(app).get('/api/tasks/5/entries')

    expect(res.status).toBe(401)
    expect(upstreamCalls).toHaveLength(0)
  })

  it('returns one task’s entries, newest start first, with defaults', async () => {
    mockEntries({ [KEY]: entries })

    const res = await request(app).get('/api/tasks/5/entries').set('Cookie', cookie())

    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('private, no-store')
    expect(json(res)).toMatchObject({ total: 30, limit: 25, offset: 0 })
    expect(json(res).items).toHaveLength(25)
    expect(json(res).items.every((e) => !('userId' in e))).toBe(true)
    expect(
      json(res)
        .items.map((e) => e.id)
        .slice(0, 3),
    ).toEqual([30, 29, 28])
    expect(json(res).items.every((e) => e.taskId === 5)).toBe(true)
  })

  it('pages with limit and offset, keeping the total', async () => {
    mockEntries({ [KEY]: entries })

    const res = await request(app)
      .get('/api/tasks/5/entries?limit=10&offset=25')
      .set('Cookie', cookie())

    expect(json(res).total).toBe(30)
    expect(json(res).items.map((e) => e.id)).toEqual([5, 4, 3, 2, 1])
    expect(json(res)).toMatchObject({ limit: 10, offset: 25 })
  })

  it('returns an empty list past the end and for an unknown task', async () => {
    mockEntries({ [KEY]: entries })

    const past = await request(app)
      .get('/api/tasks/5/entries?offset=100')
      .set('Cookie', cookie())
    const unknown = await request(app)
      .get('/api/tasks/999/entries')
      .set('Cookie', cookie())

    expect(json(past)).toMatchObject({ items: [], total: 30 })
    expect(json(unknown)).toEqual({ items: [], total: 0, limit: 25, offset: 0 })
  })

  it('loads upstream once for repeated reads and for sessions of the same key', async () => {
    mockEntries({ [KEY]: entries })

    await request(app).get('/api/tasks/5/entries').set('Cookie', cookie())
    await request(app).get('/api/tasks/6/entries').set('Cookie', cookie())

    expect(upstreamCalls).toHaveLength(1)
  })

  it('keeps a separate cache per key', async () => {
    mockEntries({
      'key-a': [buildEntry(1, 5)],
      'key-b': [buildEntry(2, 5), buildEntry(3, 5)],
    })

    const a = await request(app)
      .get('/api/tasks/5/entries')
      .set('Cookie', cookie('key-a'))
    const b = await request(app)
      .get('/api/tasks/5/entries')
      .set('Cookie', cookie('key-b'))

    expect(json(a).total).toBe(1)
    expect(json(b).total).toBe(2)
  })

  it.each([
    ['limit=0', 'limit'],
    ['limit=101', 'limit'],
    ['limit=abc', 'limit'],
    ['limit=2.5', 'limit'],
    ['limit=-1', 'limit'],
    ['limit=1&limit=2', 'limit'],
    ['offset=-1', 'offset'],
    ['offset=x', 'offset'],
    ['offset=1.5', 'offset'],
  ])('answers 400 for %s', async (query, name) => {
    mockEntries({ [KEY]: entries })

    const res = await request(app)
      .get(`/api/tasks/5/entries?${query}`)
      .set('Cookie', cookie())

    expect(res.status).toBe(400)
    expect(json(res).error).toContain(`Invalid ${name}`)
    expect(upstreamCalls).toHaveLength(0)
  })

  it.each(['abc', '0', '007', '-1'])('answers 400 for task id %s', async (id) => {
    mockEntries({ [KEY]: entries })

    const res = await request(app).get(`/api/tasks/${id}/entries`).set('Cookie', cookie())

    expect(res.status).toBe(400)
    expect(json(res)).toEqual({ error: 'Invalid task id' })
  })

  it('passes a 429 on with retry-after', async () => {
    server.use(
      http.get(`${BASE}/time-entries`, () =>
        HttpResponse.json(
          { error: 'x' },
          { status: 429, headers: { 'retry-after': '30' } },
        ),
      ),
    )

    const res = await request(app).get('/api/tasks/5/entries').set('Cookie', cookie())

    expect(res.status).toBe(429)
    expect(res.headers['retry-after']).toBe('30')
    expect(json(res).error).toMatch(/try again/i)
  })

  it('ends the session when upstream rejects the key', async () => {
    const id = store.create(KEY).id
    server.use(
      http.get(`${BASE}/time-entries`, () => new HttpResponse('no', { status: 401 })),
    )

    const res = await request(app)
      .get('/api/tasks/5/entries')
      .set('Cookie', `memtime_sid=${id}`)

    expect(res.status).toBe(401)
    expect(store.get(id)).toBeUndefined()
  })

  it('does not clash with the task lookup proxy', async () => {
    mockEntries({ [KEY]: entries })
    server.use(http.get(`${BASE}/tasks/:id`, () => HttpResponse.json({ id: 5 })))

    const res = await request(app).get('/api/tasks/5').set('Cookie', cookie())

    expect(json(res)).toEqual({ id: 5 })
    expect(upstreamCalls).toHaveLength(0)
  })
})

describe('POST /api/tasks/:taskId/entries', () => {
  const store = createSessionStore({ ttlMs: 60_000 })
  afterAll(() => store.stop())

  let app: ReturnType<typeof createApp>
  beforeEach(() => {
    app = createApp({ env: loadEnv({ MEMTIME_API_URL: BASE }), sessionStore: store })
  })

  const cookie = () => `memtime_sid=${store.create(KEY).id}`
  const valid = {
    comment: 'Fix the header',
    start: '2025-01-01T09:00:00Z',
    end: '2025-01-01T10:00:00+00:00',
  }
  let posted: unknown[]
  let listCalls: number

  function mockUpstream(respond?: () => Response) {
    posted = []
    listCalls = 0
    server.use(
      http.get(`${BASE}/time-entries`, ({ request }) => {
        listCalls++
        return HttpResponse.json(page([], new URL(request.url)))
      }),
      http.post(`${BASE}/time-entries`, async ({ request }) => {
        posted.push({
          auth: request.headers.get('authorization'),
          ...((await request.json()) as object),
        })
        return (
          respond?.() ??
          HttpResponse.json(
            { id: 77, userId: 1, ...(posted[0] as object) },
            { status: 201 },
          )
        )
      }),
    )
  }

  it('answers 401 without a session and posts nothing', async () => {
    mockUpstream()

    const res = await request(app).post('/api/tasks/5/entries').send(valid)

    expect(res.status).toBe(401)
    expect(posted).toHaveLength(0)
  })

  it('creates the entry upstream for the task in the URL and answers 201', async () => {
    mockUpstream()

    const res = await request(app)
      .post('/api/tasks/5/entries')
      .set('Cookie', cookie())
      .send({ ...valid, taskId: 999, userId: 3 })

    expect(res.status).toBe(201)
    expect(res.headers['cache-control']).toBe('private, no-store')
    expect((res.body as { id: number }).id).toBe(77)
    expect(res.body).not.toHaveProperty('userId')
    expect(posted).toEqual([
      {
        auth: `Bearer ${KEY}`,
        taskId: 5,
        comment: 'Fix the header',
        start: '2025-01-01T09:00:00.000Z',
        end: '2025-01-01T10:00:00.000Z',
      },
    ])
  })

  it('makes the next read load fresh entries', async () => {
    mockUpstream()
    await request(app).get('/api/tasks/5/entries').set('Cookie', cookie())

    await request(app).post('/api/tasks/5/entries').set('Cookie', cookie()).send(valid)
    await request(app).get('/api/tasks/5/entries').set('Cookie', cookie())

    expect(listCalls).toBe(2)
  })

  it.each([
    [
      'a missing comment',
      { ...valid, comment: undefined },
      'Invalid comment: is required',
    ],
    ['a blank comment', { ...valid, comment: '   ' }, 'Invalid comment: is required'],
    [
      'a long comment',
      { ...valid, comment: 'x'.repeat(1001) },
      'Invalid comment: must be at most 1000 characters',
    ],
    ['a missing start', { ...valid, start: undefined }, 'Invalid start: is required'],
    [
      'a start that is not a date',
      { ...valid, start: 'tomorrow' },
      'Invalid start: must be an ISO 8601 date and time',
    ],
    [
      'an end without a time zone',
      { ...valid, end: '2025-01-01T10:00:00' },
      'Invalid end: must be an ISO 8601 date and time',
    ],
    [
      'an end before the start',
      { ...valid, end: valid.start },
      'Invalid end: must be after start',
    ],
  ])('answers 400 for %s without calling upstream', async (_name, body, error) => {
    mockUpstream()

    const res = await request(app)
      .post('/api/tasks/5/entries')
      .set('Cookie', cookie())
      .send(body)

    expect(res.status).toBe(400)
    expect(json(res).error).toBe(error)
    expect(posted).toHaveLength(0)
  })

  it('answers 400 for an invalid task id', async () => {
    mockUpstream()

    const res = await request(app)
      .post('/api/tasks/abc/entries')
      .set('Cookie', cookie())
      .send(valid)

    expect(res.status).toBe(400)
    expect(json(res).error).toBe('Invalid task id')
  })

  it.each([
    [400, 400, 'Memtime did not accept this time entry.'],
    [404, 404, 'Task not found'],
    [500, 502, 'Memtime could not save the time entry.'],
  ])('maps upstream %i to %i', async (upstream, status, error) => {
    mockUpstream(() => HttpResponse.json({ error: 'raw' }, { status: upstream }))

    const res = await request(app)
      .post('/api/tasks/5/entries')
      .set('Cookie', cookie())
      .send(valid)

    expect(res.status).toBe(status)
    expect(json(res).error).toBe(error)
  })

  it('passes a rate limit on with its Retry-After', async () => {
    mockUpstream(() =>
      HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '30' } }),
    )

    const res = await request(app)
      .post('/api/tasks/5/entries')
      .set('Cookie', cookie())
      .send(valid)

    expect(res.status).toBe(429)
    expect(res.headers['retry-after']).toBe('30')
  })

  it('answers 502 when upstream sends an unexpected body', async () => {
    mockUpstream(() => HttpResponse.text('created', { status: 201 }))

    const res = await request(app)
      .post('/api/tasks/5/entries')
      .set('Cookie', cookie())
      .send(valid)

    expect(res.status).toBe(502)
  })
})

describe('/api/tasks/:taskId/entries/:entryId', () => {
  const store = createSessionStore({ ttlMs: 60_000 })
  afterAll(() => store.stop())

  let app: ReturnType<typeof createApp>
  beforeEach(() => {
    app = createApp({ env: loadEnv({ MEMTIME_API_URL: BASE }), sessionStore: store })
  })

  const cookie = () => `memtime_sid=${store.create(KEY).id}`
  const valid = {
    comment: 'Fix the header',
    start: '2025-01-01T09:00:00Z',
    end: '2025-01-01T10:00:00Z',
  }
  const entries = [buildEntry(0, 5), buildEntry(1, 5), buildEntry(2, 6)]
  let put: { id: string; auth: string | null; body: unknown }[]
  let listCalls: number

  function mockUpstream(respond?: () => Response) {
    put = []
    listCalls = 0
    server.use(
      http.get(`${BASE}/time-entries`, ({ request }) => {
        listCalls++
        return HttpResponse.json(page(entries, new URL(request.url)))
      }),
      http.put(`${BASE}/time-entries/:id`, async ({ request, params }) => {
        put.push({
          id: String(params.id),
          auth: request.headers.get('authorization'),
          body: await request.json(),
        })
        return respond?.() ?? HttpResponse.json({ ...buildEntry(1, 5), ...valid })
      }),
    )
  }

  describe('GET', () => {
    it('answers 401 without a session', async () => {
      mockUpstream()
      expect((await request(app).get('/api/tasks/5/entries/1')).status).toBe(401)
    })

    it('returns the entry from the cached list', async () => {
      mockUpstream()

      const res = await request(app).get('/api/tasks/5/entries/1').set('Cookie', cookie())
      await request(app).get('/api/tasks/5/entries/1').set('Cookie', cookie())

      expect(res.status).toBe(200)
      expect(res.headers['cache-control']).toBe('private, no-store')
      expect((res.body as { id: number }).id).toBe(1)
      expect(res.body).not.toHaveProperty('userId')
      expect(listCalls).toBe(1)
    })

    it('returns the entry with id 0', async () => {
      mockUpstream()
      const res = await request(app).get('/api/tasks/5/entries/0').set('Cookie', cookie())
      expect(res.status).toBe(200)
      expect((res.body as { id: number }).id).toBe(0)
    })

    it.each(['/api/tasks/5/entries/2', '/api/tasks/5/entries/99'])(
      'answers 404 for %s (another task’s or unknown)',
      async (url) => {
        mockUpstream()
        const res = await request(app).get(url).set('Cookie', cookie())
        expect(res.status).toBe(404)
        expect(json(res).error).toBe('Time entry not found')
      },
    )

    it('answers 400 for an invalid entry id', async () => {
      mockUpstream()
      const res = await request(app).get('/api/tasks/5/entries/x').set('Cookie', cookie())
      expect(res.status).toBe(400)
      expect(json(res).error).toBe('Invalid entry id')
    })
  })

  describe('PUT', () => {
    it('answers 401 without a session and puts nothing', async () => {
      mockUpstream()
      const res = await request(app).put('/api/tasks/5/entries/1').send(valid)
      expect(res.status).toBe(401)
      expect(put).toHaveLength(0)
    })

    it('updates the entry upstream, keeping it on the URL’s task', async () => {
      mockUpstream()

      const res = await request(app)
        .put('/api/tasks/5/entries/1')
        .set('Cookie', cookie())
        .send({ ...valid, taskId: 999 })

      expect(res.status).toBe(200)
      expect(res.headers['cache-control']).toBe('private, no-store')
      expect(res.body).not.toHaveProperty('userId')
      expect(put).toEqual([
        {
          id: '1',
          auth: `Bearer ${KEY}`,
          body: {
            taskId: 5,
            comment: 'Fix the header',
            start: '2025-01-01T09:00:00.000Z',
            end: '2025-01-01T10:00:00.000Z',
          },
        },
      ])
    })

    it('makes the next read load fresh entries', async () => {
      mockUpstream()
      await request(app).get('/api/tasks/5/entries').set('Cookie', cookie())

      await request(app).put('/api/tasks/5/entries/1').set('Cookie', cookie()).send(valid)
      await request(app).get('/api/tasks/5/entries').set('Cookie', cookie())

      expect(listCalls).toBe(2)
    })

    it('updates the entry with id 0', async () => {
      mockUpstream()
      const res = await request(app)
        .put('/api/tasks/5/entries/0')
        .set('Cookie', cookie())
        .send(valid)
      expect(res.status).toBe(200)
      expect(put[0]?.id).toBe('0')
    })

    it.each(['/api/tasks/5/entries/2', '/api/tasks/5/entries/99'])(
      'answers 404 for %s without calling put',
      async (url) => {
        mockUpstream()
        const res = await request(app).put(url).set('Cookie', cookie()).send(valid)
        expect(res.status).toBe(404)
        expect(put).toHaveLength(0)
      },
    )

    it('answers 400 for invalid input without calling upstream', async () => {
      mockUpstream()
      const res = await request(app)
        .put('/api/tasks/5/entries/1')
        .set('Cookie', cookie())
        .send({ ...valid, end: valid.start })
      expect(res.status).toBe(400)
      expect(json(res).error).toBe('Invalid end: must be after start')
      expect(put).toHaveLength(0)
    })

    it.each([
      [400, 400, 'Memtime did not accept this time entry.'],
      [404, 404, 'Time entry not found'],
      [500, 502, 'Memtime could not save the time entry.'],
    ])('maps upstream %i to %i', async (upstream, status, error) => {
      mockUpstream(() => HttpResponse.json({ error: 'raw' }, { status: upstream }))
      const res = await request(app)
        .put('/api/tasks/5/entries/1')
        .set('Cookie', cookie())
        .send(valid)
      expect(res.status).toBe(status)
      expect(json(res).error).toBe(error)
    })

    it('passes a rate limit on with its Retry-After', async () => {
      mockUpstream(() =>
        HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '30' } }),
      )
      const res = await request(app)
        .put('/api/tasks/5/entries/1')
        .set('Cookie', cookie())
        .send(valid)
      expect(res.status).toBe(429)
      expect(res.headers['retry-after']).toBe('30')
    })
  })
})

describe('DELETE /api/tasks/:taskId/entries/:entryId', () => {
  const store = createSessionStore({ ttlMs: 60_000 })
  afterAll(() => store.stop())

  let app: ReturnType<typeof createApp>
  beforeEach(() => {
    app = createApp({ env: loadEnv({ MEMTIME_API_URL: BASE }), sessionStore: store })
  })

  const cookie = () => `memtime_sid=${store.create(KEY).id}`
  const entries = [buildEntry(0, 5), buildEntry(1, 5), buildEntry(2, 6)]
  let deleted: { id: string; auth: string | null }[]
  let listCalls: number

  function mockUpstream(respond?: () => Response) {
    deleted = []
    listCalls = 0
    server.use(
      http.get(`${BASE}/time-entries`, ({ request }) => {
        listCalls++
        return HttpResponse.json(page(entries, new URL(request.url)))
      }),
      http.delete(`${BASE}/time-entries/:id`, ({ request, params }) => {
        deleted.push({
          id: String(params.id),
          auth: request.headers.get('authorization'),
        })
        return (
          respond?.() ?? HttpResponse.json({ message: 'Time entry deleted successfully' })
        )
      }),
    )
  }

  it('answers 401 without a session and deletes nothing', async () => {
    mockUpstream()
    const res = await request(app).delete('/api/tasks/5/entries/1')
    expect(res.status).toBe(401)
    expect(deleted).toHaveLength(0)
  })

  it.each(['1', '0'])('deletes entry %s upstream and answers 204', async (id) => {
    mockUpstream()

    const res = await request(app)
      .delete(`/api/tasks/5/entries/${id}`)
      .set('Cookie', cookie())

    expect(res.status).toBe(204)
    expect(deleted).toEqual([{ id, auth: `Bearer ${KEY}` }])
  })

  it('makes the next read load fresh entries', async () => {
    mockUpstream()
    await request(app).get('/api/tasks/5/entries').set('Cookie', cookie())

    await request(app).delete('/api/tasks/5/entries/1').set('Cookie', cookie())
    await request(app).get('/api/tasks/5/entries').set('Cookie', cookie())

    expect(listCalls).toBe(2)
  })

  it.each(['/api/tasks/5/entries/2', '/api/tasks/5/entries/99'])(
    'answers 404 for %s (another task’s or unknown) without deleting',
    async (url) => {
      mockUpstream()
      const res = await request(app).delete(url).set('Cookie', cookie())
      expect(res.status).toBe(404)
      expect(deleted).toHaveLength(0)
    },
  )

  it('answers 400 for an invalid entry id', async () => {
    mockUpstream()
    const res = await request(app)
      .delete('/api/tasks/5/entries/x')
      .set('Cookie', cookie())
    expect(res.status).toBe(400)
    expect(deleted).toHaveLength(0)
  })

  it.each([
    [404, 404, 'Time entry not found'],
    [500, 502, 'Memtime could not delete the time entry.'],
  ])('maps upstream %i to %i', async (upstream, status, error) => {
    mockUpstream(() => HttpResponse.json({ error: 'raw' }, { status: upstream }))
    const res = await request(app)
      .delete('/api/tasks/5/entries/1')
      .set('Cookie', cookie())
    expect(res.status).toBe(status)
    expect((res.body as { error: string }).error).toBe(error)
  })

  it('passes a rate limit on with its Retry-After', async () => {
    mockUpstream(() =>
      HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '30' } }),
    )
    const res = await request(app)
      .delete('/api/tasks/5/entries/1')
      .set('Cookie', cookie())
    expect(res.status).toBe(429)
    expect(res.headers['retry-after']).toBe('30')
  })
})
