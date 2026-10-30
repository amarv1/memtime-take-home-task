import cookieParser from 'cookie-parser'
import express from 'express'
import helmet from 'helmet'
import { loadEnv } from './env.ts'
import type { Env } from './env.ts'
import { endSessionOnRevokedKey } from './middleware/endSessionOnRevokedKey.ts'
import { errorHandler, notFound } from './middleware/errorHandler.ts'
import { requireJson } from './middleware/requireJson.ts'
import { signInLimiter } from './middleware/signInLimiter.ts'
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
  sessionStore = createSessionStore({
    ttlMs: env.SESSION_TTL_MS,
    maxSessions: env.MAX_SESSIONS,
    maxPerKey: env.MAX_SESSIONS_PER_KEY,
  }),
}: Options = {}) {
  const app = express()

  app.disable('x-powered-by')
  app.use(helmet())
  app.use(requireJson)
  app.use(express.json())
  app.use(cookieParser())

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  app.post('/api/session', signInLimiter(env.SIGN_IN_RATE_LIMIT))
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
