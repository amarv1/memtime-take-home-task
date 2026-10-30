import type { Client, Project, Task } from '@/features/hierarchy/api'

// Fixed timestamps keep the data deterministic.
const CREATED = '2025-11-26T13:20:17.565Z'
const UPDATED = '2025-11-26T14:19:47.565Z'

export function buildClient(id: number, overrides: Partial<Client> = {}): Client {
  return {
    id,
    name: `Client ${id}`,
    description: `This is the description for client ${id}.`,
    status: 'in-progress',
    createdAt: CREATED,
    updatedAt: UPDATED,
    ...overrides,
  }
}

export function buildProject(
  id: number,
  clientId: number,
  overrides: Partial<Project> = {},
): Project {
  return {
    id,
    clientId,
    name: `Project ${id} for Client ${clientId}`,
    status: 'in-progress',
    createdAt: CREATED,
    updatedAt: UPDATED,
    ...overrides,
  }
}

export function buildTask(
  id: number,
  projectId: number,
  overrides: Partial<Task> = {},
): Task {
  return {
    id,
    projectId,
    name: `Task ${id} for Project ${projectId}`,
    status: 'in-progress',
    createdAt: CREATED,
    updatedAt: UPDATED,
    ...overrides,
  }
}

export interface HierarchyData {
  clients: Client[]
  projectsByClient: Record<number, Project[]>
  tasksByProject: Record<number, Task[]>
}

/** Client 1 has two projects, client 2 has none, client 3 has an unknown status. */
export const hierarchyFixture: HierarchyData = {
  clients: [
    buildClient(1, { name: 'Acme Corp', status: 'in-progress' }),
    buildClient(2, { name: 'Empty Inc', status: 'pending' }),
    buildClient(3, { name: 'Mystery Ltd', status: 'archived' }),
  ],
  projectsByClient: {
    1: [
      buildProject(101, 1, { name: 'Website', status: 'in-progress' }),
      buildProject(102, 1, { name: 'Branding', status: 'completed' }),
    ],
  },
  tasksByProject: {
    101: [
      buildTask(398, 101, { name: 'Design homepage', status: 'in-progress' }),
      buildTask(399, 101, { name: 'Write copy', status: 'pending' }),
      buildTask(400, 101, { name: 'Ship it', status: 'completed' }),
    ],
  },
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

export const manyClients = (n: number) => range(n).map((id) => buildClient(id))

export const manyProjects = (clientId: number, n: number) =>
  range(n).map((id) => buildProject(1000 + id, clientId))

export const manyTasks = (projectId: number, n: number) =>
  range(n).map((id) => buildTask(5000 + id, projectId))
