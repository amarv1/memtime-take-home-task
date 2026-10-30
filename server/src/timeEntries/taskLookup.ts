import { hashApiKey } from '../cache/hashApiKey.ts'
import type { Cache } from '../cache/memoryCache.ts'
import type { MemtimeClient } from '../memtime/memtimeClient.ts'
import { HttpError } from '../middleware/errorHandler.ts'
import { throwIfRateLimited } from '../memtime/rateLimit.ts'

interface Options {
  client: MemtimeClient
  /** Holds a task's status; the same TTL as the entries keeps the two views about equally fresh. */
  cache: Cache<string>
}

export type TaskLookup = ReturnType<typeof createTaskLookup>

/** Looks up a task's status for the rules that depend on it, one upstream call per task until the cache expires. */
export function createTaskLookup({ client, cache }: Options) {
  return {
    /** The task's status, or a 404 when the task doesn't exist. */
    async getStatus(apiKey: string, taskId: number): Promise<string> {
      const key = `${hashApiKey(apiKey)}:${taskId}`
      const cached = await cache.get(key)
      if (cached !== undefined) return cached

      const { status, headers, body } = await client.get(
        apiKey,
        `/tasks/${taskId}`,
        '',
        '/api/tasks/:taskId/entries',
      )
      throwIfRateLimited(status, headers)
      if (status === 404) throw new HttpError(404, 'Task not found')
      if (status < 200 || status >= 300)
        throw new HttpError(502, 'Memtime could not return the task.')

      try {
        const task = JSON.parse(body) as { status?: unknown }
        if (typeof task.status === 'string') {
          await cache.set(key, task.status)
          return task.status
        }
      } catch {
        // Falls through to the error below.
      }
      throw new HttpError(502, 'Memtime sent an unexpected answer.')
    },
  }
}
