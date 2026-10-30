import cookieParser from 'cookie-parser'
import express from 'express'
import helmet from 'helmet'
import { createMemoryCache } from './cache/memoryCache.ts'
import { loadEnv } from './env.ts'
import type { Env } from './env.ts'
import { createMemtimeClient } from './memtime/memtimeClient.ts'
import { memtimeRouter } from './memtime/memtimeRouter.ts'
import { endSessionOnRevokedKey } from './middleware/endSessionOnRevokedKey.ts'
import { errorHandler, notFound } from './middleware/errorHandler.ts'
import { requestContext, requestLogger } from './middleware/requestContext.ts'
import { requireJson } from './middleware/requireJson.ts'
import { signInLimiter } from './middleware/signInLimiter.ts'
import { sessionRouter } from './sessions/sessionRouter.ts'
import { createSessionStore } from './sessions/sessionStore.ts'
import type { SessionStore } from './sessions/sessionStore.ts'
import { createEntryChecks } from './timeEntries/entryChecks.ts'
import { createTaskLookup } from './timeEntries/taskLookup.ts'
import type { TaskLookup } from './timeEntries/taskLookup.ts'
import { timeEntryRouter } from './timeEntries/timeEntryRouter.ts'
import { createTimeEntryService } from './timeEntries/timeEntryService.ts'
import type { TimeEntry, TimeEntryService } from './timeEntries/timeEntryService.ts'

interface Options {
  env?: Env
  sessionStore?: SessionStore
  timeEntryService?: TimeEntryService
  taskLookup?: TaskLookup
}

/** Builds the Express app. Kept separate from `listen` so tests can use it directly. */
export function createApp({
  env = loadEnv(),
  sessionStore = createSessionStore({
    ttlMs: env.SESSION_TTL_MS,
    maxSessions: env.MAX_SESSIONS,
    maxPerKey: env.MAX_SESSIONS_PER_KEY,
  }),
  timeEntryService = createTimeEntryService({
    client: createMemtimeClient({ memtimeApiUrl: env.MEMTIME_API_URL }),
    // A few users at a time is plenty here; the cap only bounds memory.
    cache: createMemoryCache<TimeEntry[]>({
      ttlMs: env.TIME_ENTRIES_CACHE_TTL_MS,
      maxEntries: 100,
    }),
  }),
  taskLookup = createTaskLookup({
    client: createMemtimeClient({ memtimeApiUrl: env.MEMTIME_API_URL }),
    cache: createMemoryCache<string>({
      ttlMs: env.TIME_ENTRIES_CACHE_TTL_MS,
      maxEntries: 1000,
    }),
  }),
}: Options = {}) {
  const app = express()

  app.disable('x-powered-by')
  app.use(requestContext)
  app.use(requestLogger)
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
      secureCookies: env.COOKIE_SECURE,
    }),
  )

  app.use(
    '/api',
    timeEntryRouter({
      store: sessionStore,
      service: timeEntryService,
      checks: createEntryChecks({ service: timeEntryService, taskLookup }),
    }),
  )

  app.use(
    '/api',
    memtimeRouter({ store: sessionStore, memtimeApiUrl: env.MEMTIME_API_URL }),
  )

  app.use(notFound)
  app.use(
    endSessionOnRevokedKey(sessionStore, {
      secureCookies: env.COOKIE_SECURE,
    }),
  )
  app.use(errorHandler)

  return app
}
