import { logger } from '../logger.ts'
import { HttpError } from '../middleware/errorHandler.ts'

interface Options {
  timeoutMs?: number
  fetch?: typeof globalThis.fetch
}

/**
 * Checks an API key with one cheap upstream call.
 * Returns false when the key is rejected; throws an HttpError when the check can't be completed.
 * Error messages never include the key.
 */
export async function verifyApiKey(
  baseUrl: string,
  apiKey: string,
  { timeoutMs = 10_000, fetch = globalThis.fetch }: Options = {},
): Promise<boolean> {
  // String join on purpose: `new URL('/clients', base)` would drop the `/api/v1` prefix.
  const url = `${baseUrl.replace(/\/+$/, '')}/clients?limit=1`

  let status: number
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    status = res.status
    await res.body?.cancel()
  } catch (err) {
    // Log what failed, never the key: only the error name and its cause's message.
    const reason = err instanceof Error ? err.name : 'unknown error'
    const code =
      err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : ''
    logger.error(`Memtime key check failed: ${reason}${code}`)
    throw new HttpError(502, "Couldn't reach Memtime. Please try again.")
  }

  if (status >= 200 && status < 300) return true
  if (status === 401 || status === 403) return false
  if (status === 429) {
    logger.warn('Memtime key check rate limited (429)')
    throw new HttpError(429, 'Too many attempts. Wait a minute and try again.')
  }
  logger.error(`Memtime key check failed: upstream returned ${status}`)
  throw new HttpError(502, "Couldn't reach Memtime. Please try again.")
}
