import { http, HttpResponse, delay } from 'msw'
import request from 'supertest'
import { createApp } from '../../src/app.ts'
import { loadEnv } from '../../src/env.ts'
import { logger } from '../../src/logger.ts'
import { createCircuitBreaker } from '../../src/memtime/circuitBreaker.ts'
import { server } from '../support/server.ts'

const BASE = 'https://upstream.test/api/v1'
const HEALTH = 'https://upstream.test/health'

describe('health routes', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'warn').mockImplementation(vi.fn())
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const build = (
    breaker = createCircuitBreaker({ failureThreshold: 3, openMs: 30_000 }),
  ) => createApp({ env: loadEnv({ MEMTIME_API_URL: BASE }), breaker })

  function mockHealth(respond: () => Response | Promise<Response>) {
    const calls = { count: 0, auth: null as string | null }
    server.use(
      http.get(HEALTH, ({ request: req }) => {
        calls.count += 1
        calls.auth = req.headers.get('authorization')
        return respond()
      }),
    )
    return calls
  }

  it('keeps /api/health as plain liveness, without calling Memtime', async () => {
    const res = await request(build()).get('/api/health')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })

  it('is ready when Memtime answers, without sending a key', async () => {
    const calls = mockHealth(() => new HttpResponse("I'm alive!"))

    const res = await request(build()).get('/api/health/ready')

    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).toEqual({
      status: 'ready',
      checks: { memtime: { status: 'up', circuit: 'closed' } },
    })
    expect(calls).toEqual({ count: 1, auth: null })
  })

  it('is not ready when Memtime answers 500', async () => {
    mockHealth(() => new HttpResponse('x', { status: 500 }))

    const res = await request(build()).get('/api/health/ready')

    expect(res.status).toBe(503)
    expect(res.body).toEqual({
      status: 'not_ready',
      checks: { memtime: { status: 'down', circuit: 'closed' } },
    })
  })

  it('is not ready on a network error', async () => {
    mockHealth(() => HttpResponse.error())

    await request(build()).get('/api/health/ready').expect(503)
  })

  it('is not ready when the circuit is open, and does not call Memtime', async () => {
    const breaker = createCircuitBreaker({ failureThreshold: 1, openMs: 30_000 })
    await breaker.run(
      () => Promise.resolve(500),
      (status) => status >= 500,
    )
    const calls = mockHealth(() => new HttpResponse('ok'))

    const res = await request(build(breaker)).get('/api/health/ready')

    expect(res.status).toBe(503)
    expect((res.body as { checks: { memtime: unknown } }).checks.memtime).toEqual({
      status: 'down',
      circuit: 'open',
    })
    expect(calls.count).toBe(0)
  })

  it('never puts a URL in the body', async () => {
    mockHealth(() => HttpResponse.error())

    const res = await request(build()).get('/api/health/ready')

    expect(res.text).not.toContain('upstream.test')
    expect(res.text).not.toContain('http')
  })

  it('answers the same slow probe once for concurrent requests', async () => {
    const calls = mockHealth(async () => {
      await delay(20)
      return new HttpResponse('ok')
    })
    const app = build()

    await Promise.all([
      request(app).get('/api/health/ready').expect(200),
      request(app).get('/api/health/ready').expect(200),
    ])

    expect(calls.count).toBe(1)
  })
})
