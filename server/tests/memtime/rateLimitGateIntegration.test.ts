import { http, HttpResponse } from 'msw'
import request from 'supertest'
import { createApp } from '../../src/app.ts'
import { loadEnv } from '../../src/env.ts'
import { logger } from '../../src/logger.ts'
import { createMemtimeClient } from '../../src/memtime/memtimeClient.ts'
import { createRateLimitGate } from '../../src/memtime/rateLimitGate.ts'
import { createSessionStore } from '../../src/sessions/sessionStore.ts'
import { server } from '../support/server.ts'

const BASE = 'https://upstream.test/api/v1'
const KEY = 'secret-key-123'

const limitHeaders = (remaining: number) => ({
  'ratelimit-limit': '15',
  'ratelimit-remaining': String(remaining),
  'ratelimit-reset': '42',
  'ratelimit-policy': '15;w=60',
})

describe('Memtime rate-limit gate through the app', () => {
  const store = createSessionStore({ ttlMs: 60_000 })
  afterAll(() => store.stop())

  // The app's client and gate, built the way createApp builds them, so the test can also call the client.
  const build = () => {
    const gate = createRateLimitGate()
    const client = createMemtimeClient({ memtimeApiUrl: BASE, gate })
    const app = createApp({
      env: loadEnv({ MEMTIME_API_URL: BASE, COOKIE_SECURE: 'false' }),
      sessionStore: store,
      rateLimitGate: gate,
      memtimeClient: client,
    })
    return { app, client }
  }
  const cookie = () => `memtime_sid=${store.create(KEY).id}`

  beforeEach(() => {
    vi.spyOn(logger, 'warn').mockImplementation(vi.fn())
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('blocks a tree read at 2 remaining without calling Memtime, but lets a write through', async () => {
    const calls = { reads: 0, writes: 0 }
    server.use(
      http.get(`${BASE}/clients`, () => {
        calls.reads += 1
        return HttpResponse.json([], { headers: limitHeaders(2) })
      }),
      http.post(`${BASE}/time-entries`, () => {
        calls.writes += 1
        return HttpResponse.json({ id: 1 }, { status: 201, headers: limitHeaders(1) })
      }),
    )
    const { app, client } = build()
    const session = cookie()

    await request(app).get('/api/clients').set('Cookie', session).expect(200)
    // Another page, since the first one is now cached.
    const blocked = await request(app)
      .get('/api/clients?offset=100')
      .set('Cookie', session)

    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({
      error: 'Memtime is receiving too many requests.',
    })
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1)
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(42)
    expect(calls.reads).toBe(1)

    const write = await client.post(
      KEY,
      '/time-entries',
      {},
      '/api/tasks/:taskId/entries',
    )
    expect(write.status).toBe(201)
    expect(calls.writes).toBe(1)
  })

  it('lets a save through at 2 remaining, the reads of its checks included', async () => {
    const calls = { tasks: 0, writes: 0 }
    server.use(
      http.get(`${BASE}/time-entries`, () =>
        HttpResponse.json([], { headers: limitHeaders(2) }),
      ),
      http.get(`${BASE}/clients`, () => HttpResponse.json([])),
      http.get(`${BASE}/tasks/:id`, ({ params }) => {
        calls.tasks += 1
        return HttpResponse.json(
          { id: Number(params.id), status: 'in-progress' },
          { headers: limitHeaders(1) },
        )
      }),
      http.post(`${BASE}/time-entries`, () => {
        calls.writes += 1
        return HttpResponse.json(
          { id: 1, taskId: 5, comment: '', start: hoursAgo(3), end: hoursAgo(2) },
          { status: 201, headers: limitHeaders(0) },
        )
      }),
    )
    const { app } = build()
    const session = cookie()

    // Loads and caches the entries; the budget is now down to the reserve.
    await request(app).get('/api/tasks/5/entries').set('Cookie', session).expect(200)
    await request(app).get('/api/clients').set('Cookie', session).expect(429)

    const saved = await request(app)
      .post('/api/tasks/5/entries')
      .set('Cookie', session)
      .send({ comment: 'Fix the header', start: hoursAgo(3), end: hoursAgo(2) })

    expect(saved.status).toBe(201)
    expect(calls).toEqual({ tasks: 1, writes: 1 })
  })
})

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString()
}
