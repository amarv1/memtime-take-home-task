import { expect, test, type Page } from '@playwright/test'

const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString()
const timestamps = {
  createdAt: '2025-11-26T13:20:17.565Z',
  updatedAt: '2025-11-26T14:19:47.565Z',
}

/** Serves one client, project and task; `calls` records everything but the session. */
async function mockApi(page: Page) {
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
    if (path === '/api/tasks/398') {
      return route.fulfill({
        json: {
          id: 398,
          projectId: 101,
          name: 'Design homepage',
          status: 'completed',
          ...timestamps,
        },
      })
    }
    if (path === '/api/projects/101') {
      return route.fulfill({
        json: { id: 101, clientId: 1, name: 'Website', status: 'pending', ...timestamps },
      })
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } })
  })
  return calls
}

test('browses clients, projects and tasks, loading each level on expand', async ({
  page,
}) => {
  const calls = await mockApi(page)

  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Select a task' })).toBeVisible()
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

  await task.click()
  await expect(page).toHaveURL('/tasks/398')
  await expect(task).toHaveAttribute('aria-selected', 'true')
})

test('opens a task link with its client and project expanded', async ({ page }) => {
  const calls = await mockApi(page)

  await page.goto('/tasks/398')

  const task = page.getByRole('treeitem', { name: 'Design homepage' })
  await expect(task).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('treeitem', { name: 'Acme Corp' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect(page.getByRole('treeitem', { name: 'Website' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect(page).toHaveTitle('Design homepage · Memtime')

  // Collapsing the client keeps it marked, so the task can be found again.
  await page.getByRole('treeitem', { name: 'Acme Corp' }).getByText('Acme Corp').click()
  await expect(page.getByRole('treeitem', { name: 'Acme Corp' })).toHaveAttribute(
    'aria-current',
    'true',
  )
  expect(calls).toHaveLength(5)
})
