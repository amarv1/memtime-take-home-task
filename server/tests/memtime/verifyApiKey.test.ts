import { http, HttpResponse, delay } from 'msw'
import { server } from '../support/server.ts'
import { HttpError } from '../../src/middleware/errorHandler.ts'
import { logger } from '../../src/logger.ts'
import { verifyApiKey } from '../../src/memtime/verifyApiKey.ts'

const BASE = 'https://upstream.test/api/v1'
const KEY = 'secret-key-123'

function respondWith(status: number, body = 'x') {
  server.use(http.get(`${BASE}/clients`, () => new HttpResponse(body, { status })))
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

    expect(await verifyApiKey(BASE, KEY)).toBe(true)
    expect(seen).toEqual({ url: `${BASE}/clients?limit=1`, auth: `Bearer ${KEY}` })
  })

  it('tolerates a trailing slash on the base URL', async () => {
    respondWith(200)

    expect(await verifyApiKey(`${BASE}/`, KEY)).toBe(true)
  })

  it.each([401, 403])('returns false for %i', async (status) => {
    respondWith(status, 'Unauthorized')

    expect(await verifyApiKey(BASE, KEY)).toBe(false)
  })

  it('throws a 429 HttpError when rate limited', async () => {
    respondWith(429)

    const err = await failure(verifyApiKey(BASE, KEY))

    expect(err).toBeInstanceOf(HttpError)
    expect(err).toMatchObject({ status: 429 })
  })

  it.each([500, 404])('throws a 502 HttpError for upstream %i', async (status) => {
    respondWith(status)

    expect(await failure(verifyApiKey(BASE, KEY))).toMatchObject({ status: 502 })
  })

  it('throws a 502 HttpError on a network error', async () => {
    server.use(http.get(`${BASE}/clients`, () => HttpResponse.error()))

    expect(await failure(verifyApiKey(BASE, KEY))).toMatchObject({ status: 502 })
  })

  it('throws a 502 HttpError on timeout', async () => {
    server.use(
      http.get(`${BASE}/clients`, async () => {
        await delay(500)
        return HttpResponse.json([])
      }),
    )

    expect(await failure(verifyApiKey(BASE, KEY, { timeoutMs: 20 }))).toMatchObject({
      status: 502,
    })
  })

  it('never includes the key in error messages', async () => {
    for (const status of [429, 500]) {
      respondWith(status)
      const err = await failure(verifyApiKey(BASE, KEY))
      expect((err as Error).message).not.toContain(KEY)
    }
    server.use(http.get(`${BASE}/clients`, () => HttpResponse.error()))
    expect(((await failure(verifyApiKey(BASE, KEY))) as Error).message).not.toContain(KEY)
  })

  describe('logging', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it.each([500, 404])('logs an error for upstream %i', async (status) => {
      const error = vi.spyOn(logger, 'error').mockImplementation(vi.fn())
      respondWith(status)

      await failure(verifyApiKey(BASE, KEY))

      expect(error).toHaveBeenCalledWith(expect.stringContaining(String(status)))
    })

    it('logs an error on a network failure', async () => {
      const error = vi.spyOn(logger, 'error').mockImplementation(vi.fn())
      server.use(http.get(`${BASE}/clients`, () => HttpResponse.error()))

      await failure(verifyApiKey(BASE, KEY))

      expect(error).toHaveBeenCalledOnce()
    })

    it('warns when rate limited', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(vi.fn())
      respondWith(429)

      await failure(verifyApiKey(BASE, KEY))

      expect(warn).toHaveBeenCalledOnce()
    })

    it('does not log a rejected key, which is the caller’s mistake, not an outage', async () => {
      const error = vi.spyOn(logger, 'error').mockImplementation(vi.fn())
      respondWith(401)

      await verifyApiKey(BASE, KEY)

      expect(error).not.toHaveBeenCalled()
    })

    it('never puts the key in a log line', async () => {
      const error = vi.spyOn(logger, 'error').mockImplementation(vi.fn())
      respondWith(500)
      await failure(verifyApiKey(BASE, KEY))
      server.use(http.get(`${BASE}/clients`, () => HttpResponse.error()))
      await failure(verifyApiKey(BASE, KEY))

      expect(JSON.stringify(error.mock.calls)).not.toContain(KEY)
    })
  })
})
