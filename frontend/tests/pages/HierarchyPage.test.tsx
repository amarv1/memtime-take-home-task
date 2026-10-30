import { screen, waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { mockHierarchy } from '../support/hierarchy'
import { renderWithProviders } from '../support/utils'
import { HierarchyPage } from '@/pages/HierarchyPage'

describe('HierarchyPage', () => {
  it('asks for a task when none is selected', () => {
    mockHierarchy()

    renderWithProviders(<HierarchyPage />)

    expect(screen.getByRole('heading', { name: 'Select a task' })).toBeInTheDocument()
    expect(screen.getByText(/expand a client to see its projects/i)).toBeInTheDocument()
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
    expect(screen.getByRole('heading', { name: 'Design homepage' })).toBeInTheDocument()
  })
})
