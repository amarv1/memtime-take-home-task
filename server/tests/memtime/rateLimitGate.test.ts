import { getRateLimit } from 'ratelimit-header-parser'
import { logger } from '../../src/logger.ts'
import { CircuitOpenError } from '../../src/memtime/circuitBreaker.ts'
import type { MemtimeResponse } from '../../src/memtime/memtimeClient.ts'
import { RateLimitedError } from '../../src/memtime/rateLimit.ts'
import { createRateLimitGate } from '../../src/memtime/rateLimitGate.ts'

const KEY = 'secret-key-123'

function reply(
  remaining: number | null,
  {
    status = 200,
    resetIn = 42,
    retryAfter,
  }: { status?: number; resetIn?: number; retryAfter?: number } = {},
): MemtimeResponse {
  const headers = new Headers()
  if (remaining !== null) {
    headers.set('ratelimit-limit', '15')
    headers.set('ratelimit-remaining', String(remaining))
    headers.set('ratelimit-reset', String(resetIn))
    headers.set('ratelimit-policy', '15;w=60')
  }
  if (retryAfter !== undefined) headers.set('retry-after', String(retryAfter))
  return { status, headers, body: '{}' }
}

describe('ratelimit-header-parser on Memtime headers', () => {
  it('reads ratelimit-reset as seconds from now', () => {
    const info = getRateLimit(reply(0).headers, { reset: 'seconds' })

    expect(info?.remaining).toBe(0)
    expect((info?.reset?.getTime() ?? 0) - Date.now()).toBeGreaterThan(41_000)
    expect((info?.reset?.getTime() ?? 0) - Date.now()).toBeLessThanOrEqual(42_000)
  })
})

