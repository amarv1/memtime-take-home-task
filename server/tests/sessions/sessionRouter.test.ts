import { http, HttpResponse } from 'msw'
import request from 'supertest'
import { createApp } from '../../src/app.ts'
import { loadEnv } from '../../src/env.ts'
import { logger } from '../../src/logger.ts'
import { server } from '../support/server.ts'
import { createSessionStore } from '../../src/sessions/sessionStore.ts'

const UPSTREAM = 'https://upstream.test/api/v1'
const KEY = 'super-secret-key'

describe('session routes', () => {
  let time = 1_700_000_000_000
  const stores: ReturnType<typeof createSessionStore>[] = []

  function setup(extra: NodeJS.ProcessEnv = {}) {
    const env = loadEnv({
      MEMTIME_API_URL: UPSTREAM,
      COOKIE_SECURE: 'false',
      MEMTIME_BREAKER_THRESHOLD: '1000',
      ...extra,
    })
    const store = createSessionStore({
      ttlMs: env.SESSION_TTL_MS,
      maxSessions: env.MAX_SESSIONS,
      maxPerKey: env.MAX_SESSIONS_PER_KEY,
      now: () => time,
    })
    stores.push(store)
    return { app: createApp({ env, sessionStore: store }), store }
  }

  function upstream(status: number, onRequest?: (request: Request) => void) {
    server.use(
      http.get(`${UPSTREAM}/clients`, ({ request }) => {
        onRequest?.(request)
        return new HttpResponse(status === 200 ? '[]' : 'Unauthorized', { status })
      }),
    )
  }

  function sidOf(res: request.Response): string {
    const header =
      (res.headers['set-cookie'] as unknown as string[] | undefined)?.[0] ?? ''
    return /memtime_sid=([^;]*)/.exec(header)?.[1] ?? ''
  }

  beforeEach(() => {
    time = 1_700_000_000_000
  })
  afterEach(() => {
    stores.splice(0).forEach((s) => s.stop())
    vi.restoreAllMocks()
  })

  describe('POST /api/session', () => {
    it('answers 503 when the session store is full', async () => {
      const { app } = setup({ MAX_SESSIONS: '1' })
      upstream(200)
      await request(app).post('/api/session').send({ apiKey: 'a' }).expect(200)

      const res = await request(app).post('/api/session').send({ apiKey: 'b' })

      expect(res.status).toBe(503)
      expect(res.body).toEqual({ error: 'Too many active sessions. Try again later.' })
    })

    it('signs in with a valid key', async () => {
      const { app } = setup()
      upstream(200)

      const res = await request(app).post('/api/session').send({ apiKey: KEY })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ expiresAt: new Date(time + 3_600_000).toISOString() })
      expect(JSON.stringify(res.body)).not.toContain(KEY)
      expect(res.text).not.toContain(KEY)
    })

    it('sets a hardened cookie', async () => {
      const { app } = setup()
      upstream(200)

      const res = await request(app).post('/api/session').send({ apiKey: KEY })
      const cookie = (res.headers['set-cookie'] as unknown as string[])[0] ?? ''

      expect(cookie).toMatch(/^memtime_sid=[A-Za-z0-9_-]{43};/)
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('SameSite=Strict')
      expect(cookie).toContain('Path=/api')
      expect(cookie).toContain('Max-Age=3600')
      expect(cookie).not.toContain('Secure')
      expect(cookie).not.toContain(KEY)
    })

    it('marks the cookie Secure by default', async () => {
      const { app } = setup({ COOKIE_SECURE: undefined })
      upstream(200)

      const res = await request(app).post('/api/session').send({ apiKey: KEY })

      expect((res.headers['set-cookie'] as unknown as string[])[0]).toContain('Secure')
    })

    it('trims the key before sending it upstream', async () => {
      const { app } = setup()
      let auth: string | null = null
      upstream(200, (r) => {
        auth = r.headers.get('authorization')
      })

      await request(app)
        .post('/api/session')
        .send({ apiKey: `  ${KEY}\n` })

      expect(auth).toBe(`Bearer ${KEY}`)
    })

    it('replaces an existing session', async () => {
      const { app } = setup()
      upstream(200)
      const first = await request(app).post('/api/session').send({ apiKey: KEY })
      const oldId = sidOf(first)

      const second = await request(app)
        .post('/api/session')
        .set('Cookie', `memtime_sid=${oldId}`)
        .send({ apiKey: KEY })
      const newId = sidOf(second)

      expect(newId).not.toBe(oldId)
      const old = await request(app)
        .get('/api/session')
        .set('Cookie', `memtime_sid=${oldId}`)
      const current = await request(app)
        .get('/api/session')
        .set('Cookie', `memtime_sid=${newId}`)
      expect(old.status).toBe(401)
      expect(current.status).toBe(200)
    })

    it.each([
      ['an empty JSON body', {}],
      ['a missing field', { other: 1 }],
      ['an empty key', { apiKey: '' }],
      ['a blank key', { apiKey: '   ' }],
      ['a non-string key', { apiKey: 123 }],
      ['a too long key', { apiKey: 'a'.repeat(513) }],
    ])('returns 400 for %s', async (_name, body) => {
      const { app } = setup()

      const res = await request(app).post('/api/session').send(body)

      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'API key is required' })
    })

    it('accepts a key of exactly 512 characters', async () => {
      const { app } = setup()
      upstream(200)

      const res = await request(app)
        .post('/api/session')
        .send({ apiKey: 'a'.repeat(512) })

      expect(res.status).toBe(200)
    })

    it.each([401, 403])('returns 401 when upstream says %i', async (status) => {
      const { app } = setup()
      upstream(status)

      const res = await request(app).post('/api/session').send({ apiKey: KEY })

      expect(res.status).toBe(401)
      expect(res.body).toEqual({ error: 'Invalid API key' })
      expect(res.headers['set-cookie']).toBeUndefined()
    })

    it('returns 429 when upstream is rate limiting', async () => {
      const { app } = setup()
      upstream(429)

      const res = await request(app).post('/api/session').send({ apiKey: KEY })

      expect(res.status).toBe(429)
      expect(res.body).toEqual({
        error: 'Too many attempts. Wait a minute and try again.',
      })
    })

    it('returns 502 for upstream errors and network failures', async () => {
      const { app } = setup()
      const consoleError = vi.spyOn(logger, 'error').mockImplementation(vi.fn())
      const expected = { error: "Couldn't reach Memtime. Please try again." }

      upstream(500)
      const serverError = await request(app).post('/api/session').send({ apiKey: KEY })
      server.use(http.get(`${UPSTREAM}/clients`, () => HttpResponse.error()))
      const networkError = await request(app).post('/api/session').send({ apiKey: KEY })

      expect(serverError.status).toBe(502)
      expect(serverError.body).toEqual(expected)
      expect(networkError.status).toBe(502)
      expect(networkError.body).toEqual(expected)
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(KEY)
    })

    it('never logs the key', async () => {
      const { app } = setup()
      const consoleError = vi.spyOn(logger, 'error').mockImplementation(vi.fn())
      const consoleInfo = vi.spyOn(logger, 'info').mockImplementation(vi.fn())
      const consoleLog = vi.spyOn(logger, 'log').mockImplementation(vi.fn())
      server.use(http.get(`${UPSTREAM}/clients`, () => HttpResponse.error()))

      await request(app).post('/api/session').send({ apiKey: KEY })

      const logged = JSON.stringify([
        consoleError.mock.calls,
        consoleInfo.mock.calls,
        consoleLog.mock.calls,
      ])
      expect(logged).not.toContain(KEY)
    })
  })

  describe('GET /api/session', () => {
    it('returns 200 with the matching expiresAt after sign in', async () => {
      const { app } = setup()
      upstream(200)
      const login = await request(app).post('/api/session').send({ apiKey: KEY })

      const res = await request(app)
        .get('/api/session')
        .set('Cookie', `memtime_sid=${sidOf(login)}`)

      expect(res.status).toBe(200)
      expect(res.body).toEqual(login.body)
      expect(res.text).not.toContain(KEY)
    })

    it('returns 401 without a cookie and does not set one', async () => {
      const { app } = setup()

      const res = await request(app).get('/api/session')

      expect(res.status).toBe(401)
      expect(res.body).toEqual({ error: 'Not signed in' })
      expect(res.headers['set-cookie']).toBeUndefined()
    })

    it('returns 401 and clears the cookie once the TTL has passed', async () => {
      const { app } = setup()
      upstream(200)
      const login = await request(app).post('/api/session').send({ apiKey: KEY })
      time += 3_600_000

      const res = await request(app)
        .get('/api/session')
        .set('Cookie', `memtime_sid=${sidOf(login)}`)

      expect(res.status).toBe(401)
      expect(res.body).toEqual({ error: 'Not signed in' })
      const cookie = (res.headers['set-cookie'] as unknown as string[])[0] ?? ''
      expect(cookie).toMatch(/^memtime_sid=;/)
      expect(cookie).toContain('Path=/api')
    })
  })

  describe('DELETE /api/session', () => {
    it('signs out and clears the cookie', async () => {
      const { app } = setup()
      upstream(200)
      const login = await request(app).post('/api/session').send({ apiKey: KEY })
      const cookie = `memtime_sid=${sidOf(login)}`

      const res = await request(app).delete('/api/session').set('Cookie', cookie)
      const after = await request(app).get('/api/session').set('Cookie', cookie)

      expect(res.status).toBe(204)
      const cleared = (res.headers['set-cookie'] as unknown as string[])[0] ?? ''
      expect(cleared).toMatch(/^memtime_sid=;/)
      expect(cleared).toContain('Path=/api')
      expect(cleared).toContain('HttpOnly')
      expect(cleared).toContain('SameSite=Strict')
      expect(after.status).toBe(401)
    })

    it('is idempotent without a cookie', async () => {
      const { app } = setup()

      const res = await request(app).delete('/api/session')

      expect(res.status).toBe(204)
    })
  })
})
