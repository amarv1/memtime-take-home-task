import type { RequestHandler, Response } from 'express'
import { HttpError } from './errorHandler.ts'
import type { Session, SessionStore } from '../sessions/sessionStore.ts'

/** The session set by `requireSession`. Only call this behind that middleware. */
export function getSession(res: Response): Session {
  return res.locals.session as Session
}

export const SESSION_COOKIE = 'memtime_sid'

/** Reads the session id from the request cookies, if there is one. */
export function readSessionId(cookies: unknown): string | undefined {
  if (typeof cookies !== 'object' || cookies === null) return undefined
  const value = (cookies as Record<string, unknown>)[SESSION_COOKIE]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Rejects requests without a valid session; otherwise exposes it as `res.locals.session`. */
export function requireSession(store: SessionStore): RequestHandler {
  return (req, res: Response, next) => {
    const id = readSessionId(req.cookies)
    const session = id === undefined ? undefined : store.get(id)
    if (!session) {
      next(new HttpError(401, 'Not signed in'))
      return
    }
    res.locals.session = session
    next()
  }
}
