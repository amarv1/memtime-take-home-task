import { apiFetch } from '@/lib/api'

export interface Client {
  id: number
  name: string
  description: string
  status: string
  createdAt: string
  updatedAt: string
}

export interface Project {
  id: number
  clientId: number
  name: string
  status: string
  createdAt: string
  updatedAt: string
}

export interface Task {
  id: number
  projectId: number
  name: string
  status: string
  createdAt: string
  updatedAt: string
}

// The largest page the API returned in testing; asking for more still returned 100.
export const PAGE_SIZE = 100

function page(offset: number) {
  return new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
}

const id = (value: number) => encodeURIComponent(String(value))

export function listClients(offset: number): Promise<Client[]> {
  return apiFetch<Client[]>(`/api/clients?${page(offset)}`)
}

export function listProjects(clientId: number, offset: number): Promise<Project[]> {
  return apiFetch<Project[]>(`/api/clients/${id(clientId)}/projects?${page(offset)}`)
}

export function listTasks(projectId: number, offset: number): Promise<Task[]> {
  return apiFetch<Task[]>(`/api/projects/${id(projectId)}/tasks?${page(offset)}`)
}
