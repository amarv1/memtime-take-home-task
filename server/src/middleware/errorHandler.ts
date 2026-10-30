import type { ErrorRequestHandler, RequestHandler } from 'express'
import { logger } from '../logger.ts'

/** An error with an HTTP status whose message is safe to show to the client. */
export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

/** Fallback for unmatched routes. */
export const notFound: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, 'Not found'))
}

/** Sends every error as `{ error }`, matching the upstream API's error shape. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message })
    return
  }

  // Raised by express.json() for malformed request bodies.
  if (isBodyParseError(err)) {
    res.status(400).json({ error: 'Invalid JSON body' })
    return
  }

  logger.error(err)
  res.status(500).json({ error: 'Internal server error' })
}

function isBodyParseError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    err.type === 'entity.parse.failed'
  )
}
