/** A warning the server asks the user to confirm. */
export interface Warning {
  code: string
  message: string
  /** Other entries an `overlap` warning is about. */
  entries?: { id: number; taskId: number; start: string; end: string }[]
}

/** What a failed answer may carry besides its message. */
interface ErrorExtras {
  /** The form field a 400 is about. */
  field?: string
  /** The warnings a 409 asks the user to confirm. */
  warnings?: Warning[]
}

export class ApiError extends Error {
  readonly status: number
  readonly field?: string
  readonly warnings?: Warning[]

  constructor(status: number, message: string, extras: ErrorExtras = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.field = extras.field
    this.warnings = extras.warnings
  }
}

const NETWORK_MESSAGE = "Can't reach the server. Check your connection and try again."

async function readError(response: Response): Promise<ApiError> {
  const fallback = `Request failed (${response.status})`
  try {
    const body = (await response.json()) as {
      error?: unknown
      field?: unknown
      warnings?: unknown
    }
    return new ApiError(
      response.status,
      typeof body.error === 'string' && body.error ? body.error : fallback,
      {
        field: typeof body.field === 'string' ? body.field : undefined,
        warnings: Array.isArray(body.warnings) ? (body.warnings as Warning[]) : undefined,
      },
    )
  } catch {
    return new ApiError(response.status, fallback)
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
    throw await readError(response)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
