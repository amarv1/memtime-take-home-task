import cookieParser from 'cookie-parser'
import express from 'express'
import request from 'supertest'
import { logger } from '../logger.ts'
import { createSessionStore } from '../sessions/sessionStore.ts'
import {
  MemtimeKeyRejectedError,
  endSessionOnRevokedKey,
} from './endSessionOnRevokedKey.ts'
import { errorHandler } from './errorHandler.ts'
import { requireSession } from './requireSession.ts'

describe('endSessionOnRevokedKey', () => {
  const store = createSessionStore({ ttlMs: 60_000 })
  afterAll(() => store.stop())

  const app = express()
  app.use(cookieParser())
  app.get('/revoked', requireSession(store), () => {
    throw new MemtimeKeyRejectedError()
  })
  app.get('/broken', () => {
    throw new Error('boom')
  })
  app.use(endSessionOnRevokedKey(store, { secureCookies: false }))
  app.use(errorHandler)

  it('deletes the session, clears the cookie and answers 401', async () => {
    const { id } = store.create('key')

    const res = await request(app).get('/revoked').set('Cookie', `memtime_sid=${id}`)

    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Your API key was rejected. Sign in again.' })
    expect(store.get(id)).toBeUndefined()
    expect(String(res.headers['set-cookie'])).toMatch(/memtime_sid=;/)

    const again = await request(app).get('/revoked').set('Cookie', `memtime_sid=${id}`)
    expect(again.body).toEqual({ error: 'Not signed in' })
  })

  it('leaves other errors alone', async () => {
    const { id } = store.create('key')
    vi.spyOn(logger, 'error').mockImplementation(vi.fn())

    const res = await request(app).get('/broken').set('Cookie', `memtime_sid=${id}`)

    expect(res.status).toBe(500)
    expect(store.get(id)).toBeDefined()
  })
})
