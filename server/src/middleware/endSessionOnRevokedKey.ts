import type { ErrorRequestHandler } from 'express'
import { HttpError } from './errorHandler.ts'
import { SESSION_COOKIE, readSessionId, sessionCookieOptions } from './requireSession.ts'
import type { SessionStore } from '../sessions/sessionStore.ts'

/** Thrown by code that calls Memtime with a session's key when Memtime answers 401. */
export class MemtimeKeyRejectedError extends Error {
  constructor() {
    super('Memtime rejected the API key')
    this.name = 'MemtimeKeyRejectedError'
  }
}

/**
 * Ends the session when Memtime rejects its key (revoked or changed mid-session).
 * The client gets a 401, which makes the frontend sign the user out.
 */
export function endSessionOnRevokedKey(
  store: SessionStore,
  { secureCookies }: { secureCookies: boolean },
): ErrorRequestHandler {
  return (err, req, res, next) => {
    if (!(err instanceof MemtimeKeyRejectedError)) {
      next(err)
      return
    }
    const id = readSessionId(req.cookies)
    if (id) store.delete(id)
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions(secureCookies))
    next(new HttpError(401, 'Your API key was rejected. Sign in again.'))
  }
}
