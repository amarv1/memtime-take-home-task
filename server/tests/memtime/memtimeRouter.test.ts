import cookieParser from 'cookie-parser'
import express from 'express'
import { http, HttpResponse, delay } from 'msw'
import request from 'supertest'
import { createApp } from '../../src/app.ts'
import { loadEnv } from '../../src/env.ts'
import { logger } from '../../src/logger.ts'
import { memtimeRouter } from '../../src/memtime/memtimeRouter.ts'
import { endSessionOnRevokedKey } from '../../src/middleware/endSessionOnRevokedKey.ts'
import { errorHandler, notFound } from '../../src/middleware/errorHandler.ts'
import { createSessionStore } from '../../src/sessions/sessionStore.ts'
import { server } from '../support/server.ts'

const BASE = 'https://upstream.test/api/v1'
const KEY = 'secret-key-123'

const routes = [
  { name: 'clients', path: '/api/clients', upstream: '/clients' },
  {
    name: 'projects',
    path: '/api/clients/7/projects',
    upstream: '/clients/7/projects',
  },
  { name: 'tasks', path: '/api/projects/9/tasks', upstream: '/projects/9/tasks' },
] as const

describe('memtimeRouter', () => {
  const store = createSessionStore({ ttlMs: 60_000 })
  afterAll(() => store.stop())

  const app = createApp({
    env: loadEnv({ MEMTIME_API_URL: BASE }),
    sessionStore: store,
  })

  const cookie = () => `memtime_sid=${store.create(KEY).id}`

  /** Registers an upstream handler on any of the three paths and records what it saw. */
  function mockUpstream(
    respond: () => Response | Promise<Response> = () => HttpResponse.json([{ id: 1 }]),
  ) {
    const seen: { url: URL; auth: string | null; accept: string | null }[] = []
    const handler = ({ request }: { request: Request }) => {
      seen.push({
        url: new URL(request.url),
        auth: request.headers.get('authorization'),
        accept: request.headers.get('accept'),
      })
      return respond()
    }
    server.use(
      http.get(`${BASE}/clients`, handler),
      http.get(`${BASE}/clients/:id/projects`, handler),
      http.get(`${BASE}/projects/:id/tasks`, handler),
    )
    return seen
  }

  describe.each(routes)('GET $path', ({ path, upstream }) => {
    it.each([
      ['no cookie', undefined],
      ['an unknown session', 'memtime_sid=nope'],
    ])('answers 401 with %s and makes no upstream call', async (_label, header) => {
      const seen = mockUpstream()
      const req = request(app).get(path)
      if (header) req.set('Cookie', header)

      const res = await req

      expect(res.status).toBe(401)
      expect(res.body).toEqual({ error: 'Not signed in' })
      expect(seen).toHaveLength(0)
    })

    it('calls the matching upstream path with the bearer key', async () => {
      const seen = mockUpstream()

      await request(app).get(path).set('Cookie', cookie()).expect(200)

      expect(seen).toHaveLength(1)
      expect(seen[0]?.url.pathname).toBe(`/api/v1${upstream}`)
      expect(seen[0]?.url.search).toBe('')
      expect(seen[0]?.auth).toBe(`Bearer ${KEY}`)
      expect(seen[0]?.accept).toBe('application/json')
    })

    it('forwards limit, offset, sortBy and order', async () => {
      const seen = mockUpstream()

      await request(app)
        .get(`${path}?limit=100&offset=200&sortBy=name&order=desc`)
        .set('Cookie', cookie())
        .expect(200)

      expect(seen[0]?.url.search).toBe('?limit=100&offset=200&sortBy=name&order=desc')
    })

    it('drops unknown and repeated params', async () => {
      const seen = mockUpstream()

      await request(app)
        .get(`${path}?foo=1&apiKey=x&limit=1&limit=2&offset=5`)
        .set('Cookie', cookie())
        .expect(200)

      expect(seen[0]?.url.search).toBe('?offset=5')
    })

    it('passes the status, body and content type through, and forbids caching', async () => {
      mockUpstream(() => HttpResponse.json([{ id: 1, name: 'A' }]))

      const res = await request(app).get(path).set('Cookie', cookie())

      expect(res.status).toBe(200)
      expect(res.body).toEqual([{ id: 1, name: 'A' }])
      expect(res.headers['content-type']).toMatch(/application\/json/)
      expect(res.headers['cache-control']).toBe('private, no-store')
    })

    it.each([
      [400, { error: 'Bad limit' }],
      [404, { error: 'Not found' }],
    ])('passes a %i error body through', async (status, body) => {
      mockUpstream(() => HttpResponse.json(body, { status }))

      const res = await request(app).get(path).set('Cookie', cookie())

      expect(res.status).toBe(status)
      expect(res.body).toEqual(body)
      expect(res.headers['cache-control']).toBe('private, no-store')
    })

    it('passes a 429 through with its rate-limit headers', async () => {
      mockUpstream(
        () =>
          new HttpResponse('{"error":"slow down"}', {
            status: 429,
            headers: {
              'content-type': 'application/json',
              'ratelimit-limit': '15',
              'ratelimit-remaining': '0',
              'ratelimit-reset': '42',
              'ratelimit-policy': '15;w=60',
              'retry-after': '42',
            },
          }),
      )

      const res = await request(app).get(path).set('Cookie', cookie())

      expect(res.status).toBe(429)
      expect(res.body).toEqual({ error: 'slow down' })
      expect(res.headers).toMatchObject({
        'ratelimit-limit': '15',
        'ratelimit-remaining': '0',
        'ratelimit-reset': '42',
        'ratelimit-policy': '15;w=60',
        'retry-after': '42',
      })
    })

    it('passes a 500 through and warns', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(vi.fn())
      mockUpstream(() => HttpResponse.json({ error: 'boom' }, { status: 500 }))

      const res = await request(app).get(path).set('Cookie', cookie())

      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'boom' })
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('500'))
      vi.restoreAllMocks()
    })

    it('defaults the content type to JSON when upstream sends none', async () => {
      mockUpstream(() => new HttpResponse(null, { status: 200 }))

      const res = await request(app).get(path).set('Cookie', cookie())

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch(/application\/json/)
    })

    it('ends the session when upstream answers 401', async () => {
      const id = store.create(KEY).id
      mockUpstream(() => new HttpResponse('Unauthorized', { status: 401 }))

      const res = await request(app).get(path).set('Cookie', `memtime_sid=${id}`)

      expect(res.status).toBe(401)
      expect(res.body).toEqual({ error: 'Your API key was rejected. Sign in again.' })
      expect(store.get(id)).toBeUndefined()
      expect(String(res.headers['set-cookie'])).toMatch(/memtime_sid=;/)
    })

    it('answers 502 on a network error', async () => {
      vi.spyOn(logger, 'error').mockImplementation(vi.fn())
      mockUpstream(() => HttpResponse.error())

      const res = await request(app).get(path).set('Cookie', cookie())

      expect(res.status).toBe(502)
      expect(res.body).toEqual({ error: "Couldn't reach Memtime. Please try again." })
      vi.restoreAllMocks()
    })
  })

  describe('id validation', () => {
    it.each(['abc', '0', '1.5', '-1', '01', '%2E%2E', '12345678901'])(
      'rejects %s with 400 and no upstream call',
      async (id) => {
        const seen = mockUpstream()

        const clients = await request(app)
          .get(`/api/clients/${id}/projects`)
          .set('Cookie', cookie())
        const projects = await request(app)
          .get(`/api/projects/${id}/tasks`)
          .set('Cookie', cookie())

        expect(clients.status).toBe(400)
        expect(clients.body).toEqual({ error: 'Invalid client id' })
        expect(projects.status).toBe(400)
        expect(projects.body).toEqual({ error: 'Invalid project id' })
        expect(seen).toHaveLength(0)
      },
    )

    it('checks the session before the id', async () => {
      const res = await request(app).get('/api/clients/abc/projects')

      expect(res.status).toBe(401)
    })
  })

  describe('failures', () => {
    // A minimal app so the timeout can be small and the fetch can be replaced.
    function build(options: { timeoutMs?: number; fetch?: typeof fetch }) {
      const a = express()
      a.use(cookieParser())
      a.use('/api', memtimeRouter({ store, memtimeApiUrl: `${BASE}/`, ...options }))
      a.use(notFound)
      a.use(endSessionOnRevokedKey(store, { secureCookies: false }))
      a.use(errorHandler)
      return a
    }

    it('answers 502 when upstream is too slow', async () => {
      vi.spyOn(logger, 'error').mockImplementation(vi.fn())
      server.use(
        http.get(`${BASE}/clients`, async () => {
          await delay(500)
          return HttpResponse.json([])
        }),
      )

      const res = await request(build({ timeoutMs: 20 }))
        .get('/api/clients')
        .set('Cookie', cookie())

      expect(res.status).toBe(502)
      vi.restoreAllMocks()
    })

    it('tolerates a trailing slash on the base URL', async () => {
      const seen = mockUpstream()

      await request(build({})).get('/api/clients').set('Cookie', cookie()).expect(200)

      expect(seen[0]?.url.pathname).toBe('/api/v1/clients')
    })

    it('logs the failure without the key, URL or query', async () => {
      const error = vi.spyOn(logger, 'error').mockImplementation(vi.fn())
      const failing = vi.fn(() =>
        Promise.reject(new TypeError('fetch failed', { cause: new Error('ECONNRESET') })),
      )

      const res = await request(build({ fetch: failing }))
        .get('/api/clients?limit=5')
        .set('Cookie', cookie())

      expect(res.status).toBe(502)
      const logged = JSON.stringify(error.mock.calls)
      expect(logged).toContain('ECONNRESET')
      expect(logged).not.toContain(KEY)
      expect(logged).not.toContain('limit=5')
      vi.restoreAllMocks()
    })

    it('logs an unknown thrown value', async () => {
      const error = vi.spyOn(logger, 'error').mockImplementation(vi.fn())
      // Rejecting with a non-Error on purpose: that is the branch under test.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      const failing = vi.fn(() => Promise.reject('nope'))

      await request(build({ fetch: failing }))
        .get('/api/clients')
        .set('Cookie', cookie())
        .expect(502)

      expect(error).toHaveBeenCalledWith(expect.stringContaining('unknown error'))
      vi.restoreAllMocks()
    })
  })

  it('never exposes the key in responses or logs', async () => {
    const spies = (['error', 'warn', 'info', 'log'] as const).map((level) =>
      vi.spyOn(logger, level).mockImplementation(vi.fn() as never),
    )
    mockUpstream(() => HttpResponse.json({ error: 'boom' }, { status: 500 }))

    const res = await request(app).get('/api/clients').set('Cookie', cookie())

    expect(JSON.stringify(res.headers) + res.text).not.toContain(KEY)
    expect(JSON.stringify(spies.map((s) => s.mock.calls))).not.toContain(KEY)
    vi.restoreAllMocks()
  })
})
