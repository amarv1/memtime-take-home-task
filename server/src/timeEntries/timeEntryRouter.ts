import { Router } from 'express'
import { HttpError } from '../middleware/errorHandler.ts'
import { getSession, requireSession } from '../middleware/requireSession.ts'
import type { SessionStore } from '../sessions/sessionStore.ts'
import type { TimeEntryService } from './timeEntryService.ts'

interface Options {
  store: SessionStore
  service: TimeEntryService
}

// Same rule as the proxy's ids: a positive integer without leading zeros.
const ID_PATTERN = /^[1-9]\d{0,9}$/

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

/** Reads an optional integer query param; `undefined` means it was not given. */
function intParam(
  value: unknown,
  name: string,
  min: number,
  max: number,
  fallback: number,
) {
  if (value === undefined) return fallback
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    const range = max === Infinity ? `at least ${min}` : `between ${min} and ${max}`
    throw new HttpError(400, `Invalid ${name}: use a whole number ${range}`)
  }
  return number
}

/** One task's time entries, newest first, from the key owner's cached entries. */
export function timeEntryRouter({ store, service }: Options) {
  const router = Router()

  router.get('/tasks/:taskId/entries', requireSession(store), async (req, res) => {
    const { taskId } = req.params
    if (typeof taskId !== 'string' || !ID_PATTERN.test(taskId))
      throw new HttpError(400, 'Invalid task id')
    const limit = intParam(req.query.limit, 'limit', 1, MAX_LIMIT, DEFAULT_LIMIT)
    const offset = intParam(req.query.offset, 'offset', 0, Infinity, 0)

    const all = await service.getAllEntries(getSession(res).apiKey)
    const mine = all
      .filter((entry) => entry.taskId === Number(taskId))
      .sort((a, b) => Date.parse(b.start) - Date.parse(a.start))

    // The data belongs to one user, so shared caches must not keep it.
    res.setHeader('Cache-Control', 'private, no-store')
    res.json({
      items: mine.slice(offset, offset + limit),
      total: mine.length,
      limit,
      offset,
    })
  })

  return router
}
