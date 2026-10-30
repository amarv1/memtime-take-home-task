import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { createQueryClient } from '@/lib/queryClient'
import { server } from '@/test/server'
import { routes } from './router'

describe('routes', () => {
  it('sends a signed-out visitor to login, then home after signing in', async () => {
    let signedIn = false
    server.use(
      http.get('/api/session', () =>
        signedIn
          ? HttpResponse.json({ expiresAt: '2030-01-01T00:00:00.000Z' })
          : HttpResponse.json({ error: 'Not signed in' }, { status: 401 }),
      ),
      http.post('/api/session', () => {
        signedIn = true
        return HttpResponse.json({ expiresAt: '2030-01-01T00:00:00.000Z' })
      }),
    )
    const client = createQueryClient()
    const router = createMemoryRouter(routes, { initialEntries: ['/'] })
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('API key'), 'abc')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  it('redirects unknown paths home', async () => {
    server.use(
      http.get('/api/session', () =>
        HttpResponse.json({ expiresAt: '2030-01-01T00:00:00.000Z' }),
      ),
    )
    const router = createMemoryRouter(routes, { initialEntries: ['/nope'] })
    render(
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })
})
