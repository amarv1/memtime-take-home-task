import { render, screen } from '@testing-library/react'
import { StatusBadge } from '@/features/hierarchy/StatusBadge'

describe('StatusBadge', () => {
  it.each([
    ['pending', 'Pending'],
    ['in-progress', 'In progress'],
    ['completed', 'Completed'],
  ])('labels %s as %s', (status, label) => {
    render(<StatusBadge status={status} />)

    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('shows an unknown status as it is, in a neutral style', () => {
    render(<StatusBadge status="archived" />)

    expect(screen.getByText('archived')).toHaveClass('bg-muted')
  })
})
