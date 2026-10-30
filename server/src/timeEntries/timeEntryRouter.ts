import { Router } from 'express'
import { z } from 'zod'
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

const isoDateTime = z
  .string({ error: 'is required' })
  .datetime({ offset: true, error: 'must be an ISO 8601 date and time' })
  .transform((value) => new Date(value).toISOString())

const entryBody = z
  .object({
    comment: z
      .string({ error: 'is required' })
      .trim()
      .min(1, 'is required')
      .max(1000, 'must be at most 1000 characters'),
    start: isoDateTime,
    end: isoDateTime,
  })
  .refine((entry) => Date.parse(entry.end) > Date.parse(entry.start), {
    path: ['end'],
    message: 'must be after start',
  })

/** Reads and creates one task's time entries; reads come from the key owner's cached entries. */
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

  router.post('/tasks/:taskId/entries', requireSession(store), async (req, res) => {
    const { taskId } = req.params
    if (typeof taskId !== 'string' || !ID_PATTERN.test(taskId))
      throw new HttpError(400, 'Invalid task id')
    const parsed = entryBody.safeParse(req.body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const field = issue?.path[0]
      throw new HttpError(
        400,
        typeof field === 'string'
          ? `Invalid ${field}: ${issue?.message}`
          : 'Invalid time entry',
      )
    }

    const created = await service.createEntry(getSession(res).apiKey, {
      taskId: Number(taskId),
      ...parsed.data,
    })

    res.setHeader('Cache-Control', 'private, no-store')
    res.status(201).json(created)
  })

  return router
}
