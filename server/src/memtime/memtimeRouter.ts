import { Router } from 'express'
import type { Response } from 'express'
import { HttpError } from '../middleware/errorHandler.ts'
import { getSession, requireSession } from '../middleware/requireSession.ts'
import type { HierarchyCache } from '../hierarchy/hierarchyCache.ts'
import type { SessionStore } from '../sessions/sessionStore.ts'
import type { MemtimeResponse } from './memtimeClient.ts'
import { throwIfRateLimited } from './rateLimit.ts'

interface Options {
  store: SessionStore
  hierarchyCache: HierarchyCache
}

// Positive integer without leading zeros. Anything else never reaches the upstream path.
const ID_PATTERN = /^[1-9]\d{0,9}$/

const FORWARDED_PARAMS = ['limit', 'offset', 'sortBy', 'order']

// Rate-limit headers, copied as they are so the browser can see Memtime's budget.
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
 * API key and passes the upstream answer through, with a friendly 429 when Memtime or the rate-limit gate
 * refuses the call. Lists and lookups come from the hierarchy cache when it has them. No retry.
 */
export function memtimeRouter({ store, hierarchyCache }: Options) {
  async function forward(res: Response, response: Promise<MemtimeResponse>) {
    const { status, headers, body } = await response

    for (const name of PASSED_HEADERS) {
      const value = headers.get(name)
      if (value !== null) res.setHeader(name, value)
    }
    // The data belongs to one user, so shared caches must not keep it.
    res.setHeader('Cache-Control', 'private, no-store')
    // After the headers are set, so the error answer keeps them.
    throwIfRateLimited(status, headers)
    res
      .status(status)
      .type(headers.get('content-type') ?? 'application/json')
      .send(body)
  }

  function list(
    res: Response,
    upstreamPath: string,
    query: Record<string, unknown>,
    routePath: string,
  ) {
    return forward(
      res,
      hierarchyCache.getList(
        getSession(res).apiKey,
        upstreamPath,
        allowedQuery(query),
        routePath,
      ),
    )
  }

  const router = Router()
  // Per route, not `router.use`: this router is mounted at /api, so a blanket
  // session check would turn every unknown /api path into a 401 instead of a 404.
  const session = requireSession(store)

  router.get('/clients', session, async (req, res) => {
    await list(res, '/clients', req.query, '/api/clients')
  })

  router.get('/clients/:clientId/projects', session, async (req, res) => {
    const clientId = parseId(req.params.clientId, 'client')
    await list(
      res,
      `/clients/${clientId}/projects`,
      req.query,
      '/api/clients/:clientId/projects',
    )
  })

  router.get('/projects/:projectId/tasks', session, async (req, res) => {
    const projectId = parseId(req.params.projectId, 'project')
    await list(
      res,
      `/projects/${projectId}/tasks`,
      req.query,
      '/api/projects/:projectId/tasks',
    )
  })

  router.get('/projects/:projectId', session, async (req, res) => {
    const projectId = parseId(req.params.projectId, 'project')
    await forward(
      res,
      hierarchyCache.getItem(
        getSession(res).apiKey,
        'project',
        projectId,
        '/api/projects/:projectId',
      ),
    )
  })

  router.get('/tasks/:taskId', session, async (req, res) => {
    const taskId = parseId(req.params.taskId, 'task')
    await forward(
      res,
      hierarchyCache.getItem(
        getSession(res).apiKey,
        'task',
        taskId,
        '/api/tasks/:taskId',
      ),
    )
  })

  return router
}
