import { http, HttpResponse } from 'msw'
import { createReadinessCheck } from '../../src/health/readiness.ts'
import { logger } from '../../src/logger.ts'
import { createCircuitBreaker } from '../../src/memtime/circuitBreaker.ts'
import { server } from '../support/server.ts'

const HEALTH = 'https://upstream.test/health'

describe('readiness check', () => {
  const advance = (ms: number) => vi.setSystemTime(Date.now() + ms)

  let status: number
  let calls: number

  const breaker = () => createCircuitBreaker({ failureThreshold: 1, openMs: 60_000 })
  const build = (b = breaker()) => createReadinessCheck({ breaker: b, healthUrl: HEALTH })

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000_000)
    status = 200
    calls = 0
    vi.spyOn(logger, 'warn').mockImplementation(vi.fn())
    server.use(
      http.get(HEALTH, () => {
        calls += 1
        return new HttpResponse("I'm alive!", { status })
      }),
    )
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('reuses the result for 10 seconds, then probes again', async () => {
    const readiness = build()
    await readiness.check()

    advance(9_999)
    await readiness.check()
    expect(calls).toBe(1)

    advance(1)
    await readiness.check()
    expect(calls).toBe(2)
  })

  it('caches a down result too', async () => {
    status = 500
    const readiness = build()

    expect((await readiness.check()).ready).toBe(false)
    status = 200
    expect((await readiness.check()).ready).toBe(false)
    advance(10_000)

    expect((await readiness.check()).ready).toBe(true)
  })

  it('reads the circuit state fresh on every check', async () => {
    const b = breaker()
    const readiness = build(b)
    expect(await readiness.check()).toEqual({
      ready: true,
      memtime: 'up',
      circuit: 'closed',
    })

    await b.run(
      () => Promise.resolve(500),
      (s) => s >= 500,
    )

    expect(await readiness.check()).toEqual({
      ready: false,
      memtime: 'down',
      circuit: 'open',
    })
    expect(calls).toBe(1)
  })

  it('does not feed the breaker', async () => {
    const b = breaker()
    status = 500
    const readiness = build(b)

    await readiness.check()
    advance(10_000)
    await readiness.check()

    expect(b.state()).toBe('closed')
  })

  it('treats a timeout as down and logs without the URL', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(vi.fn())
    const readiness = createReadinessCheck({
      breaker: breaker(),
      healthUrl: HEALTH,
      fetch: () => Promise.reject(new DOMException('timed out', 'TimeoutError')),
    })

    expect((await readiness.check()).memtime).toBe('down')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('upstream.test')
    expect(warn).toHaveBeenCalledOnce()
  })
})
