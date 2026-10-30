import { logger } from '../../src/logger.ts'
import {
  CircuitOpenError,
  createCircuitBreaker,
} from '../../src/memtime/circuitBreaker.ts'

const isFailure = (result: number) => result >= 500

describe('circuitBreaker', () => {
  const advance = (ms: number) => vi.setSystemTime(Date.now() + ms)

  const build = (failureThreshold = 3, openMs = 30_000) =>
    createCircuitBreaker({ failureThreshold, openMs })

  const ok = () => Promise.resolve(200)
  const bad = () => Promise.resolve(500)
  const boom = () => Promise.reject(new Error('network'))

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000_000)
    vi.spyOn(logger, 'warn').mockImplementation(vi.fn())
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function trip(breaker: ReturnType<typeof build>, count = 3) {
    for (let i = 0; i < count; i++) await breaker.run(bad, isFailure)
  }

  it('starts closed and passes results through', async () => {
    const breaker = build()

    expect(breaker.state()).toBe('closed')
    expect(await breaker.run(ok, isFailure)).toBe(200)
  })

  it('opens after the threshold of consecutive failures', async () => {
    const breaker = build()

    await trip(breaker, 2)
    expect(breaker.state()).toBe('closed')
    await trip(breaker, 1)

    expect(breaker.state()).toBe('open')
  })

  it('counts thrown errors and rethrows them', async () => {
    const breaker = build()

    for (let i = 0; i < 3; i++)
      await expect(breaker.run(boom, isFailure)).rejects.toThrow('network')

    expect(breaker.state()).toBe('open')
  })

  it('resets the count on a success', async () => {
    const breaker = build()
    await trip(breaker, 2)
    await breaker.run(ok, isFailure)

    await trip(breaker, 2)

    expect(breaker.state()).toBe('closed')
  })

  it('fails fast with Retry-After while open, without calling the task', async () => {
    const breaker = build()
    await trip(breaker)
    advance(10_500)
    const task = vi.fn(ok)

    const err = await breaker.run(task, isFailure).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(CircuitOpenError)
    expect(err).toMatchObject({
      status: 503,
      message: 'Memtime is unavailable right now. Try again in a minute.',
      headers: { 'Retry-After': '20' },
    })
    expect(task).not.toHaveBeenCalled()
  })

  it('never advertises less than one second', async () => {
    const breaker = build()
    await trip(breaker)
    advance(29_999)

    const err = await breaker.run(ok, isFailure).catch((e: unknown) => e)

    expect(err).toMatchObject({ headers: { 'Retry-After': '1' } })
  })

  it('becomes half-open once the open time has passed', async () => {
    const breaker = build()
    await trip(breaker)

    advance(29_999)
    expect(breaker.state()).toBe('open')
    advance(1)

    expect(breaker.state()).toBe('half_open')
  })

  it('allows one trial call and rejects others while it is in flight', async () => {
    const breaker = build()
    await trip(breaker)
    advance(30_000)
    let finish!: (status: number) => void
    const trial = breaker.run(() => new Promise<number>((r) => (finish = r)), isFailure)

    const other = vi.fn(ok)
    await expect(breaker.run(other, isFailure)).rejects.toBeInstanceOf(CircuitOpenError)
    expect(other).not.toHaveBeenCalled()
    finish(200)
    await trial

    expect(breaker.state()).toBe('closed')
  })

  it('closes after a successful trial and resets the count', async () => {
    const breaker = build()
    await trip(breaker)
    advance(30_000)

    await breaker.run(ok, isFailure)
    await trip(breaker, 2)

    expect(breaker.state()).toBe('closed')
  })

  it.each([
    ['a failing result', bad],
    ['a thrown error', boom],
  ])('reopens with a fresh cooldown after %s on the trial', async (_label, task) => {
    const breaker = build()
    await trip(breaker)
    advance(30_000)

    await breaker.run(task, isFailure).catch(() => undefined)

    expect(breaker.state()).toBe('open')
    advance(29_999)
    expect(breaker.state()).toBe('open')
    advance(1)
    expect(breaker.state()).toBe('half_open')
  })

  it('ignores a slow call that finishes after the circuit opened', async () => {
    const breaker = build(1)
    let finish!: (status: number) => void
    const slow = breaker.run(() => new Promise<number>((r) => (finish = r)), isFailure)
    await breaker.run(bad, isFailure)

    finish(200)
    await slow

    expect(breaker.state()).toBe('open')
  })

  it('logs state changes without anything sensitive', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(vi.fn())
    const breaker = build(2, 30_000)
    await trip(breaker, 2)
    advance(30_000)
    await breaker.run(ok, isFailure)

    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      'Memtime circuit opened, retrying in 30s',
      'Memtime circuit half-open',
      'Memtime circuit closed',
    ])
  })
})
