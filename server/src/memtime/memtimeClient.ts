import { logger } from '../logger.ts'
import { MemtimeKeyRejectedError } from '../middleware/endSessionOnRevokedKey.ts'
import { HttpError } from '../middleware/errorHandler.ts'

interface Options {
  memtimeApiUrl: string
  timeoutMs?: number
  fetch?: typeof globalThis.fetch
}

export interface MemtimeResponse {
  status: number
  headers: Headers
  body: string
}

export type MemtimeClient = ReturnType<typeof createMemtimeClient>

/**
 * Calls the Memtime API with an API key. Maps a network failure or timeout to a 502 and a 401 to
 * `MemtimeKeyRejectedError`; any other status is returned as it is for the caller to judge.
 */
export function createMemtimeClient({
  memtimeApiUrl,
  timeoutMs = 10_000,
  fetch,
}: Options) {
  // String join on purpose: `new URL('/clients', base)` would drop the `/api/v1` prefix.
  const baseUrl = memtimeApiUrl.replace(/\/+$/, '')

  /** `label` names the call in logs (a route pattern), so the key and the URL stay out of them. */
  async function get(
    apiKey: string,
    upstreamPath: string,
    search: string,
    label: string,
  ): Promise<MemtimeResponse> {
    const url = `${baseUrl}${upstreamPath}${search ? `?${search}` : ''}`

    let status: number
    let body: string
    let headers: Headers
    try {
      // Looked up per call so a patched global fetch (as in tests) is always picked up.
      const upstream = await (fetch ?? globalThis.fetch)(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
      status = upstream.status
      headers = upstream.headers
      body = await upstream.text()
    } catch (err) {
      // Log what failed, never the key or the URL: only the error name and its cause's message.
      const reason = err instanceof Error ? err.name : 'unknown error'
      const code =
        err instanceof Error && err.cause instanceof Error
          ? ` (${err.cause.message})`
          : ''
      logger.error(`Memtime request failed for ${label}: ${reason}${code}`)
      throw new HttpError(502, "Couldn't reach Memtime. Please try again.")
    }

    if (status === 401) throw new MemtimeKeyRejectedError()
    if (status >= 500) logger.warn(`Memtime returned ${status} for ${label}`)

    return { status, headers, body }
  }

  return { get }
}
