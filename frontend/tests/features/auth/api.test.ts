import { http, HttpResponse } from 'msw'
import { server } from '../../support/server'
import { getSession, login, logout } from '@/features/auth/api'

const session = { expiresAt: '2030-01-01T00:00:00.000Z' }

describe('auth api', () => {
  it('getSession returns the session', async () => {
    server.use(http.get('/api/session', () => HttpResponse.json(session)))
    await expect(getSession()).resolves.toEqual(session)
  })

  it('getSession returns null on 401', async () => {
    server.use(
      http.get('/api/session', () =>
        HttpResponse.json({ error: 'Not signed in' }, { status: 401 }),
      ),
    )
    await expect(getSession()).resolves.toBeNull()
  })

  it('getSession throws on other errors', async () => {
    server.use(
      http.get('/api/session', () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    )
    await expect(getSession()).rejects.toMatchObject({ status: 500 })
  })

  it('login posts the key', async () => {
    let body: unknown
    server.use(
      http.post('/api/session', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(session)
      }),
    )
    await expect(login('secret')).resolves.toEqual(session)
    expect(body).toEqual({ apiKey: 'secret' })
  })

  it('logout sends DELETE', async () => {
    let called = false
    server.use(
      http.delete('/api/session', () => {
        called = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await logout()
    expect(called).toBe(true)
  })
})
