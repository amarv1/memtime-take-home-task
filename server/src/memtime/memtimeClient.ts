import { logger } from '../logger.ts'
import { isWritingRequest } from '../requestId.ts'
import { MemtimeKeyRejectedError } from '../middleware/endSessionOnRevokedKey.ts'
import { HttpError } from '../middleware/errorHandler.ts'
import { CircuitOpenError } from './circuitBreaker.ts'
import type { CircuitBreaker } from './circuitBreaker.ts'
import { RateLimitedError } from './rateLimit.ts'
import type { RateLimitGate } from './rateLimitGate.ts'

interface Options {
  memtimeApiUrl: string
  timeoutMs?: number
  /** Shared by every call, so one outage is noticed once. Without it, calls always go through. */
  breaker?: CircuitBreaker
  /** Shared by every call, so a key's budget is tracked once. Without it, calls always go through. */
  gate?: RateLimitGate
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
 * Calls go through the circuit breaker: network failures, timeouts and 5xx count against it,
 * while any other answer (401 and 429 included) shows Memtime is up. While it is open, calls
 * throw `CircuitOpenError` without reaching Memtime.
 * Outside the breaker sits the rate-limit gate (a GET while serving a GET is a read, the rest are writes): it throws
 * `RateLimitedError` without a call when the key's budget is used up, so that is no failure for
 * the breaker.
 */
export function createMemtimeClient({
  memtimeApiUrl,
  timeoutMs = 10_000,
  breaker,
  gate,
  fetch,
}: Options) {
  // String join on purpose: `new URL('/clients', base)` would drop the `/api/v1` prefix.
  const baseUrl = memtimeApiUrl.replace(/\/+$/, '')

  /** `label` names the call in logs (a route pattern), so the key and the URL stay out of them. */
  async function send(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    apiKey: string,
    upstreamPath: string,
    search: string,
    label: string,
    payload?: unknown,
  ): Promise<MemtimeResponse> {
    const url = `${baseUrl}${upstreamPath}${search ? `?${search}` : ''}`

    const call = async (): Promise<MemtimeResponse> => {
      // Looked up per call so a patched global fetch (as in tests) is always picked up.
      const upstream = await (fetch ?? globalThis.fetch)(url, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      })
      return {
        status: upstream.status,
        headers: upstream.headers,
        body: await upstream.text(),
      }
    }

    const guarded = () => (breaker ? breaker.run(call, (r) => r.status >= 500) : call())
    // Reads made while handling a save (its checks) count as writes, so the reserve covers the whole save.
    const kind = method === 'GET' && !isWritingRequest() ? 'read' : 'write'

    let response: MemtimeResponse
    try {
      response = gate ? await gate.run(apiKey, kind, guarded) : await guarded()
    } catch (err) {
      if (err instanceof CircuitOpenError || err instanceof RateLimitedError) throw err
      // Log what failed, never the key or the URL: only the error name and its cause's message.
      const reason = err instanceof Error ? err.name : 'unknown error'
      const code =
        err instanceof Error && err.cause instanceof Error
          ? ` (${err.cause.message})`
          : ''
      logger.error(`Memtime request failed for ${label}: ${reason}${code}`)
      throw new HttpError(502, "Couldn't reach Memtime. Please try again.")
    }
    const { status, headers, body } = response

    if (status === 401) throw new MemtimeKeyRejectedError()
    if (status >= 500) logger.warn(`Memtime returned ${status} for ${label}`)

    return { status, headers, body }
  }

  return {
    get: (apiKey: string, upstreamPath: string, search: string, label: string) =>
      send('GET', apiKey, upstreamPath, search, label),
    post: (apiKey: string, upstreamPath: string, payload: unknown, label: string) =>
      send('POST', apiKey, upstreamPath, '', label, payload),
    delete: (apiKey: string, upstreamPath: string, label: string) =>
      send('DELETE', apiKey, upstreamPath, '', label),
    put: (apiKey: string, upstreamPath: string, payload: unknown, label: string) =>
      send('PUT', apiKey, upstreamPath, '', label, payload),
  }
}