describe('createRateLimitGate', () => {
  let time = 1_000_000
  const sleeps: number[] = []
  // A wait just moves the fake clock forward.
  const sleep = (ms: number) => {
    sleeps.push(ms)
    time += ms
    return Promise.resolve()
  }
  const gate = () => createRateLimitGate({ now: () => time, sleep })

  beforeEach(() => {
    time = 1_000_000
    sleeps.length = 0
    vi.spyOn(logger, 'warn').mockImplementation(vi.fn())
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** Makes the gate learn `remaining` calls left, with the window ending in 42 s. */
  async function learn(g: ReturnType<typeof gate>, remaining: number) {
    await g.run(KEY, 'read', () => Promise.resolve(reply(remaining)))
  }

  it('lets an unknown key through', async () => {
    const call = vi.fn(() => Promise.resolve(reply(null)))

    await gate().run(KEY, 'read', call)

    expect(call).toHaveBeenCalledOnce()
  })

  it('blocks reads at the reserve but not writes', async () => {
    const g = gate()
    await learn(g, 2)
    const call = vi.fn(() => Promise.resolve(reply(1)))

    await expect(g.run(KEY, 'read', call)).rejects.toBeInstanceOf(RateLimitedError)
    expect(call).not.toHaveBeenCalled()
    await g.run(KEY, 'write', call)
    expect(call).toHaveBeenCalledOnce()
  })

  it('blocks writes at 0 remaining', async () => {
    const g = gate()
    await learn(g, 0)
    const call = vi.fn(() => Promise.resolve(reply(0)))

    await expect(g.run(KEY, 'write', call)).rejects.toBeInstanceOf(RateLimitedError)
    expect(call).not.toHaveBeenCalled()
  })

  it('tells how long until the window resets', async () => {
    const g = gate()
    await learn(g, 0)
    time += 10_500

    const error = await g.run(KEY, 'read', vi.fn()).catch((e: unknown) => e)

    expect(error).toMatchObject({ status: 429, headers: { 'Retry-After': '32' } })
  })

  it('warns without the key', async () => {
    const g = gate()
    await learn(g, 0)
    await g.run(KEY, 'read', vi.fn()).catch(() => undefined)

    expect(logger.warn).toHaveBeenCalledOnce()
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(KEY)
  })

  it('lets calls through again once the window is over', async () => {
    const g = gate()
    await learn(g, 0)
    time += 42_001
    const call = vi.fn(() => Promise.resolve(reply(null)))

    await g.run(KEY, 'read', call)

    expect(call).toHaveBeenCalledOnce()
  })

  it('counts parallel calls before they answer', async () => {
    const g = gate()
    await learn(g, 5)
    const release: (() => void)[] = []
    const slow = () =>
      new Promise<MemtimeResponse>((resolve) => {
        release.push(() => resolve(reply(null)))
      })

    const first = [
      g.run(KEY, 'read', slow),
      g.run(KEY, 'read', slow),
      g.run(KEY, 'read', slow),
    ]
    // 5 left, 3 in flight: 2 remain, which is the reserve.
    await expect(g.run(KEY, 'read', slow)).rejects.toBeInstanceOf(RateLimitedError)
    release.forEach((r) => r())
    await Promise.all(first)
  })

  it('keeps the lower count when answers arrive out of order', async () => {
    const g = gate()
    await learn(g, 10)
    let answerA: (r: MemtimeResponse) => void = () => undefined
    let answerB: (r: MemtimeResponse) => void = () => undefined
    const a = g.run(KEY, 'read', () => new Promise<MemtimeResponse>((r) => (answerA = r)))
    const b = g.run(KEY, 'read', () => new Promise<MemtimeResponse>((r) => (answerB = r)))
    // The later call answers first with the lower count; the older answer must not raise it.
    answerB(reply(8))
    await b
    answerA(reply(9))
    await a

    let allowed = 0
    while (allowed < 20) {
      const ok = await g
        .run(KEY, 'read', () => Promise.resolve(reply(null)))
        .then(
          () => true,
          () => false,
        )
      if (!ok) break
      allowed += 1
    }
    expect(allowed).toBe(6)
  })

  it('replaces the budget when a new window starts', async () => {
    const g = gate()
    await learn(g, 0)
    time += 43_000
    await g.run(KEY, 'read', () => Promise.resolve(reply(14)))

    const call = vi.fn(() => Promise.resolve(reply(null)))
    await g.run(KEY, 'read', call)

    expect(call).toHaveBeenCalledOnce()
  })

  it('treats a 429 as the budget used up', async () => {
    const g = gate()
    await g.run(KEY, 'write', () =>
      Promise.resolve(reply(null, { status: 429, retryAfter: 17 })),
    )

    const error = await g.run(KEY, 'write', vi.fn()).catch((e: unknown) => e)

    expect(error).toMatchObject({ status: 429, headers: { 'Retry-After': '17' } })
  })

  it('uses the reset header on a 429 without Retry-After', async () => {
    const g = gate()
    await g.run(KEY, 'read', () =>
      Promise.resolve(reply(0, { status: 429, resetIn: 30 })),
    )

    const error = await g.run(KEY, 'read', vi.fn()).catch((e: unknown) => e)

    expect(error).toMatchObject({ status: 429, headers: { 'Retry-After': '30' } })
  })

  it('keeps its state when a response has no rate-limit headers', async () => {
    const g = gate()
    await learn(g, 5)
    await g.run(KEY, 'read', () => Promise.resolve(reply(null)))
    await g.run(KEY, 'read', () => Promise.resolve(reply(null)))

    // 5 -> 4 -> 3 from the two decrements; the third read would leave 2.
    await g.run(KEY, 'read', () => Promise.resolve(reply(null)))
    await expect(g.run(KEY, 'read', vi.fn())).rejects.toBeInstanceOf(RateLimitedError)
  })

  it('gives the call back when the circuit is open', async () => {
    const g = gate()
    await learn(g, 3)
    const open = () => Promise.reject(new CircuitOpenError(5))

    await expect(g.run(KEY, 'read', open)).rejects.toBeInstanceOf(CircuitOpenError)
    await expect(g.run(KEY, 'read', open)).rejects.toBeInstanceOf(CircuitOpenError)
    await expect(g.run(KEY, 'read', open)).rejects.toBeInstanceOf(CircuitOpenError)
  })

  it('keeps the call counted on other errors', async () => {
    const g = gate()
    await learn(g, 3)

    await expect(
      g.run(KEY, 'read', () => Promise.reject(new Error('x'))),
    ).rejects.toThrow('x')

    await expect(g.run(KEY, 'read', vi.fn())).rejects.toBeInstanceOf(RateLimitedError)
  })

  it('tracks keys separately', async () => {
    const g = gate()
    await learn(g, 0)
    const call = vi.fn(() => Promise.resolve(reply(null)))

    await g.run('other-key', 'read', call)

    expect(call).toHaveBeenCalledOnce()
  })

  describe('short wait', () => {
    /** Learns `remaining` calls left, with the window ending in `resetIn` seconds. */
    const learnWithReset = (
      g: ReturnType<typeof gate>,
      remaining: number,
      resetIn: number,
    ) => g.run(KEY, 'read', () => Promise.resolve(reply(remaining, { resetIn })))

    it('waits for a reset within 5 s, then sends the read once', async () => {
      const g = gate()
      await learnWithReset(g, 2, 3)
      let sentAt = 0
      const call = vi.fn(() => {
        sentAt = time
        return Promise.resolve(reply(null))
      })

      await g.run(KEY, 'read', call)

      expect(call).toHaveBeenCalledOnce()
      expect(sleeps).toEqual([3_000])
      expect(sentAt).toBe(1_000_000 + 3_000)
    })

    it('waits for a write at 0 remaining', async () => {
      const g = gate()
      await learnWithReset(g, 0, 2)
      const call = vi.fn(() => Promise.resolve(reply(null)))

      await g.run(KEY, 'write', call)

      expect(call).toHaveBeenCalledOnce()
      expect(sleeps).toEqual([2_000])
    })

    it('fails at once when the reset is further than 5 s', async () => {
      const g = gate()
      await learnWithReset(g, 0, 6)
      const call = vi.fn()

      const error = await g.run(KEY, 'read', call).catch((e: unknown) => e)

      expect(error).toMatchObject({ status: 429, headers: { 'Retry-After': '6' } })
      expect(call).not.toHaveBeenCalled()
      expect(sleeps).toEqual([])
    })

    it('checks again after waking and fails if a new budget is used up', async () => {
      const g = createRateLimitGate({
        now: () => time,
        sleep: (ms) => {
          time += ms
          // Meanwhile another response taught a new, used-up budget with a far reset.
          return learnWithReset(g, 0, 40).then(() => undefined)
        },
      })
      await learnWithReset(g, 0, 3)
      const call = vi.fn()

      const error = await g.run(KEY, 'write', call).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(RateLimitedError)
      expect(call).not.toHaveBeenCalled()
    })
  })
})
