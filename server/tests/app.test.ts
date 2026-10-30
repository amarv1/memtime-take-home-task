import request from 'supertest'
import { http, HttpResponse } from 'msw'
import { createApp } from '../src/app.ts'
import { loadEnv } from '../src/env.ts'
import { server } from './support/server.ts'

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

  it('still returns a JSON 404 for unknown /api routes without a session', async () => {
    const res = await request(app).get('/api/clients/1/nope')

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

    function limitedApp(extra: NodeJS.ProcessEnv = {}) {
      const env = loadEnv({
        MEMTIME_API_URL: UPSTREAM,
        SIGN_IN_RATE_LIMIT: '2',
        ...extra,
      })
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

    it('keeps a separate limit per client behind a trusted proxy', async () => {
      const a = limitedApp({ TRUST_PROXY: '1' })
      const from = (ip: string) => attempt(a).set('X-Forwarded-For', ip)
      await from('1.1.1.1').expect(401)
      await from('1.1.1.1').expect(401)
      await from('1.1.1.1').expect(429)

      await from('2.2.2.2').expect(401)
    })

    it('shares one limit without a trusted proxy', async () => {
      const a = limitedApp()
      await attempt(a).set('X-Forwarded-For', '1.1.1.1').expect(401)
      await attempt(a).set('X-Forwarded-For', '2.2.2.2').expect(401)

      await attempt(a).set('X-Forwarded-For', '3.3.3.3').expect(429)
    })

    it('does not count successful sign-ins', async () => {
      const a = limitedApp()
      server.use(
        http.get(`${UPSTREAM}/clients`, ({ request }) =>
          request.headers.get('authorization')?.includes('good')
            ? new HttpResponse('[]', { status: 200 })
            : new HttpResponse('nope', { status: 401 }),
        ),
      )
      const good = () => request(a).post('/api/session').send({ apiKey: 'good' })

      for (let i = 0; i < 5; i++) await good().expect(200)
      await attempt(a).expect(401)
      await attempt(a).expect(401)
      await attempt(a).expect(429)
      await good().expect(429)
    })
  })
})
