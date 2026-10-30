import { Router } from 'express'
import { z } from 'zod'
import { verifyApiKey } from '../memtime/verifyApiKey.ts'
import { HttpError } from '../middleware/errorHandler.ts'
import {
  SESSION_COOKIE,
  readSessionId,
  sessionCookieOptions,
} from '../middleware/requireSession.ts'
import { SessionLimitError } from './sessionStore.ts'
import type { Session, SessionStore } from './sessionStore.ts'

const bodySchema = z.object({ apiKey: z.string().trim().min(1).max(512) })

interface Options {
  store: SessionStore
  memtimeApiUrl: string
  ttlMs: number
  secureCookies: boolean
  verify?: typeof verifyApiKey
}

const toBody = (session: Session) => ({
  expiresAt: new Date(session.expiresAt).toISOString(),
})

/** Sign in, check, and sign out. The API key itself never leaves the server. */
export function sessionRouter({
  store,
  memtimeApiUrl,
  ttlMs,
  secureCookies,
  verify = verifyApiKey,
}: Options) {
  const cookieOptions = sessionCookieOptions(secureCookies)

  const router = Router()

  router.post('/', async (req, res) => {
    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, 'API key is required')
    const { apiKey } = parsed.data

    if (!(await verify(memtimeApiUrl, apiKey)))
      throw new HttpError(401, 'Invalid API key')

    const oldId = readSessionId(req.cookies)
    if (oldId) store.delete(oldId)

    let session: Session
    try {
      session = store.create(apiKey)
    } catch (err) {
      if (err instanceof SessionLimitError)
        throw new HttpError(503, 'Too many active sessions. Try again later.')
      throw err
    }
    res.cookie(SESSION_COOKIE, session.id, {
      ...cookieOptions,
      maxAge: Math.floor(ttlMs / 1000) * 1000,
    })
    res.json(toBody(session))
  })

  router.get('/', (req, res) => {
    const id = readSessionId(req.cookies)
    const session = id === undefined ? undefined : store.get(id)
    if (!session) {
      // Drop a stale cookie so the browser stops sending it.
      if (id !== undefined) res.clearCookie(SESSION_COOKIE, cookieOptions)
      throw new HttpError(401, 'Not signed in')
    }
    res.json(toBody(session))
  })

  router.delete('/', (req, res) => {
    const id = readSessionId(req.cookies)
    if (id) store.delete(id)
    res.clearCookie(SESSION_COOKIE, cookieOptions)
    res.status(204).end()
  })

  return router
}
