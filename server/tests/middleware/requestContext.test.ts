import { http, HttpResponse } from 'msw'
import request from 'supertest'
import { createApp } from '../../src/app.ts'
import { loadEnv } from '../../src/env.ts'
import { logger } from '../../src/logger.ts'
import { currentRequestId } from '../../src/requestId.ts'
import { server } from '../support/server.ts'

describe('request context', () => {
  const app = createApp()
  const UUID = /^[0-9a-f-]{36}$/

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a fresh X-Request-Id on every response', async () => {
    const a = await request(app).get('/api/health')
    const b = await request(app).get('/api/health')

    expect(a.headers['x-request-id']).toMatch(UUID)
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id'])
  })

  it('ignores a client-supplied request id', async () => {
    const res = await request(app).get('/api/health').set('X-Request-Id', 'forged-id')

    expect(res.headers['x-request-id']).toMatch(UUID)
  })

  it('logs one line per request without the query string', async () => {
    const log = vi.spyOn(logger, 'log').mockImplementation(vi.fn())

    await request(app).get('/api/nope?token=secret')

    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith(
      'info',
      expect.stringMatching(/^GET \/api\/nope 404 \d+ms$/),
    )
  })

  it('logs health checks at debug so probes stay quiet', async () => {
    const log = vi.spyOn(logger, 'log').mockImplementation(vi.fn())

    await request(app).get('/api/health')

    expect(log).toHaveBeenCalledWith(
      'debug',
      expect.stringContaining('GET /api/health 200'),
    )
  })

  it('logs the readiness probe at debug, even when it answers 503', async () => {
    const log = vi.spyOn(logger, 'log').mockImplementation(vi.fn())
    const down = createApp({
      env: loadEnv({ MEMTIME_API_URL: 'https://upstream.test/api/v1' }),
    })
    server.use(
      http.get(
        'https://upstream.test/health',
        () => new HttpResponse('x', { status: 500 }),
      ),
    )

    const res = await request(down).get('/api/health/ready')

    expect(res.status).toBe(503)
    expect(log).toHaveBeenCalledWith(
      'debug',
      expect.stringContaining('GET /api/health/ready 503'),
    )
  })

  it('is not set outside a request', () => {
    expect(currentRequestId()).toBeUndefined()
  })
})
