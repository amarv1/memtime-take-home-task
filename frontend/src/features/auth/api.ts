import { ApiError, apiFetch } from '@/lib/api'

export interface Session {
  expiresAt: string
}

/** Returns the current session, or null when signed out. */
export async function getSession(): Promise<Session | null> {
  try {
    return await apiFetch<Session>('/api/session')
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

export function login(apiKey: string): Promise<Session> {
  return apiFetch<Session>('/api/session', {
    method: 'POST',
    body: JSON.stringify({ apiKey }),
  })
}

export function logout(): Promise<void> {
  return apiFetch<void>('/api/session', { method: 'DELETE' })
}
