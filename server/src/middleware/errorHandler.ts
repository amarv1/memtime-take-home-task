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

  // Raised by body-parser (express.json()) for bad request bodies: malformed JSON,
  // too large, unsupported charset... It sets `status` and `expose` for us.
  const clientError = asClientError(err)
  if (clientError) {
    res.status(clientError.status).json({ error: clientError.message })
    return
  }

  logger.error(err)
  res.status(500).json({ error: 'Internal server error' })
}

const BODY_ERROR_MESSAGES: Record<string, string> = {
  'entity.parse.failed': 'Invalid JSON body',
  'entity.too.large': 'Request body too large',
}

function asClientError(err: unknown): { status: number; message: string } | undefined {
  if (typeof err !== 'object' || err === null) return undefined
  const { status, expose, type, message } = err as Record<string, unknown>
  if (typeof status !== 'number' || status < 400 || status >= 500 || expose !== true)
    return undefined
  const known = typeof type === 'string' ? BODY_ERROR_MESSAGES[type] : undefined
  return {
    status,
    message: known ?? (typeof message === 'string' ? message : 'Bad request'),
  }
}
