import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { RouteError } from '@/components/RouteError'

function Boom(): never {
  throw new Error('kaboom')
}

describe('RouteError', () => {
  it('replaces the default error page when a route crashes', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const router = createMemoryRouter([
      { errorElement: <RouteError />, children: [{ path: '/', element: <Boom /> }] },
    ])
    render(<RouterProvider router={router} />)

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Go to home' })).toHaveAttribute('href', '/')
    expect(screen.queryByText('kaboom')).not.toBeInTheDocument()
    spy.mockRestore()
  })
})
