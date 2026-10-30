import cookieParser from 'cookie-parser'
import express from 'express'
import request from 'supertest'
import { createSessionStore } from '../../src/sessions/sessionStore.ts'
import { errorHandler } from '../../src/middleware/errorHandler.ts'
import { getSession, requireSession } from '../../src/middleware/requireSession.ts'

describe('requireSession', () => {
  let time = 0
  const store = createSessionStore({ ttlMs: 1000, now: () => time })
  afterAll(() => store.stop())

  const app = express()
  app.use(cookieParser())
  app.get('/private', requireSession(store), (_req, res) => {
    res.json({ key: getSession(res).apiKey })
  })
  app.use(errorHandler)

  it('rejects requests without a cookie', async () => {
    const res = await request(app).get('/private')

    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Not signed in' })
  })

  it('rejects an unknown session id', async () => {
    const res = await request(app).get('/private').set('Cookie', 'memtime_sid=unknown')

    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Not signed in' })
  })

  it('rejects an expired session', async () => {
    const { id } = store.create('key')
    time += 1000

    const res = await request(app).get('/private').set('Cookie', `memtime_sid=${id}`)

    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Not signed in' })
  })

  it('passes the session to the handler', async () => {
    const { id } = store.create('my-key')

    const res = await request(app).get('/private').set('Cookie', `memtime_sid=${id}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ key: 'my-key' })
  })

  it('treats a missing cookie jar as signed out', async () => {
    const bare = express()
    bare.get('/private', requireSession(store), (_req, res) => {
      res.end()
    })
    bare.use(errorHandler)

    const res = await request(bare).get('/private')

    expect(res.status).toBe(401)
  })
})
