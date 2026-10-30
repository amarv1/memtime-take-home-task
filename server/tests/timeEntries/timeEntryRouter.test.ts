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
    app = createApp({
      env: loadEnv({ MEMTIME_API_URL: BASE, MEMTIME_BREAKER_THRESHOLD: '1000' }),
      sessionStore: store,
    })
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
    expect(json(res).error).toMatch(/too many requests/i)
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

const HOUR = 3_600_000
/** An ISO time this many hours before now. The rules compare with the real clock. */
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString()

describe('POST /api/tasks/:taskId/entries', () => {
  const store = createSessionStore({ ttlMs: 60_000 })
  afterAll(() => store.stop())

  let app: ReturnType<typeof createApp>
  beforeEach(() => {
    app = createApp({
      env: loadEnv({ MEMTIME_API_URL: BASE, MEMTIME_BREAKER_THRESHOLD: '1000' }),
      sessionStore: store,
    })
  })

  const cookie = () => `memtime_sid=${store.create(KEY).id}`
  const valid = { comment: 'Fix the header', start: hoursAgo(3), end: hoursAgo(2) }
  let posted: unknown[]
  let listCalls: number
  let taskCalls: number

  function mockUpstream(
    respond?: () => Response,
    options: { entries?: ReturnType<typeof buildEntry>[]; taskStatus?: string } = {},
  ) {
    const { entries = [], taskStatus = 'active' } = options
    posted = []
    listCalls = 0
    taskCalls = 0
    server.use(
      http.get(`${BASE}/time-entries`, ({ request }) => {
        listCalls++
        return HttpResponse.json(page(entries, new URL(request.url)))
      }),
      http.get(`${BASE}/tasks/:id`, ({ params }) => {
        taskCalls++
        return HttpResponse.json({ id: Number(params.id), status: taskStatus })
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

  const create = (body: object) =>
    request(app).post('/api/tasks/5/entries').set('Cookie', cookie()).send(body)

  it('answers 401 without a session and posts nothing', async () => {
    mockUpstream()

    const res = await request(app).post('/api/tasks/5/entries').send(valid)

    expect(res.status).toBe(401)
    expect(posted).toHaveLength(0)
  })

  it('creates the entry upstream for the task in the URL and answers 201', async () => {
    mockUpstream()

    const res = await create({
      ...valid,
      comment: ' Fix the header ',
      taskId: 999,
      userId: 3,
    })

    expect(res.status).toBe(201)
    expect(res.headers['cache-control']).toBe('private, no-store')
    expect((res.body as { id: number }).id).toBe(77)
    expect(res.body).not.toHaveProperty('userId')
    expect(posted).toEqual([
      {
        auth: `Bearer ${KEY}`,
        taskId: 5,
        comment: 'Fix the header',
        start: valid.start,
        end: valid.end,
      },
    ])
  })

  it('sends times as exact UTC instants, keeping seconds and milliseconds', async () => {
    mockUpstream()
    const start = new Date(Date.now() - 3 * HOUR)
    start.setMilliseconds(123)
    const end = new Date(start.getTime() + HOUR)

    await create({
      ...valid,
      start: start.toISOString().replace('Z', '+00:00'),
      end: end.toISOString(),
    })

    expect(posted).toMatchObject([{ start: start.toISOString(), end: end.toISOString() }])
  })

  it('makes the next read load fresh entries', async () => {
    mockUpstream()
    await request(app).get('/api/tasks/5/entries').set('Cookie', cookie())

    await create(valid)
    await request(app).get('/api/tasks/5/entries').set('Cookie', cookie())

    expect(listCalls).toBe(2)
  })

  it.each([
    [
      'a missing comment',
      { ...valid, comment: undefined },
      'Invalid comment: is required',
    ],
    ['a missing start', { ...valid, start: undefined }, 'Invalid start: is required'],
    [
      'accepted warnings that are not a list',
      { ...valid, acceptedWarnings: 'overlap' },
      'Invalid acceptedWarnings: must be a list',
    ],
  ])('answers 400 for %s without calling upstream', async (_name, body, error) => {
    mockUpstream()

    const res = await create(body)

    expect(res.status).toBe(400)
    expect(json(res).error).toBe(error)
    expect(posted).toHaveLength(0)
    expect(listCalls + taskCalls).toBe(0)
  })

  it.each([
    ['a blank comment', { ...valid, comment: '   ' }, 'comment_required', 'comment'],
    [
      'a long comment',
      { ...valid, comment: 'x'.repeat(501) },
      'comment_too_long',
      'comment',
    ],
    [
      'a start that is not a date',
      { ...valid, start: 'tomorrow' },
      'invalid_start',
      'start',
    ],
    [
      'an end without a time zone',
      { ...valid, end: '2025-01-01T10:00:00' },
      'invalid_end',
      'end',
    ],
    [
      'an end equal to the start',
      { ...valid, end: valid.start },
      'end_not_after_start',
      'end',
    ],
    [
      'an entry over 24 hours',
      { ...valid, start: hoursAgo(30), end: hoursAgo(5) },
      'too_long',
      'end',
    ],
    [
      'an end in the future',
      { ...valid, start: hoursAgo(1), end: hoursAgo(-1) },
      'in_future',
      'end',
    ],
    [
      'a start before the year 2000',
      { ...valid, start: '1999-12-31T22:00:00Z', end: '1999-12-31T23:00:00Z' },
      'too_early',
      'start',
    ],
  ])('answers 400 for %s without calling upstream', async (_name, body, code, field) => {
    mockUpstream()

    const res = await create(body)

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ code, field })
    expect(json(res).error).toEqual(expect.any(String))
    expect(posted).toHaveLength(0)
    expect(listCalls + taskCalls).toBe(0)
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

  describe('warnings', () => {
    // Another task's entry that shares the hour with `valid`.
    const clash = buildEntry(9, 6, { start: hoursAgo(3.5), end: hoursAgo(2.5) })

    it('answers 409 with the overlapping entries, even on another task, and posts nothing', async () => {
      mockUpstream(undefined, { entries: [clash] })

      const res = await create(valid)

      expect(res.status).toBe(409)
      expect(res.body).toMatchObject({
        error: 'Please confirm this time entry',
        warnings: [
          {
            code: 'overlap',
            entries: [{ id: 9, taskId: 6, start: clash.start, end: clash.end }],
          },
        ],
      })
      expect(JSON.stringify(res.body)).not.toContain('userId')
      expect(posted).toHaveLength(0)
    })

    it('creates the entry once the warning is accepted', async () => {
      mockUpstream(undefined, { entries: [clash] })

      const res = await create({ ...valid, acceptedWarnings: ['overlap'] })

      expect(res.status).toBe(201)
      expect(posted).toHaveLength(1)
    })

    it('answers 409 again for the warnings that are not accepted yet', async () => {
      mockUpstream(undefined, { entries: [clash], taskStatus: 'completed' })

      const res = await create({ ...valid, acceptedWarnings: ['overlap'] })

      expect(res.status).toBe(409)
      expect((res.body as { warnings: { code: string }[] }).warnings).toEqual([
        expect.objectContaining({ code: 'completed_task' }),
      ])
      expect(posted).toHaveLength(0)
    })

    it('answers 409 for a completed task', async () => {
      mockUpstream(undefined, { taskStatus: 'completed' })

      const res = await create(valid)

      expect(res.status).toBe(409)
      expect(res.body).toMatchObject({ warnings: [{ code: 'completed_task' }] })
    })

    it.each([
      ['a long entry', { start: hoursAgo(14), end: hoursAgo(1) }, 'long_duration'],
      [
        'an old start',
        { start: hoursAgo(24 * 31), end: hoursAgo(24 * 31 - 1) },
        'old_start',
      ],
    ])('answers 409 for %s', async (_name, times, code) => {
      mockUpstream()

      const res = await create({ ...valid, ...times })

      expect(res.status).toBe(409)
      expect(res.body).toMatchObject({ warnings: [{ code }] })
    })

    it('does not warn about an entry that only touches another', async () => {
      const before = buildEntry(9, 6, { start: hoursAgo(4), end: valid.start })
      mockUpstream(undefined, { entries: [before] })

      expect((await create(valid)).status).toBe(201)
    })

    it('answers 404 when the task does not exist', async () => {
      mockUpstream()
      server.use(
        http.get(`${BASE}/tasks/:id`, () =>
          HttpResponse.json({ error: 'nope' }, { status: 404 }),
        ),
      )

      const res = await create(valid)

      expect(res.status).toBe(404)
      expect(json(res).error).toBe('Task not found')
      expect(posted).toHaveLength(0)
    })

    it('looks the task up once for repeated creates', async () => {
      mockUpstream()

      await create(valid)
      await create(valid)

      expect(taskCalls).toBe(1)
    })

    it('looks up each task separately', async () => {
      mockUpstream()

      await create(valid)
      await request(app).post('/api/tasks/6/entries').set('Cookie', cookie()).send(valid)

      expect(taskCalls).toBe(2)
    })
  })

  it.each([
    [400, 400, 'Memtime did not accept this time entry: raw'],
    [404, 404, 'Task not found'],
    [500, 502, 'Memtime could not save the time entry.'],
  ])('maps upstream %i to %i', async (upstream, status, error) => {
    mockUpstream(() => HttpResponse.json({ error: 'raw' }, { status: upstream }))

    const res = await create(valid)

    expect(res.status).toBe(status)
    expect(json(res).error).toBe(error)
  })

  it.each([
    ['a body that is not JSON', () => HttpResponse.text('nope', { status: 400 })],
    ['an error that is not text', () => HttpResponse.json({ error: 1 }, { status: 400 })],
    ['a blank error', () => HttpResponse.json({ error: '  ' }, { status: 400 })],
  ])('keeps the plain 400 message for %s', async (_name, respond) => {
    mockUpstream(respond)

    const res = await create(valid)

    expect(res.status).toBe(400)
    expect(json(res).error).toBe('Memtime did not accept this time entry.')
  })

  it('passes a rate limit on with its Retry-After', async () => {
    mockUpstream(() =>
      HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '30' } }),
    )

    const res = await create(valid)

    expect(res.status).toBe(429)
    expect(res.headers['retry-after']).toBe('30')
  })

  it('answers 502 when upstream sends an unexpected body', async () => {
    mockUpstream(() => HttpResponse.text('created', { status: 201 }))

    const res = await create(valid)

    expect(res.status).toBe(502)
  })
})

describe('/api/tasks/:taskId/entries/:entryId', () => {
  const store = createSessionStore({ ttlMs: 60_000 })
  afterAll(() => store.stop())

  let app: ReturnType<typeof createApp>
  beforeEach(() => {
    app = createApp({
      env: loadEnv({ MEMTIME_API_URL: BASE, MEMTIME_BREAKER_THRESHOLD: '1000' }),
      sessionStore: store,
    })
  })

  const cookie = () => `memtime_sid=${store.create(KEY).id}`
  const valid = {
    comment: 'Fix the header',
    start: '2025-01-01T09:00:00Z',
    end: '2025-01-01T10:00:00Z',
  }
  // Entry 3 is on its own day, so it overlaps none of the others.
  const entries = [
    buildEntry(0, 5),
    buildEntry(1, 5),
    buildEntry(2, 6),
    buildEntry(3, 6, {
      start: '2025-01-02T09:00:00.000Z',
      end: '2025-01-02T10:00:00.000Z',
    }),
  ]
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

    it('answers 400 for invalid input without calling put', async () => {
      mockUpstream()
      const res = await request(app)
        .put('/api/tasks/5/entries/1')
        .set('Cookie', cookie())
        .send({ ...valid, end: valid.start })
      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({
        error: 'End must be after the start',
        code: 'end_not_after_start',
        field: 'end',
      })
      expect(put).toHaveLength(0)
    })

    it.each([
      ['a blank comment', { comment: ' ' }, 'comment_required'],
      ['a long comment', { comment: 'x'.repeat(501) }, 'comment_too_long'],
      ['an unreadable start', { start: 'soon' }, 'invalid_start'],
      ['an end in the future', { start: hoursAgo(1), end: hoursAgo(-1) }, 'in_future'],
      ['an entry over 24 hours', { end: '2025-01-03T10:00:00Z' }, 'too_long'],
    ])('answers 400 for %s', async (_name, change, code) => {
      mockUpstream()
      const res = await request(app)
        .put('/api/tasks/5/entries/1')
        .set('Cookie', cookie())
        .send({ ...valid, ...change })
      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({ code })
      expect(put).toHaveLength(0)
    })

    it('answers 200 with the entry and calls nothing when nothing changed', async () => {
      mockUpstream()
      const { comment, start, end } = entries[1]!

      const res = await request(app)
        .put('/api/tasks/5/entries/1')
        .set('Cookie', cookie())
        .send({ comment: ` ${comment} `, start: start.replace('Z', '+00:00'), end })

      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ id: 1, comment, start, end })
      expect(res.body).not.toHaveProperty('userId')
      expect(put).toHaveLength(0)
      expect(listCalls).toBe(1)
    })

    it('does not nag about warnings the original already had', async () => {
      // The seeded entries are old and overlap each other, yet only the comment changes.
      mockUpstream()
      const { start, end } = entries[1]!

      const res = await request(app)
        .put('/api/tasks/5/entries/1')
        .set('Cookie', cookie())
        .send({ comment: 'New words', start, end })

      expect(res.status).toBe(200)
      expect(put).toHaveLength(1)
    })

    it('answers 409 when the change overlaps an entry it did not overlap before', async () => {
      mockUpstream()
      const { start, end } = entries[3]!

      const res = await request(app)
        .put('/api/tasks/5/entries/1')
        .set('Cookie', cookie())
        .send({ ...valid, start, end })

      expect(res.status).toBe(409)
      expect(res.body).toMatchObject({
        error: 'Please confirm this time entry',
        warnings: [{ code: 'overlap', entries: [{ id: 3, taskId: 6 }] }],
      })
      expect(JSON.stringify(res.body)).not.toContain('userId')
      expect(put).toHaveLength(0)
    })

    it('saves the change once the warning is accepted', async () => {
      mockUpstream()
      const { start, end } = entries[3]!

      const res = await request(app)
        .put('/api/tasks/5/entries/1')
        .set('Cookie', cookie())
        .send({ ...valid, start, end, acceptedWarnings: ['overlap'] })

      expect(res.status).toBe(200)
      expect(put).toHaveLength(1)
    })

    it('does not look the task up on an edit', async () => {
      mockUpstream()
      let taskCalls = 0
      server.use(
        http.get(`${BASE}/tasks/:id`, () => {
          taskCalls++
          return HttpResponse.json({ id: 5, status: 'completed' })
        }),
      )

      const res = await request(app)
        .put('/api/tasks/5/entries/1')
        .set('Cookie', cookie())
        .send(valid)

      expect(res.status).toBe(200)
      expect(taskCalls).toBe(0)
    })

    it.each([
      [400, 400, 'Memtime did not accept this time entry: raw'],
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
    app = createApp({
      env: loadEnv({ MEMTIME_API_URL: BASE, MEMTIME_BREAKER_THRESHOLD: '1000' }),
      sessionStore: store,
    })
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
