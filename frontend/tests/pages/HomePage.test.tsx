import { screen } from '@testing-library/react'
import { renderWithProviders } from '../support/utils'
import { HomePage } from '@/pages/HomePage'

describe('HomePage', () => {
  it('renders', () => {
    renderWithProviders(<HomePage />)
    expect(screen.getByRole('heading', { name: /frontend setup/i })).toBeInTheDocument()
  })
})
