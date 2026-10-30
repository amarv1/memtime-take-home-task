import cookieParser from 'cookie-parser'
import express from 'express'
import { loadEnv } from './env.ts'
import type { Env } from './env.ts'
import { endSessionOnRevokedKey } from './middleware/endSessionOnRevokedKey.ts'
import { errorHandler, notFound } from './middleware/errorHandler.ts'
import { sessionRouter } from './sessions/sessionRouter.ts'
import { createSessionStore } from './sessions/sessionStore.ts'
import type { SessionStore } from './sessions/sessionStore.ts'

interface Options {
  env?: Env
  sessionStore?: SessionStore
}

/** Builds the Express app. Kept separate from `listen` so tests can use it directly. */
export function createApp({
  env = loadEnv(),
  sessionStore = createSessionStore({ ttlMs: env.SESSION_TTL_MS }),
}: Options = {}) {
  const app = express()

  app.disable('x-powered-by')
  app.use(express.json())
  app.use(cookieParser())

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  app.use(
    '/api/session',
    sessionRouter({
      store: sessionStore,
      memtimeApiUrl: env.MEMTIME_API_URL,
      ttlMs: env.SESSION_TTL_MS,
      secureCookies: env.NODE_ENV === 'production',
    }),
  )

  app.use(notFound)
  app.use(
    endSessionOnRevokedKey(sessionStore, {
      secureCookies: env.NODE_ENV === 'production',
    }),
  )
  app.use(errorHandler)

  return app
}
