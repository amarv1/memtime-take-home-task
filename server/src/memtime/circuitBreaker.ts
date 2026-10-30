import {
  BrokenCircuitError,
  CircuitState as PolicyState,
  ConsecutiveBreaker,
  circuitBreaker,
  handleAll,
} from 'cockatiel'
import { logger } from '../logger.ts'
import { HttpError } from '../middleware/errorHandler.ts'

export type CircuitState = 'closed' | 'open' | 'half_open'

interface Options {
  /** Consecutive failures that open the circuit. */
  failureThreshold: number
  /** How long the circuit stays open before one trial call is allowed. */
  openMs: number
}

/** Thrown instead of calling Memtime while the circuit is open. */
export class CircuitOpenError extends HttpError {
  constructor(retryAfterSeconds: number) {
    super(503, 'Memtime is unavailable right now. Try again in a minute.', {
      'Retry-After': String(retryAfterSeconds),
    })
    this.name = 'CircuitOpenError'
  }
}

/** A task's result, tagged so the policy can count it as a failure without throwing. */
interface Outcome<T> {
  value: T
  failed: boolean
}

export type CircuitBreaker = ReturnType<typeof createCircuitBreaker>

/**
 * Stops calling a failing upstream, using cockatiel's breaker. After `failureThreshold`
 * consecutive failures the circuit opens and calls fail fast for `openMs`; then one trial call
 * decides whether it closes or opens again.
 */
export function createCircuitBreaker({ failureThreshold, openMs }: Options) {
  const policy = circuitBreaker(
    handleAll.orWhenResult((outcome) => (outcome as Outcome<unknown>).failed),
    { halfOpenAfter: openMs, breaker: new ConsecutiveBreaker(failureThreshold) },
  )

  // cockatiel only leaves "open" when the next call arrives, so track when that is allowed.
  let reopenAt = 0
  policy.onBreak(() => {
    reopenAt = Date.now() + openMs
    logger.warn(`Memtime circuit opened, retrying in ${Math.ceil(openMs / 1000)}s`)
  })
  policy.onHalfOpen(() => logger.warn('Memtime circuit half-open'))
  policy.onReset(() => logger.warn('Memtime circuit closed'))

  function retryAfterSeconds(): number {
    return Math.max(1, Math.ceil((reopenAt - Date.now()) / 1000))
  }

  function state(): CircuitState {
    if (policy.state === PolicyState.Closed) return 'closed'
    if (policy.state === PolicyState.HalfOpen) return 'half_open'
    return Date.now() >= reopenAt ? 'half_open' : 'open'
  }

  /**
   * Runs `task` unless the circuit is open. A thrown error or a result `isFailure` accepts counts as
   * a failure; the error is rethrown and the result returned as they are.
   */
  async function run<T>(
    task: () => Promise<T>,
    isFailure: (result: T) => boolean,
  ): Promise<T> {
    // cockatiel would make other calls wait for the trial call; fail them fast instead.
    if (policy.state === PolicyState.HalfOpen) throw new CircuitOpenError(1)
    try {
      const outcome = (await policy.execute(async () => {
        const value = await task()
        return { value, failed: isFailure(value) }
      })) as Outcome<T>
      return outcome.value
    } catch (err) {
      if (err instanceof BrokenCircuitError)
        throw new CircuitOpenError(retryAfterSeconds())
      throw err
    }
  }

  return { run, state }
}
