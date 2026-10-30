import { http, HttpResponse, delay } from 'msw'
import { server } from '../support/server.ts'
import { HttpError } from '../../src/middleware/errorHandler.ts'
import { logger } from '../../src/logger.ts'
import {
  CircuitOpenError,
  createCircuitBreaker,
} from '../../src/memtime/circuitBreaker.ts'
import { createMemtimeClient } from '../../src/memtime/memtimeClient.ts'
import { verifyApiKey } from '../../src/memtime/verifyApiKey.ts'

const BASE = 'https://upstream.test/api/v1'
const KEY = 'secret-key-123'

function respondWith(status: number, body = 'x') {
  server.use(http.get(`${BASE}/clients`, () => new HttpResponse(body, { status })))
}

function check(base = BASE, timeoutMs?: number) {
  const breaker = createCircuitBreaker({ failureThreshold: 1000, openMs: 1000 })
  const client = createMemtimeClient({ memtimeApiUrl: base, timeoutMs, breaker })
  return verifyApiKey(client, KEY)
}

async function failure(promise: Promise<unknown>) {
  try {
    await promise
  } catch (err) {
    return err
  }
  throw new Error('expected rejection')
}

describe('verifyApiKey', () => {
  it('calls <base>/clients?limit=1 with the bearer token', async () => {
    let seen: { url: string; auth: string | null } | undefined
    server.use(
      http.get(`${BASE}/clients`, ({ request }) => {
        seen = { url: request.url, auth: request.headers.get('authorization') }
        return HttpResponse.json([])
      }),
    )

    expect(await check()).toBe(true)
    expect(seen).toEqual({ url: `${BASE}/clients?limit=1`, auth: `Bearer ${KEY}` })
  })

  it('tolerates a trailing slash on the base URL', async () => {
    respondWith(200)

    expect(await check(`${BASE}/`)).toBe(true)
  })

  it.each([401, 403])('returns false for %i', async (status) => {
    respondWith(status, 'Unauthorized')

    expect(await check()).toBe(false)
  })

  it('throws a 429 HttpError when rate limited', async () => {
    respondWith(429)

    const err = await failure(check())

    expect(err).toBeInstanceOf(HttpError)
    expect(err).toMatchObject({ status: 429 })
  })

  it.each([500, 404])('throws a 502 HttpError for upstream %i', async (status) => {
    respondWith(status)

    expect(await failure(check())).toMatchObject({ status: 502 })
  })

  it('throws a 502 HttpError on a network error', async () => {
    server.use(http.get(`${BASE}/clients`, () => HttpResponse.error()))

    expect(await failure(check())).toMatchObject({ status: 502 })
  })

  it('throws a 502 HttpError on timeout', async () => {
    server.use(
      http.get(`${BASE}/clients`, async () => {
        await delay(500)
        return HttpResponse.json([])
      }),
    )

    expect(await failure(check(BASE, 20))).toMatchObject({
      status: 502,
    })
  })

  it('never includes the key in error messages', async () => {
    for (const status of [429, 500]) {
      respondWith(status)
      const err = await failure(check())
      expect((err as Error).message).not.toContain(KEY)
    }
    server.use(http.get(`${BASE}/clients`, () => HttpResponse.error()))
    expect(((await failure(check())) as Error).message).not.toContain(KEY)
  })

  describe('logging', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it.each([500, 404])('logs an error for upstream %i', async (status) => {
      const error = vi.spyOn(logger, 'error').mockImplementation(vi.fn())
      respondWith(status)

      await failure(check())

      expect(error).toHaveBeenCalledWith(expect.stringContaining(String(status)))
    })

    it('logs an error on a network failure', async () => {
      const error = vi.spyOn(logger, 'error').mockImplementation(vi.fn())
      server.use(http.get(`${BASE}/clients`, () => HttpResponse.error()))

      await failure(check())

      expect(error).toHaveBeenCalledOnce()
    })

    it('lets a CircuitOpenError through unchanged', async () => {
      const breaker = createCircuitBreaker({ failureThreshold: 1, openMs: 30_000 })
      const client = createMemtimeClient({ memtimeApiUrl: BASE, breaker })
      respondWith(500)
      await failure(verifyApiKey(client, KEY))

      const err = await failure(verifyApiKey(client, KEY))

      expect(err).toBeInstanceOf(CircuitOpenError)
      expect(err).toMatchObject({ status: 503 })
    })

    it('warns when rate limited', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(vi.fn())
      respondWith(429)

      await failure(check())

      expect(warn).toHaveBeenCalledOnce()
    })

    it('does not log a rejected key, which is the caller’s mistake, not an outage', async () => {
      const error = vi.spyOn(logger, 'error').mockImplementation(vi.fn())
      respondWith(401)

      await check()

      expect(error).not.toHaveBeenCalled()
    })

    it('never puts the key in a log line', async () => {
      const error = vi.spyOn(logger, 'error').mockImplementation(vi.fn())
      respondWith(500)
      await failure(check())
      server.use(http.get(`${BASE}/clients`, () => HttpResponse.error()))
      await failure(check())

      expect(JSON.stringify(error.mock.calls)).not.toContain(KEY)
    })
  })
})
