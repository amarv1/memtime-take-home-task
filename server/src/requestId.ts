import { AsyncLocalStorage } from 'node:async_hooks'

const storage = new AsyncLocalStorage<{ requestId: string }>()

/** Runs `fn` with `requestId` as the current request id. */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn)
}

/** The id of the request being handled, or undefined outside one. Lets the logger tag every line. */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId
}
