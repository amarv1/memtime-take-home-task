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
 * Mocks the list routes and the task and project lookups. Unknown parents answer
 * `200 []`, and unknown ids answer 404, as the real API does.
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
    http.get('/api/tasks/:taskId', ({ request, params }) => {
      record(request)
      const task = Object.values(data.tasksByProject)
        .flat()
        .find((t) => t.id === Number(params.taskId))
      return task
        ? HttpResponse.json(task)
        : HttpResponse.json({ error: 'Task not found' }, { status: 404 })
    }),
    http.get('/api/projects/:projectId', ({ request, params }) => {
      record(request)
      const project = Object.values(data.projectsByClient)
        .flat()
        .find((p) => p.id === Number(params.projectId))
      return project
        ? HttpResponse.json(project)
        : HttpResponse.json({ error: 'Project not found' }, { status: 404 })
    }),
  )
  return { requests }
}
