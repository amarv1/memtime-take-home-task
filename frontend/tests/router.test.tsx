import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { createQueryClient } from '@/lib/queryClient'
import { buildEntry, mockEntries } from './support/entries'
import { server } from './support/server'
import { mockHierarchy } from './support/hierarchy'
import { routes } from '@/router'

describe('routes', () => {
  it('sends a signed-out visitor to login, then home after signing in', async () => {
    mockHierarchy()
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
    mockHierarchy()
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

  it('opens a task link on the entries page with the task selected in the tree', async () => {
    mockHierarchy()
    mockEntries([buildEntry(1, 399)])
    server.use(
      http.get('/api/session', () =>
        HttpResponse.json({ expiresAt: '2030-01-01T00:00:00.000Z' }),
      ),
    )
    const router = createMemoryRouter(routes, {
      initialEntries: ['/tasks/399/entries'],
    })
    render(
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    expect(await screen.findByRole('treeitem', { name: 'Write copy' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/tasks/399/entries')
  })

  it('redirects an old task link to its entries, replacing the history entry', async () => {
    mockHierarchy()
    mockEntries([])
    server.use(
      http.get('/api/session', () =>
        HttpResponse.json({ expiresAt: '2030-01-01T00:00:00.000Z' }),
      ),
    )
    const router = createMemoryRouter(routes, { initialEntries: ['/tasks/399'] })
    render(
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    expect(
      await screen.findByText('No time entries for this task yet.'),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/tasks/399/entries')
    expect(router.state.historyAction).toBe('REPLACE')
  })
})
