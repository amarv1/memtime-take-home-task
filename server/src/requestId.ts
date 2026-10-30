import { AsyncLocalStorage } from 'node:async_hooks'

interface RequestInfo {
  requestId: string
  /** The request may change data (any method but GET and HEAD). */
  writing: boolean
}

const storage = new AsyncLocalStorage<RequestInfo>()

/** Runs `fn` as part of the request described by `info`. */
export function runInRequest<T>(info: RequestInfo, fn: () => T): T {
  return storage.run(info, fn)
}

/** The id of the request being handled, or undefined outside one. Lets the logger tag every line. */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId
}

/** Whether the request being handled may change data; false outside one. */
export function isWritingRequest(): boolean {
  return storage.getStore()?.writing ?? false
}
