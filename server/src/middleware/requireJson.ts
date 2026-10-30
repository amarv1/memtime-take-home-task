import type { RequestHandler } from 'express'
import { HttpError } from './errorHandler.ts'

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH'])

/**
 * Rejects POST/PUT/PATCH requests that aren't `Content-Type: application/json`.
 * A cross-site form or `text/plain` fetch can't send that type without a CORS
 * preflight (which we never approve), so this backs up `SameSite=Strict`.
 * DELETE is not a "simple" method, so browsers already preflight it.
 */
export const requireJson: RequestHandler = (req, _res, next) => {
  if (BODY_METHODS.has(req.method) && !req.is('application/json')) {
    next(new HttpError(415, 'Content-Type must be application/json'))
    return
  }
  next()
}
