import {
  useCallback,
  useEffect,
  useEffectEvent,
  useState,
  useSyncExternalStore,
} from 'react'
import { notifyManager, useQueryClient, type QueryCache } from '@tanstack/react-query'
import { ApiError } from './api'

export const RATE_LIMITED_MESSAGE = 'Memtime is receiving too many requests.'

// Used when the server gave no `Retry-After`: Memtime's window is a minute.
const DEFAULT_WAIT_SECONDS = 60

export function isRateLimited(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 429
}

/** The server answers 503 while Memtime is down (its circuit is open) and says when to try again. */
export function isUnavailable(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 503
}

function waitSeconds(error: unknown): number {
  return isRateLimited(error) || isUnavailable(error)
    ? (error.retryAfterSeconds ?? DEFAULT_WAIT_SECONDS)
    : 0
}

const secondsUntil = (deadline: number) =>
  Math.max(0, Math.ceil((deadline - Date.now()) / 1000))

/** Sets the whole seconds left until `deadline` now and every second, until it reaches 0. */
function countDownTo(deadline: number, setSecondsLeft: (seconds: number) => void) {
  const update = () => {
    const left = secondsUntil(deadline)
    setSecondsLeft(left)
    return left
  }
  if (update() === 0) return
  const timer = setInterval(() => {
    if (update() === 0) clearInterval(timer)
  }, 1000)
  return () => clearInterval(timer)
}

/**
 * Seconds left until a rate-limited or unavailable `error` may be retried; 0 for any other error, or once
 * the wait is over. The deadline is fixed when the error object first shows up, so re-renders
 * don't restart it.
 */
export function useCountdown(error: unknown): number {
  const [secondsLeft, setSecondsLeft] = useState(() => waitSeconds(error))
  useEffect(
    () => countDownTo(Date.now() + waitSeconds(error) * 1000, setSecondsLeft),
    [error],
  )
  return secondsLeft
}

/** Seconds left until `deadline` (ms since epoch), counting down; 0 once it has passed. */
export function useSecondsUntil(deadline: number): number {
  const [secondsLeft, setSecondsLeft] = useState(() => secondsUntil(deadline))
  useEffect(() => countDownTo(deadline, setSecondsLeft), [deadline])
  return secondsLeft
}

// The server holds a request up to 5 s for the window to reset (ADR 0012). `Retry-After` is
// rounded up, so a request sent this long before it runs out still goes through.
const SERVER_WAIT_MS = 5_000

/** Until when a read sent now would still be refused, from the 429s in the cache, or 0. */
function rateLimitedUntil(cache: QueryCache): number {
  let until = 0
  for (const { state } of cache.getAll()) {
    if (isRateLimited(state.error)) {
      const resetAt = state.errorUpdatedAt + waitSeconds(state.error) * 1000
      until = Math.max(until, resetAt - SERVER_WAIT_MS)
    }
  }
  return until
}

/**
 * Until when Memtime refuses reads (ms since epoch; in the past or 0 when it doesn't). Taken
 * from the 429s in the query cache: the budget is per API key, so a 429 on any read counts.
 */
export function useRateLimitedUntil(): number {
  const cache = useQueryClient().getQueryCache()
  const subscribe = useCallback(
    (onChange: () => void) => cache.subscribe(notifyManager.batchCalls(onChange)),
    [cache],
  )
  return useSyncExternalStore(subscribe, () => rateLimitedUntil(cache))
}

const MAX_RESENDS = 2

/**
 * Resends a request that got a 429 once its wait is over, up to twice. A 429 means nothing reached
 * Memtime, so resending is safe. `waiting` is true during the wait; clearing `error` (the mutation's
 * `reset`) or unmounting cancels the resend. Call `startOver` when the user sends something new.
 * `secondsLeft` is the countdown of `error` (also used for 503 and for a 429 that ran out of resends).
 */
export function useAutoResend(error: unknown, resend: () => void) {
  const [resends, setResends] = useState(0)
  const secondsLeft = useCountdown(error)
  const waiting = isRateLimited(error) && resends < MAX_RESENDS
  const send = useEffectEvent(resend)

  useEffect(() => {
    if (!waiting) return
    const timer = setTimeout(
      () => {
        setResends((n) => n + 1)
        send()
      },
      waitSeconds(error) * 1000,
    )
    return () => clearTimeout(timer)
  }, [waiting, error])

  return { waiting, secondsLeft, startOver: () => setResends(0) }
}

/** The server's message, plus how long to wait. Fixed text, so "about": it doesn't count down. */
export function withWait(error: ApiError): string {
  return error.retryAfterSeconds === undefined
    ? `${error.message} Try again in a minute.`
    : `${error.message} Try again in about ${error.retryAfterSeconds}s.`
}
