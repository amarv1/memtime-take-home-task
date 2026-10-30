import { expect, test } from '@playwright/test'

const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString()
const timestamps = {
  createdAt: '2025-11-26T13:20:17.565Z',
  updatedAt: '2025-11-26T14:19:47.565Z',
}

test('browses clients, projects and tasks, loading each level on expand', async ({
  page,
}) => {
  const calls: string[] = []
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path === '/api/session') return route.fulfill({ json: { expiresAt } })

    calls.push(path + url.search)
    if (path === '/api/clients') {
      return route.fulfill({
        json: [
          {
            id: 1,
            name: 'Acme Corp',
            description: 'Our first client.',
            status: 'in-progress',
            ...timestamps,
          },
        ],
      })
    }
    if (path === '/api/clients/1/projects') {
      return route.fulfill({
        json: [
          { id: 101, clientId: 1, name: 'Website', status: 'pending', ...timestamps },
        ],
      })
    }
    if (path === '/api/projects/101/tasks') {
      return route.fulfill({
        json: [
          {
            id: 398,
            projectId: 101,
            name: 'Design homepage',
            status: 'completed',
            ...timestamps,
          },
        ],
      })
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } })
  })

  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Clients & projects' })).toBeVisible()
  const client = page.getByRole('treeitem', { name: 'Acme Corp' })
  await expect(client).toBeVisible()
  expect(calls).toEqual(['/api/clients?limit=100&offset=0'])

  await client.getByText('Acme Corp').click()
  const project = page.getByRole('treeitem', { name: 'Website' })
  await expect(project).toBeVisible()

  await project.getByText('Website').click()
  const task = page.getByRole('treeitem', { name: 'Design homepage' })
  await expect(task).toBeVisible()
  await expect(task).toContainText('#398')
  await expect(task).toContainText('Completed')
})
