import { http, HttpResponse } from 'msw'
import { hierarchyFixture, type HierarchyData } from '../fixtures/hierarchy'
import { server } from './server'

/** Slices like the real API: `limit` defaults to 10. */
function paged<T>(items: T[], url: URL) {
  const limit = Number(url.searchParams.get('limit') ?? 10)
  const offset = Number(url.searchParams.get('offset') ?? 0)
  return HttpResponse.json(items.slice(offset, offset + limit))
}

/**
 * Mocks the three list routes. Unknown parents answer `200 []`, as the real API does.
 * `requests` collects `pathname + search` of every call, to assert what was fetched.
 */
export function mockHierarchy(data: HierarchyData = hierarchyFixture) {
  const requests: string[] = []
  const record = (request: Request) => {
    const url = new URL(request.url)
    requests.push(url.pathname + url.search)
    return url
  }

  server.use(
    http.get('/api/clients', ({ request }) => paged(data.clients, record(request))),
    http.get('/api/clients/:clientId/projects', ({ request, params }) =>
      paged(data.projectsByClient[Number(params.clientId)] ?? [], record(request)),
    ),
    http.get('/api/projects/:projectId/tasks', ({ request, params }) =>
      paged(data.tasksByProject[Number(params.projectId)] ?? [], record(request)),
    ),
  )
  return { requests }
}
