import { screen, waitFor } from '@testing-library/react'
import { HierarchyTree } from '@/features/hierarchy/HierarchyTree'
import {
  buildClient,
  buildProject,
  buildTask,
  type HierarchyData,
} from '../../fixtures/hierarchy'
import { mockHierarchy } from '../../support/hierarchy'
import { renderWithProviders } from '../../support/utils'

// Every row renders one badge, so badge renders count row renders.
const badgeRenders = vi.hoisted(() => ({ count: 0 }))
vi.mock('@/features/hierarchy/StatusBadge', () => ({
  StatusBadge: ({ status }: { status: string }) => {
    badgeRenders.count++
    return <span>{status}</span>
  },
}))

const TASKS = 300
const data: HierarchyData = {
  clients: [buildClient(1, { name: 'Acme' }), buildClient(2, { name: 'Other' })],
  projectsByClient: {
    1: [
      buildProject(101, 1, { name: 'Website' }),
      buildProject(102, 1, { name: 'Docs' }),
    ],
  },
  // Pages of 100: only the first is loaded, which is plenty to show the problem.
  tasksByProject: {
    101: Array.from({ length: TASKS }, (_, i) => buildTask(1000 + i, 101)),
  },
}

async function setup() {
  mockHierarchy(data)
  const view = renderWithProviders(<HierarchyTree />)
  await view.user.click(await screen.findByText('Acme'))
  await view.user.click(await screen.findByText('Website'))
  await screen.findByText('Task 1000 for Project 101')
  // Settle any render that follows the load, then start counting.
  await waitFor(() => {
    const before = badgeRenders.count
    expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(100)
    expect(badgeRenders.count).toBe(before)
  })
  badgeRenders.count = 0
  return view
}

describe('tree re-renders', () => {
  it('does not re-render the task rows when focus moves with the arrow keys', async () => {
    const { user } = await setup()
    screen.getByRole('treeitem', { name: 'Acme' }).focus()

    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowUp}')

    expect(
      screen.getByRole('treeitem', { name: 'Task 1000 for Project 101' }),
    ).toBeTruthy()
    expect(badgeRenders.count).toBeLessThanOrEqual(10)
  })

  it('does not re-render the task rows when another node is expanded', async () => {
    const { user } = await setup()

    await user.click(screen.getByText('Docs'))
    await screen.findByText('No tasks')

    expect(badgeRenders.count).toBeLessThanOrEqual(10)
  })
})
