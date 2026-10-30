import { Router } from 'express'
import type { Response } from 'express'
import { HttpError } from '../middleware/errorHandler.ts'
import { getSession, requireSession } from '../middleware/requireSession.ts'
import type { SessionStore } from '../sessions/sessionStore.ts'
import type { MemtimeClient } from './memtimeClient.ts'

interface Options {
  store: SessionStore
  client: MemtimeClient
}

// Positive integer without leading zeros. Anything else never reaches the upstream path.
const ID_PATTERN = /^[1-9]\d{0,9}$/

const FORWARDED_PARAMS = ['limit', 'offset', 'sortBy', 'order']

// Headers a later rate-limit feature will need. Copied as they are; nothing acts on them here.
const PASSED_HEADERS = [
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
  'ratelimit-policy',
  'retry-after',
]

function parseId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value))
    throw new HttpError(400, `Invalid ${label} id`)
  return value
}

/** Keeps only the known paging/sorting params, and only when given once. */
function allowedQuery(query: Record<string, unknown>): string {
  const params = new URLSearchParams()
  for (const name of FORWARDED_PARAMS) {
    const value = query[name]
    if (typeof value === 'string') params.set(name, value)
  }
  return params.toString()
}

/**
 * Read-only proxy for the client, project and task lists, and for single task and project lookups. It adds the session's
 * API key and passes the upstream answer through: no caching, throttling or retry.
 */
export function memtimeRouter({ store, client }: Options) {
  async function forward(
    res: Response,
    upstreamPath: string,
    query: Record<string, unknown>,
    routePath: string,
  ) {
    const { status, headers, body } = await client.get(
      getSession(res).apiKey,
      upstreamPath,
      allowedQuery(query),
      routePath,
    )

    for (const name of PASSED_HEADERS) {
      const value = headers.get(name)
      if (value !== null) res.setHeader(name, value)
    }
    // The data belongs to one user, so shared caches must not keep it.
    res.setHeader('Cache-Control', 'private, no-store')
    res
      .status(status)
      .type(headers.get('content-type') ?? 'application/json')
      .send(body)
  }

  const router = Router()
  // Per route, not `router.use`: this router is mounted at /api, so a blanket
  // session check would turn every unknown /api path into a 401 instead of a 404.
  const session = requireSession(store)

  router.get('/clients', session, async (req, res) => {
    await forward(res, '/clients', req.query, '/api/clients')
  })

  router.get('/clients/:clientId/projects', session, async (req, res) => {
    const clientId = parseId(req.params.clientId, 'client')
    await forward(
      res,
      `/clients/${clientId}/projects`,
      req.query,
      '/api/clients/:clientId/projects',
    )
  })

  router.get('/projects/:projectId/tasks', session, async (req, res) => {
    const projectId = parseId(req.params.projectId, 'project')
    await forward(
      res,
      `/projects/${projectId}/tasks`,
      req.query,
      '/api/projects/:projectId/tasks',
    )
  })

  router.get('/projects/:projectId', session, async (req, res) => {
    const projectId = parseId(req.params.projectId, 'project')
    await forward(res, `/projects/${projectId}`, req.query, '/api/projects/:projectId')
  })

  router.get('/tasks/:taskId', session, async (req, res) => {
    const taskId = parseId(req.params.taskId, 'task')
    await forward(res, `/tasks/${taskId}`, req.query, '/api/tasks/:taskId')
  })

  return router
}
