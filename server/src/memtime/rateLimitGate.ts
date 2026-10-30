import { getRateLimit } from 'ratelimit-header-parser'
import { hashApiKey } from '../cache/hashApiKey.ts'
import { logger } from '../logger.ts'
import { CircuitOpenError } from './circuitBreaker.ts'
import type { MemtimeResponse } from './memtimeClient.ts'
import { RateLimitedError } from './rateLimit.ts'

interface Options {
  /** Calls kept back for writes: reads stop when this many are left. */
  reserveForWrites?: number
  /** Longest wait for the window to reset before failing at once instead. */
  maxWaitMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

interface Budget {
  remaining: number
  resetAt: number
}

// Two responses of one window can report slightly different reset times.
const SAME_WINDOW_JITTER_MS = 2_000

// Unref'd: a pending wait must not hold the process open on shutdown.
const timerSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref()
  })

export type RateLimitGate = ReturnType<typeof createRateLimitGate>

/**
 * Tracks how many calls each API key has left in Memtime's rate-limit window, from the
 * `ratelimit-*` headers of its responses. When the budget is used up (reads stop with a few
 * calls kept back for writes), `run` waits for the window to reset if that takes at most
 * `maxWaitMs`, then checks again; otherwise it throws `RateLimitedError` without calling
 * Memtime. A key not seen yet is let through. Kept in memory, per instance.
 */
export function createRateLimitGate({
  reserveForWrites = 2,
  maxWaitMs = 5_000,
  now = Date.now,
  sleep = timerSleep,
}: Options = {}) {
  const budgets = new Map<string, Budget>()

  function prune(at: number) {
    for (const [id, budget] of budgets) if (budget.resetAt <= at) budgets.delete(id)
  }

  function learn(id: string, response: MemtimeResponse) {
    const at = now()
    // The parser reads `reset` against the real clock; keep only the distance from it.
    const parsed = getRateLimit(response.headers, { reset: 'seconds' })
    const parsedResetIn =
      parsed?.reset === undefined ? NaN : parsed.reset.getTime() - Date.now()
    const current = budgets.get(id)

    if (response.status === 429) {
      const header = response.headers.get('retry-after')
      const retryAfterMs = header === null ? NaN : Number(header) * 1000
      const resetIn = Number.isFinite(retryAfterMs) ? retryAfterMs : parsedResetIn
      const resetAt = Number.isFinite(resetIn) ? at + resetIn : current?.resetAt
      if (resetAt !== undefined && resetAt > at)
        budgets.set(id, { remaining: 0, resetAt })
      return
    }

    const remaining = parsed?.remaining
    const resetAt = at + parsedResetIn
    if (remaining === undefined || !Number.isFinite(remaining) || !(resetAt > at)) return

    if (current && Math.abs(current.resetAt - resetAt) <= SAME_WINDOW_JITTER_MS) {
      // Responses can arrive out of order: the lower count is the later one.
      current.remaining = Math.min(current.remaining, remaining)
    } else {
      budgets.set(id, { remaining, resetAt })
    }
  }

  async function run(
    apiKey: string,
    kind: 'read' | 'write',
    call: () => Promise<MemtimeResponse>,
  ): Promise<MemtimeResponse> {
    const id = hashApiKey(apiKey)
    const floor = kind === 'read' ? reserveForWrites : 0
    let counted: Budget | undefined
    for (;;) {
      const at = now()
      prune(at)
      const budget = budgets.get(id)
      if (!budget) break
      if (budget.remaining > floor) {
        // Before the call, so parallel requests are counted too.
        budget.remaining -= 1
        counted = budget
        break
      }
      const waitMs = budget.resetAt - at
      if (waitMs > maxWaitMs) {
        logger.warn(`Memtime rate limit reached, not sending a ${kind}`)
        throw new RateLimitedError(waitMs / 1000)
      }
      // The window ends soon: wait, then check again, as the budget may have changed.
      await sleep(waitMs)
    }

    let response: MemtimeResponse
    try {
      response = await call()
    } catch (err) {
      // Nothing was sent, so the call is not used up.
      if (err instanceof CircuitOpenError && counted && budgets.get(id) === counted)
        counted.remaining += 1
      throw err
    }
    learn(id, response)
    return response
  }

  return { run }
}
