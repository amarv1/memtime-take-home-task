import { randomUUID } from 'node:crypto'
import type { RequestHandler } from 'express'
import { logger } from '../logger.ts'
import { runInRequest } from '../requestId.ts'

/**
 * Gives each request a fresh id, returned as `X-Request-Id` and attached to every log
 * line written while handling it. A client-supplied id is ignored on purpose: it would
 * let callers forge or inject log content. Also records whether the request may change data.
 */
export const requestContext: RequestHandler = (req, res, next) => {
  const requestId = randomUUID()
  res.setHeader('X-Request-Id', requestId)
  const writing = req.method !== 'GET' && req.method !== 'HEAD'
  runInRequest({ requestId, writing }, next)
}

/** Logs one line per finished request. Health checks are demoted so probes don't flood the log. */
export const requestLogger: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint()
  res.on('finish', () => {
    const durationMs = Math.round(Number(process.hrtime.bigint() - start) / 1e6)
    // Path only: query strings can carry values we don't want in logs.
    const path = req.originalUrl.split('?')[0] ?? ''
    // Health paths stay at debug even when not ready, so a down probe doesn't spam error logs.
    const isHealth = path === '/api/health' || path.startsWith('/api/health/')
    const level = isHealth ? 'debug' : res.statusCode >= 500 ? 'error' : 'info'
    logger.log(level, `${req.method} ${path} ${res.statusCode} ${durationMs}ms`)
  })
  next()
}
