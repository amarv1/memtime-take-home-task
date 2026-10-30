import { http, HttpResponse } from 'msw'
import { server } from './server'

export const testSession = { expiresAt: '2030-01-01T00:00:00.000Z' }

/** Mocks GET /api/session as signed in (or signed out). */
export function mockSession(signedIn: boolean) {
  server.use(
    http.get('/api/session', () =>
      signedIn
        ? HttpResponse.json(testSession)
        : HttpResponse.json({ error: 'Not signed in' }, { status: 401 }),
    ),
  )
}
