import { useEffect, useEffectEvent, useState } from 'react'
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

/**
 * Seconds left until a rate-limited or unavailable `error` may be retried; 0 for any other error, or once
 * the wait is over. The deadline is fixed when the error object first shows up, so re-renders
 * don't restart it.
 */
export function useCountdown(error: unknown): number {
  const [secondsLeft, setSecondsLeft] = useState(() => waitSeconds(error))

  useEffect(() => {
    const deadline = Date.now() + waitSeconds(error) * 1000
    const update = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setSecondsLeft(left)
      return left
    }
    if (update() === 0) return
    const timer = setInterval(() => {
      if (update() === 0) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [error])

  return secondsLeft
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
