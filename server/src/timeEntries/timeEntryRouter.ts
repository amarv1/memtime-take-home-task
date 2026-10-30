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
// Unlike the other ids, an entry id can be 0 (the API has such entries).
const ENTRY_ID_PATTERN = /^(0|[1-9]\d{0,9})$/

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

function readIds(params: Record<string, unknown>) {
  const { taskId, entryId } = params
  if (typeof taskId !== 'string' || !ID_PATTERN.test(taskId))
    throw new HttpError(400, 'Invalid task id')
  if (
    entryId !== undefined &&
    (typeof entryId !== 'string' || !ENTRY_ID_PATTERN.test(entryId))
  )
    throw new HttpError(400, 'Invalid entry id')
  return { taskId: Number(taskId), entryId: Number(entryId) }
}

/** The fields of an entry the user can set, or a 400 naming the first one that is wrong. */
function readEntryBody(body: unknown) {
  const parsed = entryBody.safeParse(body)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  const field = issue?.path[0]
  throw new HttpError(
    400,
    typeof field === 'string'
      ? `Invalid ${field}: ${issue?.message}`
      : 'Invalid time entry',
  )
}

/** Reads, creates, updates and deletes one task's time entries; reads come from the key owner's cached entries. */
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

  router.get(
    '/tasks/:taskId/entries/:entryId',
    requireSession(store),
    async (req, res) => {
      const { taskId, entryId } = readIds(req.params)
      const all = await service.getAllEntries(getSession(res).apiKey)
      const entry = all.find((e) => e.id === entryId && e.taskId === taskId)
      if (!entry) throw new HttpError(404, 'Time entry not found')

      res.setHeader('Cache-Control', 'private, no-store')
      res.json(entry)
    },
  )

  router.post('/tasks/:taskId/entries', requireSession(store), async (req, res) => {
    const { taskId } = readIds(req.params)
    const created = await service.createEntry(getSession(res).apiKey, {
      taskId,
      ...readEntryBody(req.body),
    })

    res.setHeader('Cache-Control', 'private, no-store')
    res.status(201).json(created)
  })

  router.put(
    '/tasks/:taskId/entries/:entryId',
    requireSession(store),
    async (req, res) => {
      const { taskId, entryId } = readIds(req.params)
      const body = readEntryBody(req.body)
      const { apiKey } = getSession(res)

      // The URL's task must own the entry, or this could move another task's entry.
      const all = await service.getAllEntries(apiKey)
      if (!all.some((e) => e.id === entryId && e.taskId === taskId))
        throw new HttpError(404, 'Time entry not found')

      const updated = await service.updateEntry(apiKey, entryId, { taskId, ...body })

      res.setHeader('Cache-Control', 'private, no-store')
      res.json(updated)
    },
  )

  router.delete(
    '/tasks/:taskId/entries/:entryId',
    requireSession(store),
    async (req, res) => {
      const { taskId, entryId } = readIds(req.params)
      const { apiKey } = getSession(res)

      // The URL's task must own the entry, or this could delete another task's entry.
      const all = await service.getAllEntries(apiKey)
      if (!all.some((e) => e.id === entryId && e.taskId === taskId))
        throw new HttpError(404, 'Time entry not found')

      await service.deleteEntry(apiKey, entryId)
      res.status(204).end()
    },
  )

  return router
}
