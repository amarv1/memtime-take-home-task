import { screen, waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { mockHierarchy } from '../support/hierarchy'
import { renderWithProviders } from '../support/utils'
import { HierarchyPage } from '@/pages/HierarchyPage'

describe('HierarchyPage', () => {
  it('renders the heading, help text and the tree', async () => {
    mockHierarchy()

    renderWithProviders(<HierarchyPage />)

    expect(
      screen.getByRole('heading', { name: 'Clients & projects' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/expand a client to see its projects/i)).toBeInTheDocument()
    expect(await screen.findByRole('tree')).toBeInTheDocument()
    expect(document.title).toBe('Clients · Memtime')
  })

  it('titles the page with the selected task', async () => {
    mockHierarchy()

    renderWithProviders(
      <Routes>
        <Route path="/tasks/:taskId" element={<HierarchyPage />} />
      </Routes>,
      { route: '/tasks/398' },
    )

    await waitFor(() => expect(document.title).toBe('Design homepage · Memtime'))
  })
})
