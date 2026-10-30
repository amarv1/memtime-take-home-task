import { http, HttpResponse } from 'msw'
import { server } from '../../support/server'
import {
  getProject,
  getTask,
  listClients,
  listProjects,
  listTasks,
  PAGE_SIZE,
} from '@/features/hierarchy/api'
import { buildClient, buildProject, buildTask } from '../../fixtures/hierarchy'

function capture(path: string, body: object, status = 200) {
  const seen: string[] = []
  server.use(
    http.get(path, ({ request }) => {
      const url = new URL(request.url)
      seen.push(url.pathname + url.search)
      return HttpResponse.json(body, { status })
    }),
  )
  return seen
}

describe('hierarchy api', () => {
  it('uses the page size the API actually allows', () => {
    expect(PAGE_SIZE).toBe(100)
  })

  it('listClients requests a page of clients', async () => {
    const clients = [buildClient(1)]
    const seen = capture('/api/clients', clients)

    await expect(listClients(200)).resolves.toEqual(clients)
    expect(seen).toEqual(['/api/clients?limit=100&offset=200'])
  })

  it('listProjects requests the projects of a client', async () => {
    const projects = [buildProject(101, 7)]
    const seen = capture('/api/clients/7/projects', projects)

    await expect(listProjects(7, 0)).resolves.toEqual(projects)
    expect(seen).toEqual(['/api/clients/7/projects?limit=100&offset=0'])
  })

  it('listTasks requests the tasks of a project', async () => {
    const tasks = [buildTask(398, 101)]
    const seen = capture('/api/projects/101/tasks', tasks)

    await expect(listTasks(101, 100)).resolves.toEqual(tasks)
    expect(seen).toEqual(['/api/projects/101/tasks?limit=100&offset=100'])
  })

  it('getTask requests one task', async () => {
    const task = buildTask(398, 101)
    const seen = capture('/api/tasks/398', task)

    await expect(getTask(398)).resolves.toEqual(task)
    expect(seen).toEqual(['/api/tasks/398'])
  })

  it('getProject requests one project', async () => {
    const project = buildProject(101, 7)
    const seen = capture('/api/projects/101', project)

    await expect(getProject(101)).resolves.toEqual(project)
    expect(seen).toEqual(['/api/projects/101'])
  })

  it.each([
    ['listClients', '/api/clients', () => listClients(0)],
    ['listProjects', '/api/clients/1/projects', () => listProjects(1, 0)],
    ['listTasks', '/api/projects/1/tasks', () => listTasks(1, 0)],
  ])('%s propagates ApiError', async (_name, path, call) => {
    capture(path, { error: 'Not signed in' }, 401)

    await expect(call()).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      message: 'Not signed in',
    })
  })
})
