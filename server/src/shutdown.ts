import type { Server } from 'node:http'
import { logger } from './logger.ts'

const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Stops accepting connections and lets in-flight requests finish before exiting.
 * Idle keep-alive sockets are closed right away, and anything still open after
 * `timeoutMs` is dropped so a stuck request can't block the process forever.
 */
export function registerGracefulShutdown(
  server: Server,
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    exit = (code) => process.exit(code),
  }: { timeoutMs?: number; exit?: (code: number) => void } = {},
) {
  let shuttingDown = false

  function shutdown(signal: string) {
    if (shuttingDown) return
    shuttingDown = true
    logger.info(`${signal} received, shutting down`)

    const timer = setTimeout(() => {
      logger.error(`Shutdown timed out after ${timeoutMs}ms, forcing exit`)
      server.closeAllConnections()
      exit(1)
    }, timeoutMs)
    timer.unref()

    server.close((err) => {
      clearTimeout(timer)
      exit(err ? 1 : 0)
    })
    server.closeIdleConnections()
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  return shutdown
}
