import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'
import { HomePage } from './HomePage'

describe('HomePage', () => {
  it('renders', () => {
    renderWithProviders(<HomePage />)
    expect(screen.getByRole('heading', { name: /frontend setup/i })).toBeInTheDocument()
  })
})
