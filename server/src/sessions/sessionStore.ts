import { randomBytes } from 'node:crypto'

export interface Session {
  id: string
  apiKey: string
  expiresAt: number
}

export type SessionStore = ReturnType<typeof createSessionStore>

interface Options {
  ttlMs: number
  now?: () => number
  sweepIntervalMs?: number
}

/**
 * In-memory sessions with an absolute TTL (not extended by activity).
 * Expired sessions are rejected on read and swept by a background timer.
 */
export function createSessionStore({
  ttlMs,
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
