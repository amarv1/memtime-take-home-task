import { HttpError } from '../middleware/errorHandler.ts'

// No wait time in the text: `Retry-After` carries it, and the client shows it.
const MESSAGE = 'Memtime is receiving too many requests.'

/** Maps Memtime's 429 to our own, passing its `Retry-After` on when it sends one. */
export function throwIfRateLimited(status: number, headers: Headers) {
  if (status !== 429) return
  const retryAfter = headers.get('retry-after')
  throw new HttpError(
    429,
    MESSAGE,
    retryAfter === null ? undefined : { 'Retry-After': retryAfter },
  )
}

/** Thrown instead of calling Memtime when the key's budget is used up. */
export class RateLimitedError extends HttpError {
  constructor(retryAfterSeconds: number) {
    super(429, MESSAGE, {
      'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))),
    })
    this.name = 'RateLimitedError'
  }
}
