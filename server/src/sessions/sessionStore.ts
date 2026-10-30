import { randomBytes } from 'node:crypto'

export interface Session {
  id: string
  apiKey: string
  expiresAt: number
}

/** Thrown when the store is full of unexpired sessions. */
export class SessionLimitError extends Error {
  constructor() {
    super('Session limit reached')
    this.name = 'SessionLimitError'
  }
}

export type SessionStore = ReturnType<typeof createSessionStore>

interface Options {
  ttlMs: number
  /** Most sessions held at once; `create` throws `SessionLimitError` beyond it. */
  maxSessions?: number
  /** Most sessions per API key; the oldest is dropped to make room. */
  maxPerKey?: number
  now?: () => number
  sweepIntervalMs?: number
}

/**
 * In-memory sessions with an absolute TTL (not extended by activity).
 * Expired sessions are rejected on read and swept by a background timer.
 */
export function createSessionStore({
  ttlMs,
  maxSessions = Infinity,
  maxPerKey = Infinity,
  now = Date.now,
  sweepIntervalMs = 60_000,
}: Options) {
  const sessions = new Map<string, Session>()

  function sweep() {
    const current = now()
    for (const [id, session] of sessions) {
      if (current >= session.expiresAt) sessions.delete(id)
    }
  }

  const timer = setInterval(sweep, sweepIntervalMs)
  timer.unref()

  return {
    create(apiKey: string): Session {
      // Map keeps insertion order, so the first matches are the oldest.
      const own = [...sessions.values()].filter((s) => s.apiKey === apiKey)
      for (const old of own.slice(0, Math.max(0, own.length - maxPerKey + 1))) {
        sessions.delete(old.id)
      }

      if (sessions.size >= maxSessions) sweep()
      if (sessions.size >= maxSessions) throw new SessionLimitError()

      const session: Session = {
        id: randomBytes(32).toString('base64url'),
        apiKey,
        expiresAt: now() + ttlMs,
      }
      sessions.set(session.id, session)
      return session
    },

    get(id: string): Session | undefined {
      const session = sessions.get(id)
      if (!session) return undefined
      if (now() >= session.expiresAt) {
        sessions.delete(id)
        return undefined
      }
      return session
    },

    delete(id: string): void {
      sessions.delete(id)
    },

    sweep,

    /** Stops the background sweep. */
    stop(): void {
      clearInterval(timer)
    },
  }
}
