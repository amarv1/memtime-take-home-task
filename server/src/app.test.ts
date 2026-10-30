import request from 'supertest'
import { http, HttpResponse } from 'msw'
import { createApp } from './app.ts'
import { loadEnv } from './env.ts'
import { server } from './test/server.ts'

describe('app', () => {
  const app = createApp()

  it('responds to the health check', async () => {
    const res = await request(app).get('/api/health')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/api/nope')

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Not found' })
  })

  it('does not reveal that it runs on Express', async () => {
    const res = await request(app).get('/api/health')

    expect(res.headers['x-powered-by']).toBeUndefined()
  })

  it('sets security headers', async () => {
    const res = await request(app).get('/api/health')

    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['strict-transport-security']).toBeDefined()
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'self'")
  })

  describe('CSRF defence', () => {
    it.each(['text/plain', 'application/x-www-form-urlencoded'])(
      'rejects POST as %s',
      async (type) => {
        const res = await request(app)
          .post('/api/session')
          .set('Content-Type', type)
          .send('apiKey=x')

        expect(res.status).toBe(415)
        expect(res.body).toEqual({ error: 'Content-Type must be application/json' })
      },
    )

    it('rejects POST with no content type', async () => {
      const res = await request(app).post('/api/session')

      expect(res.status).toBe(415)
    })

    it('lets DELETE through without a body', async () => {
      await request(app).delete('/api/session').expect(204)
    })
  })

  describe('sign-in rate limit', () => {
    const UPSTREAM = 'https://upstream.test/api/v1'

    function limitedApp() {
      const env = loadEnv({ MEMTIME_API_URL: UPSTREAM, SIGN_IN_RATE_LIMIT: '2' })
      server.use(
        http.get(`${UPSTREAM}/clients`, () => new HttpResponse('nope', { status: 401 })),
      )
      return createApp({ env })
    }

    const attempt = (a: ReturnType<typeof createApp>) =>
      request(a).post('/api/session').send({ apiKey: 'bad' })

    it('answers 429 once an IP exceeds the limit', async () => {
      const a = limitedApp()
      await attempt(a).expect(401)
      await attempt(a).expect(401)

      const res = await attempt(a)

      expect(res.status).toBe(429)
      expect(res.body).toEqual({ error: 'Too many sign-in attempts. Try again later.' })
    })
  })
})
