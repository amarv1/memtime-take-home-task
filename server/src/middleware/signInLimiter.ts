import { rateLimit } from 'express-rate-limit'
import { HttpError } from './errorHandler.ts'

const WINDOW_MS = 15 * 60 * 1000

/**
 * Per-IP limit on sign-in attempts. Each attempt costs an upstream call, and
 * without a limit anyone could use this server to test API keys.
 */
export function signInLimiter(limit: number) {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new HttpError(429, 'Too many sign-in attempts. Try again later.'))
    },
  })
}
