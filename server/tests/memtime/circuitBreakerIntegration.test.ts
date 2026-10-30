import { http, HttpResponse } from 'msw'
import request from 'supertest'
import { createApp } from '../../src/app.ts'
import { loadEnv } from '../../src/env.ts'
import { logger } from '../../src/logger.ts'
import { createSessionStore } from '../../src/sessions/sessionStore.ts'
import { server } from '../support/server.ts'

const BASE = 'https://upstream.test/api/v1'
const KEY = 'secret-key-123'
const THRESHOLD = 3

describe('Memtime circuit breaker through the app', () => {
  const store = createSessionStore({ ttlMs: 60_000 })
  afterAll(() => store.stop())

  // A new app per test, so each starts with a closed circuit.
  const build = () =>
    createApp({
      env: loadEnv({
        MEMTIME_API_URL: BASE,
        COOKIE_SECURE: 'false',
        MEMTIME_BREAKER_THRESHOLD: String(THRESHOLD),
      }),
      sessionStore: store,
    })

  const cookie = () => `memtime_sid=${store.create(KEY).id}`

  /** Answers /clients with `respond` and counts the calls that reach it. */
  function upstream(respond: () => Response) {
    const calls = { count: 0 }
    server.use(
      http.get(`${BASE}/clients`, () => {
        calls.count += 1
        return respond()
      }),
    )
    return calls
  }

  const clients = (app: ReturnType<typeof build>) =>
    request(app).get('/api/clients').set('Cookie', cookie())

  beforeEach(() => {
    vi.spyOn(logger, 'error').mockImplementation(vi.fn())
    vi.spyOn(logger, 'warn').mockImplementation(vi.fn())
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['network errors', () => HttpResponse.error(), 502],
    ['500 answers', () => HttpResponse.json({ error: 'x' }, { status: 500 }), 500],
  ])('answers 503 without calling Memtime after %s', async (_label, respond, status) => {
    const app = build()
    const calls = upstream(respond)
    for (let i = 0; i < THRESHOLD; i++) await clients(app).expect(status)

    const res = await clients(app)

    expect(res.status).toBe(503)
    expect(res.body).toEqual({
      error: 'Memtime is unavailable right now. Try again in a minute.',
    })
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1)
    expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(30)
    expect(calls.count).toBe(THRESHOLD)
  })

  it.each([
    [429, '{}'],
    [404, '{}'],
    [401, 'no'],
  ])('never opens on a %i', async (status, body) => {
    const app = build()
    const calls = upstream(() => new HttpResponse(body, { status }))
    for (let i = 0; i < THRESHOLD + 2; i++) await clients(app).expect(status)

    expect(calls.count).toBe(THRESHOLD + 2)
  })

  it('is shared by sign-in and the proxy', async () => {
    const app = build()
    const calls = upstream(() => new HttpResponse('x', { status: 500 }))
    for (let i = 0; i < THRESHOLD; i++) await clients(app).expect(500)

    const res = await request(app).post('/api/session').send({ apiKey: KEY })

    expect(res.status).toBe(503)
    expect(res.headers['retry-after']).toBeDefined()
    expect(calls.count).toBe(THRESHOLD)
  })

  it('answers sign-in with 503 once failed sign-ins opened it', async () => {
    const app = build()
    const calls = upstream(() => new HttpResponse('x', { status: 500 }))
    for (let i = 0; i < THRESHOLD; i++)
      await request(app).post('/api/session').send({ apiKey: KEY }).expect(502)

    await request(app).post('/api/session').send({ apiKey: KEY }).expect(503)

    expect(calls.count).toBe(THRESHOLD)
  })
})
