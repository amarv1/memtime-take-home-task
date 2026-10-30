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
