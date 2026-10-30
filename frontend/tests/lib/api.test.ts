import { http, HttpResponse } from 'msw'
import { server } from '../support/server'
import { ApiError, apiFetch } from '@/lib/api'

describe('apiFetch', () => {
  it('returns parsed JSON and sends JSON headers with a body', async () => {
    let contentType: string | null = null
    let credentialsOk = false
    server.use(
      http.post('/api/thing', ({ request }) => {
        contentType = request.headers.get('content-type')
        credentialsOk = request.credentials === 'same-origin'
        return HttpResponse.json({ ok: true })
      }),
    )
    const result = await apiFetch<{ ok: boolean }>('/api/thing', {
      method: 'POST',
      body: JSON.stringify({ a: 1 }),
    })
    expect(result).toEqual({ ok: true })
    expect(contentType).toBe('application/json')
    expect(credentialsOk).toBe(true)
  })

  it('does not set a content type without a body', async () => {
    let contentType: string | null = 'unset'
    server.use(
      http.get('/api/thing', ({ request }) => {
        contentType = request.headers.get('content-type')
        return HttpResponse.json({})
      }),
    )
    await apiFetch('/api/thing')
    expect(contentType).toBeNull()
  })

  it('keeps a caller-provided content type', async () => {
    let contentType: string | null = null
    server.use(
      http.post('/api/thing', ({ request }) => {
        contentType = request.headers.get('content-type')
        return HttpResponse.json({})
      }),
    )
    await apiFetch('/api/thing', {
      method: 'POST',
      body: 'x',
      headers: { 'Content-Type': 'text/plain' },
    })
    expect(contentType).toContain('text/plain')
  })

  it('returns undefined for 204', async () => {
    server.use(http.delete('/api/thing', () => new HttpResponse(null, { status: 204 })))
    await expect(apiFetch('/api/thing', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('throws ApiError with the server message and status', async () => {
    server.use(
      http.get('/api/thing', () => HttpResponse.json({ error: 'Nope' }, { status: 400 })),
    )
    await expect(apiFetch('/api/thing')).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'Nope',
    })
  })

  it('falls back when the error body is not JSON', async () => {
    server.use(
      http.get('/api/thing', () => HttpResponse.text('Unauthorized', { status: 401 })),
    )
    const error = await apiFetch('/api/thing').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 401, message: 'Request failed (401)' })
  })

  it('falls back when the JSON body has no error string', async () => {
    server.use(
      http.get('/api/thing', () => HttpResponse.json({ error: 5 }, { status: 500 })),
    )
    await expect(apiFetch('/api/thing')).rejects.toMatchObject({
      message: 'Request failed (500)',
    })
  })

  it('keeps the field of a 400 and the warnings of a 409', async () => {
    const warnings = [{ code: 'overlap', field: 'start', message: 'Overlaps' }]
    server.use(
      http.get('/api/a', () =>
        HttpResponse.json({ error: 'Bad', field: 'end', code: 'x' }, { status: 400 }),
      ),
      http.get('/api/b', () =>
        HttpResponse.json({ error: 'Confirm', warnings }, { status: 409 }),
      ),
    )

    await expect(apiFetch('/api/a')).rejects.toMatchObject({ field: 'end' })
    await expect(apiFetch('/api/b')).rejects.toMatchObject({ status: 409, warnings })
  })

  it('ignores a field or warnings of the wrong type', async () => {
    server.use(
      http.get('/api/a', () =>
        HttpResponse.json({ error: 'Bad', field: 3, warnings: 'x' }, { status: 409 }),
      ),
    )

    const error = await apiFetch('/api/a').catch((e: unknown) => e)

    expect(error).toMatchObject({ field: undefined, warnings: undefined })
  })

  it('maps a network failure to status 0', async () => {
    server.use(http.get('/api/thing', () => HttpResponse.error()))
    await expect(apiFetch('/api/thing')).rejects.toMatchObject({
      status: 0,
      message: "Can't reach the server. Check your connection and try again.",
    })
  })
})

describe('ApiError retryAfterSeconds', () => {
  const failWith = async (headers: Record<string, string>) => {
    server.use(
      http.get('/api/thing', () =>
        HttpResponse.json({ error: 'slow' }, { status: 429, headers }),
      ),
    )
    return (await apiFetch('/api/thing').catch((e: unknown) => e)) as ApiError
  }

  it('reads whole seconds from Retry-After', async () => {
    expect((await failWith({ 'Retry-After': '23' })).retryAfterSeconds).toBe(23)
  })

  it.each([['Wed, 21 Oct 2026 07:28:00 GMT'], ['1.5'], ['-3'], ['soon'], ['']])(
    'ignores %j',
    async (value) => {
      expect((await failWith({ 'Retry-After': value })).retryAfterSeconds).toBeUndefined()
    },
  )

  it('is unset without the header', async () => {
    expect((await failWith({})).retryAfterSeconds).toBeUndefined()
  })
})
