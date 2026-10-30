export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const NETWORK_MESSAGE = "Can't reach the server. Check your connection and try again."

async function readErrorMessage(response: Response): Promise<string> {
  const fallback = `Request failed (${response.status})`
  try {
    const body = (await response.json()) as { error?: unknown }
    return typeof body.error === 'string' && body.error ? body.error : fallback
  } catch {
    return fallback
  }
}

/** Fetches JSON from our own server. Throws `ApiError` on any failure. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  } catch {
    throw new ApiError(0, NETWORK_MESSAGE)
  }

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorMessage(response))
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
