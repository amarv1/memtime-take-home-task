import cookieParser from 'cookie-parser'
import express from 'express'
import helmet from 'helmet'
import { createMemoryCache } from './cache/memoryCache.ts'
import { loadEnv } from './env.ts'
import type { Env } from './env.ts'
import { healthRouter } from './health/healthRouter.ts'
import { createReadinessCheck } from './health/readiness.ts'
import { createCircuitBreaker } from './memtime/circuitBreaker.ts'
import type { CircuitBreaker } from './memtime/circuitBreaker.ts'
import { createMemtimeClient } from './memtime/memtimeClient.ts'
import type { MemtimeClient } from './memtime/memtimeClient.ts'
import { createRateLimitGate } from './memtime/rateLimitGate.ts'
import type { RateLimitGate } from './memtime/rateLimitGate.ts'
import { memtimeRouter } from './memtime/memtimeRouter.ts'
import { verifyApiKey } from './memtime/verifyApiKey.ts'
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
import type { TimeEntryService } from './timeEntries/timeEntryService.ts'
import type { Snapshot } from './timeEntries/entrySnapshot.ts'

interface Options {
  env?: Env
  sessionStore?: SessionStore
  /** One breaker for every Memtime call; tests inject one to control its clock. */
  breaker?: CircuitBreaker
  /** One gate for every Memtime call; tests inject one to control its clock. */
  rateLimitGate?: RateLimitGate
  /** Must use the same breaker as `breaker`, or the readiness check won't see its state. */
  memtimeClient?: MemtimeClient
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
  breaker = createCircuitBreaker({
    failureThreshold: env.MEMTIME_BREAKER_THRESHOLD,
    openMs: env.MEMTIME_BREAKER_OPEN_MS,
  }),
  rateLimitGate = createRateLimitGate(),
  memtimeClient = createMemtimeClient({
    memtimeApiUrl: env.MEMTIME_API_URL,
    breaker,
    gate: rateLimitGate,
  }),
  timeEntryService = createTimeEntryService({
    client: memtimeClient,
    // A few users at a time is plenty here; the cap only bounds memory.
    cache: createMemoryCache<Snapshot>({
      ttlMs: env.TIME_ENTRIES_KEEP_MS,
      maxEntries: 100,
    }),
    freshMs: env.TIME_ENTRIES_CACHE_TTL_MS,
  }),
  taskLookup = createTaskLookup({
    client: memtimeClient,
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

  app.use(
    '/api/health',
    healthRouter({
      readiness: createReadinessCheck({
        breaker,
        healthUrl: new URL('/health', env.MEMTIME_API_URL).toString(),
      }),
    }),
  )

  app.post('/api/session', signInLimiter(env.SIGN_IN_RATE_LIMIT))
  app.use(
    '/api/session',
    sessionRouter({
      store: sessionStore,
      verify: (apiKey) => verifyApiKey(memtimeClient, apiKey),
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

  app.use('/api', memtimeRouter({ store: sessionStore, client: memtimeClient }))

  app.use(notFound)
  app.use(
    endSessionOnRevokedKey(sessionStore, {
      secureCookies: env.COOKIE_SECURE,
    }),
  )
  app.use(errorHandler)

  return app
}
