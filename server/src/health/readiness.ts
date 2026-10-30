import { logger } from '../logger.ts'
import type { CircuitBreaker, CircuitState } from '../memtime/circuitBreaker.ts'

interface Options {
  breaker: CircuitBreaker
  /** Memtime's keyless health endpoint. */
  healthUrl: string
  fetch?: typeof globalThis.fetch
  now?: () => number
}

export interface Readiness {
  ready: boolean
  memtime: 'up' | 'down'
  circuit: CircuitState
}

export type ReadinessCheck = ReturnType<typeof createReadinessCheck>

const PROBE_TIMEOUT_MS = 3000
// Keeps a flood of probes from becoming a flood of upstream calls.
const RESULT_TTL_MS = 10_000

/**
 * Tells whether Memtime can be reached: not while the circuit is open, otherwise by asking its
 * health endpoint. The answer is reused for a few seconds, and the check never feeds the breaker.
 */
export function createReadinessCheck({
  breaker,
  healthUrl,
  fetch,
  now = Date.now,
}: Options) {
  let cached: { up: boolean; expiresAt: number } | undefined
  let inFlight: Promise<boolean> | undefined

  async function probe(): Promise<boolean> {
    try {
      // Looked up per call so a patched global fetch (as in tests) is always picked up.
      const res = await (fetch ?? globalThis.fetch)(healthUrl, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
      await res.body?.cancel()
      return res.status >= 200 && res.status < 300
    } catch (err) {
      // Never the URL: only the error name.
      const reason = err instanceof Error ? err.name : 'unknown error'
      logger.warn(`Memtime readiness probe failed: ${reason}`)
      return false
    }
  }

  function cachedProbe(): Promise<boolean> {
    if (cached && now() < cached.expiresAt) return Promise.resolve(cached.up)
    inFlight ??= probe()
      .then((up) => {
        cached = { up, expiresAt: now() + RESULT_TTL_MS }
        return up
      })
      .finally(() => {
        inFlight = undefined
      })
    return inFlight
  }

  return {
    async check(): Promise<Readiness> {
      const circuit = breaker.state()
      if (circuit === 'open') return { ready: false, memtime: 'down', circuit }
      const up = await cachedProbe()
      return { ready: up, memtime: up ? 'up' : 'down', circuit }
    },
  }
}
