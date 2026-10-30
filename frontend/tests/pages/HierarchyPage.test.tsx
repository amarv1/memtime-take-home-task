import { screen } from '@testing-library/react'
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
})
