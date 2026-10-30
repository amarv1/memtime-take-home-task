import { screen, waitFor, within, fireEvent } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { HierarchyTree } from '@/features/hierarchy/HierarchyTree'
import { sessionQueryKey } from '@/features/auth/hooks'
import {
  hierarchyFixture,
  manyClients,
  manyProjects,
  manyTasks,
} from '../../fixtures/hierarchy'
import { mockHierarchy } from '../../support/hierarchy'
import { server } from '../../support/server'
import { renderWithProviders } from '../../support/utils'

const CLIENTS_REQUEST = '/api/clients?limit=100&offset=0'

const item = (name: string | RegExp) => screen.getByRole('treeitem', { name })

async function setup(data = hierarchyFixture) {
  const { requests } = mockHierarchy(data)
  const view = renderWithProviders(<HierarchyTree />)
  await screen.findByRole('treeitem', { name: data.clients[0]?.name ?? '' })
  return { requests, ...view }
}

/** Clicking the name is what a user does; the row handles the click. */
const toggle = (user: { click: (el: Element) => Promise<void> }, name: string) =>
  user.click(screen.getByText(name))

const tabStops = () =>
  screen.getAllByRole('treeitem').filter((el) => el.getAttribute('tabindex') === '0')

describe('HierarchyTree', () => {
  describe('loading levels lazily', () => {
    it('shows a loading status, then the clients, with exactly one request', async () => {
      const { requests } = mockHierarchy()
      renderWithProviders(<HierarchyTree />)

      expect(screen.getByRole('status')).toHaveTextContent('Loading clients…')
      expect(await screen.findByRole('tree')).toBeInTheDocument()

      expect(screen.getAllByRole('treeitem')).toHaveLength(3)
      expect(requests).toEqual([CLIENTS_REQUEST])
    })

    it('shows client details', async () => {
      await setup()

      const acme = item('Acme Corp')
      expect(within(acme).getByText('In progress')).toBeInTheDocument()
      expect(within(item('Mystery Ltd')).getByText('archived')).toBeInTheDocument()
    })

    it('fetches nothing below the clients until a node is expanded', async () => {
      const { requests } = await setup()

      expect(requests).toEqual([CLIENTS_REQUEST])
      expect(screen.queryByRole('group')).not.toBeInTheDocument()
    })

    it('fetches projects when a client is expanded, and tasks when a project is', async () => {
      const { requests, user } = await setup()

      await toggle(user, 'Acme Corp')
      expect(await screen.findByRole('treeitem', { name: 'Website' })).toBeInTheDocument()
      expect(requests).toEqual([
        CLIENTS_REQUEST,
        '/api/clients/1/projects?limit=100&offset=0',
      ])

      await toggle(user, 'Website')
      const task = await screen.findByRole('treeitem', { name: 'Design homepage' })
      expect(within(task).getByText('#398')).toBeInTheDocument()
      expect(within(task).getByText('In progress')).toBeInTheDocument()
      expect(within(item('Write copy')).getByText('Pending')).toBeInTheDocument()
      expect(within(item('Ship it')).getByText('Completed')).toBeInTheDocument()
      expect(requests).toEqual([
        CLIENTS_REQUEST,
        '/api/clients/1/projects?limit=100&offset=0',
        '/api/projects/101/tasks?limit=100&offset=0',
      ])
    })

    it('does not fetch again when a node is collapsed and re-expanded', async () => {
      const { requests, user } = await setup()
      await toggle(user, 'Acme Corp')
      await screen.findByRole('treeitem', { name: 'Website' })
      await toggle(user, 'Website')
      await screen.findByRole('treeitem', { name: 'Ship it' })
      const before = requests.length

      await toggle(user, 'Acme Corp')
      expect(screen.queryByRole('treeitem', { name: 'Website' })).not.toBeInTheDocument()
      await toggle(user, 'Acme Corp')

      expect(await screen.findByRole('treeitem', { name: 'Website' })).toBeInTheDocument()
      expect(await screen.findByRole('treeitem', { name: 'Ship it' })).toBeInTheDocument()
      expect(requests).toHaveLength(before)
    })

    it('shows empty states', async () => {
      const { user } = await setup()

      await toggle(user, 'Empty Inc')
      expect(
        await screen.findByRole('treeitem', { name: 'No projects' }),
      ).toBeInTheDocument()

      await toggle(user, 'Acme Corp')
      await toggle(user, 'Branding')
      expect(
        await screen.findByRole('treeitem', { name: 'No tasks' }),
      ).toBeInTheDocument()
    })

    it('shows an empty state when there are no clients', () => {
      mockHierarchy({ ...hierarchyFixture, clients: [] })
      renderWithProviders(<HierarchyTree />)

      return expect(screen.findByText('No clients yet.')).resolves.toBeInTheDocument()
    })
  })

  describe('errors', () => {
    it('shows an alert for the clients and recovers on retry', async () => {
      server.use(
        http.get('/api/clients', () =>
          HttpResponse.json({ error: 'boom' }, { status: 500 }),
        ),
      )
      const { user } = renderWithProviders(<HierarchyTree />)

      expect(await screen.findByRole('alert')).toHaveTextContent(
        "Couldn't load clients. boom",
      )

      mockHierarchy()
      await user.click(screen.getByRole('button', { name: 'Try again' }))

      expect(
        await screen.findByRole('treeitem', { name: 'Acme Corp' }),
      ).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it.each([
      ['projects', '/api/clients/1/projects', 'Acme Corp', 'Website'],
      ['tasks', '/api/projects/101/tasks', 'Website', 'Design homepage'],
    ])(
      'shows a retryable row when the %s fail to load',
      async (noun, path, parent, child) => {
        const { user } = await setup()
        server.use(
          http.get(path, () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
        )
        if (parent === 'Website') {
          mockHierarchy()
          server.use(
            http.get(path, () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
          )
          await toggle(user, 'Acme Corp')
          await screen.findByRole('treeitem', { name: 'Website' })
        }

        await toggle(user, parent)
        const row = await screen.findByRole('treeitem', {
          name: new RegExp(`Couldn't load ${noun}\\. boom`),
        })
        expect(row).toHaveTextContent('Try again')

        mockHierarchy()
        await user.click(row)

        expect(await screen.findByRole('treeitem', { name: child })).toBeInTheDocument()
      },
    )
  })

  describe('pagination', () => {
    it('loads the next page of clients on request', async () => {
      const { requests, user } = await setup({
        ...hierarchyFixture,
        clients: manyClients(150),
      })

      expect(screen.getAllByRole('treeitem')).toHaveLength(101)
      await user.click(item('Load more clients'))

      await waitFor(() => expect(screen.getAllByRole('treeitem')).toHaveLength(150))
      expect(requests).toEqual([CLIENTS_REQUEST, '/api/clients?limit=100&offset=100'])
      expect(screen.queryByRole('treeitem', { name: 'Load more clients' })).toBeNull()
    })

    it('hides the button when a full page is followed by an empty one', async () => {
      const { requests, user } = await setup({
        ...hierarchyFixture,
        clients: manyClients(100),
      })

      await user.click(item('Load more clients'))

      await waitFor(() =>
        expect(screen.queryByRole('treeitem', { name: /load more/i })).toBeNull(),
      )
      expect(screen.getAllByRole('treeitem')).toHaveLength(100)
      expect(requests).toEqual([CLIENTS_REQUEST, '/api/clients?limit=100&offset=100'])
    })

    it('shows a disabled "Loading more…" row while the next page loads', async () => {
      const { user } = await setup({ ...hierarchyFixture, clients: manyClients(150) })
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => (release = resolve))
      server.use(
        http.get('/api/clients', async () => {
          await gate
          return HttpResponse.json(manyClients(150).slice(100))
        }),
      )

      await user.click(item('Load more clients'))

      const row = await screen.findByRole('treeitem', { name: 'Loading more…' })
      expect(row).toHaveAttribute('aria-disabled', 'true')
      release()
      await waitFor(() => expect(screen.getAllByRole('treeitem')).toHaveLength(150))
    })

    it('shows an error row when the next page fails, and retries it', async () => {
      const { requests, user } = await setup({
        ...hierarchyFixture,
        clients: manyClients(150),
      })
      server.use(
        http.get('/api/clients', () =>
          HttpResponse.json({ error: 'boom' }, { status: 500 }),
        ),
      )

      await user.click(item('Load more clients'))
      const row = await screen.findByRole('treeitem', {
        name: /Couldn't load clients\. boom/,
      })
      expect(screen.getAllByRole('treeitem')).toHaveLength(101) // first page stays

      const { requests: retried } = mockHierarchy({
        ...hierarchyFixture,
        clients: manyClients(150),
      })
      await user.click(row)

      await waitFor(() => expect(screen.getAllByRole('treeitem')).toHaveLength(150))
      expect(retried).toEqual(['/api/clients?limit=100&offset=100'])
      expect(requests).toEqual([CLIENTS_REQUEST])
    })

    it('loads more projects and more tasks', async () => {
      const { requests, user } = await setup({
        ...hierarchyFixture,
        projectsByClient: { 1: manyProjects(1, 120) },
        tasksByProject: { 1001: manyTasks(1001, 101) },
      })

      await toggle(user, 'Acme Corp')
      await user.click(
        await screen.findByRole('treeitem', { name: 'Load more projects' }),
      )
      await waitFor(() =>
        expect(screen.queryByRole('treeitem', { name: 'Load more projects' })).toBeNull(),
      )
      expect(requests).toContain('/api/clients/1/projects?limit=100&offset=100')
      expect(screen.getAllByRole('treeitem', { name: /^Project / })).toHaveLength(120)

      await toggle(user, 'Project 1001 for Client 1')
      await user.click(await screen.findByRole('treeitem', { name: 'Load more tasks' }))
      await waitFor(() =>
        expect(screen.queryByRole('treeitem', { name: 'Load more tasks' })).toBeNull(),
      )
      expect(requests).toContain('/api/projects/1001/tasks?limit=100&offset=100')
    })
  })

  describe('ARIA', () => {
    it('is a labelled tree with levels and expanded state', async () => {
      const { user } = await setup()
      expect(
        screen.getByRole('tree', { name: 'Clients, projects and tasks' }),
      ).toBeVisible()

      const acme = item('Acme Corp')
      expect(acme).toHaveAttribute('aria-level', '1')
      expect(acme).toHaveAttribute('aria-expanded', 'false')

      await toggle(user, 'Acme Corp')
      expect(acme).toHaveAttribute('aria-expanded', 'true')
      const website = await screen.findByRole('treeitem', { name: 'Website' })
      expect(website).toHaveAttribute('aria-level', '2')
      expect(website).toHaveAttribute('aria-expanded', 'false')
      expect(within(acme).getByRole('group')).toBeInTheDocument()

      await toggle(user, 'Website')
      expect(website).toHaveAttribute('aria-expanded', 'true')
      const task = await screen.findByRole('treeitem', { name: 'Design homepage' })
      expect(task).toHaveAttribute('aria-level', '3')
      expect(task).not.toHaveAttribute('aria-expanded')
    })

    it('names items by their own name, not by their children', async () => {
      const { user } = await setup()
      await toggle(user, 'Acme Corp')
      await screen.findByRole('treeitem', { name: 'Website' })

      expect(item('Acme Corp')).toBeInTheDocument()
      expect(screen.getAllByRole('treeitem', { name: /Website/ })).toHaveLength(1)
    })

    it('marks an item busy while its children load', async () => {
      const { user } = await setup()
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => (release = resolve))
      server.use(
        http.get('/api/clients/1/projects', async () => {
          await gate
          return HttpResponse.json(hierarchyFixture.projectsByClient[1])
        }),
      )

      await toggle(user, 'Acme Corp')

      expect(item('Acme Corp')).toHaveAttribute('aria-busy', 'true')
      expect(
        screen.getByRole('treeitem', { name: 'Loading projects…' }),
      ).toBeInTheDocument()
      release()
      await screen.findByRole('treeitem', { name: 'Website' })
      expect(item('Acme Corp')).not.toHaveAttribute('aria-busy')
    })
  })

  describe('keyboard', () => {
    it('puts exactly one item in the tab order, starting with the first', async () => {
      const { user } = await setup()

      expect(tabStops()).toEqual([item('Acme Corp')])
      await user.tab()
      expect(item('Acme Corp')).toHaveFocus()
    })

    it('moves with the arrow keys, Home and End, and keeps one tab stop', async () => {
      const { user } = await setup()
      await user.tab()

      await user.keyboard('{ArrowDown}')
      expect(item('Empty Inc')).toHaveFocus()
      expect(tabStops()).toEqual([item('Empty Inc')])

      await user.keyboard('{End}')
      expect(item('Mystery Ltd')).toHaveFocus()
      await user.keyboard('{ArrowDown}')
      expect(item('Mystery Ltd')).toHaveFocus()

      await user.keyboard('{ArrowUp}')
      expect(item('Empty Inc')).toHaveFocus()
      await user.keyboard('{Home}')
      expect(item('Acme Corp')).toHaveFocus()
      await user.keyboard('{ArrowUp}')
      expect(item('Acme Corp')).toHaveFocus()
    })

    it('expands with ArrowRight, then moves into the first child', async () => {
      const { user } = await setup()
      await user.tab()

      await user.keyboard('{ArrowRight}')
      expect(item('Acme Corp')).toHaveAttribute('aria-expanded', 'true')
      expect(item('Acme Corp')).toHaveFocus()

      await screen.findByRole('treeitem', { name: 'Website' })
      await user.keyboard('{ArrowRight}')
      expect(item('Website')).toHaveFocus()

      await user.keyboard('{ArrowRight}')
      await screen.findByRole('treeitem', { name: 'Design homepage' })
      await user.keyboard('{ArrowRight}')
      expect(item('Design homepage')).toHaveFocus()
      // A leaf does nothing on ArrowRight.
      await user.keyboard('{ArrowRight}')
      expect(item('Design homepage')).toHaveFocus()
    })

    it('moves to the parent with ArrowLeft, then collapses', async () => {
      const { user } = await setup()
      await user.tab()
      await user.keyboard('{ArrowRight}')
      await screen.findByRole('treeitem', { name: 'Website' })
      await user.keyboard('{ArrowDown}')
      expect(item('Website')).toHaveFocus()

      await user.keyboard('{ArrowLeft}')
      expect(item('Acme Corp')).toHaveFocus()
      expect(item('Acme Corp')).toHaveAttribute('aria-expanded', 'true')

      await user.keyboard('{ArrowLeft}')
      expect(item('Acme Corp')).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('treeitem', { name: 'Website' })).toBeNull()

      // At the top level, ArrowLeft on a collapsed item stays put.
      await user.keyboard('{ArrowLeft}')
      expect(item('Acme Corp')).toHaveFocus()
    })

    it('toggles with Enter and Space', async () => {
      const { user } = await setup()
      await user.tab()

      await user.keyboard('{Enter}')
      expect(item('Acme Corp')).toHaveAttribute('aria-expanded', 'true')
      await user.keyboard('{Enter}')
      expect(item('Acme Corp')).toHaveAttribute('aria-expanded', 'false')
      await user.keyboard(' ')
      expect(item('Acme Corp')).toHaveAttribute('aria-expanded', 'true')
    })

    it('Enter on a leaf does nothing', async () => {
      const { user } = await setup()
      await user.tab()
      await user.keyboard('{ArrowRight}')
      await screen.findByRole('treeitem', { name: 'Website' })
      await user.keyboard('{ArrowDown}{ArrowRight}')
      await screen.findByRole('treeitem', { name: 'Design homepage' })
      await user.keyboard('{ArrowRight}')
      expect(item('Design homepage')).toHaveFocus()

      await user.keyboard('{Enter}')

      expect(item('Design homepage')).toHaveFocus()
    })

    it('ignores keys with a modifier and other keys', async () => {
      const { user } = await setup()
      await user.tab()

      await user.keyboard('{Control>}{ArrowDown}{/Control}')
      await user.keyboard('a')

      expect(item('Acme Corp')).toHaveFocus()
    })

    it('activates "Load more" with Enter', async () => {
      const { requests, user } = await setup({
        ...hierarchyFixture,
        clients: manyClients(150),
      })
      await user.tab()
      await user.keyboard('{End}')
      expect(item('Load more clients')).toHaveFocus()

      await user.keyboard('{Enter}')

      await waitFor(() => expect(screen.getAllByRole('treeitem')).toHaveLength(150))
      expect(requests).toContain('/api/clients?limit=100&offset=100')
    })

    it('resets the tab stop to the first item when the focused item disappears', async () => {
      const { user } = await setup({ ...hierarchyFixture, clients: manyClients(100) })
      await user.tab()
      await user.keyboard('{End}')
      expect(tabStops()).toEqual([item('Load more clients')])

      await user.keyboard('{Enter}')

      await waitFor(() =>
        expect(screen.queryByRole('treeitem', { name: /load more/i })).toBeNull(),
      )
      await waitFor(() => expect(tabStops()).toEqual([item('Client 1')]))
    })

    it('resets the tab stop when a collapsed parent hides the focused item', async () => {
      const { user } = await setup()
      await user.tab()
      await user.keyboard('{ArrowRight}')
      await screen.findByRole('treeitem', { name: 'Website' })
      await user.keyboard('{ArrowDown}')
      expect(tabStops()).toEqual([item('Website')])

      // A click that doesn't move focus, so the focused child is removed from the DOM.
      fireEvent.click(screen.getByText('Acme Corp'))

      await waitFor(() => expect(tabStops()).toEqual([item('Acme Corp')]))
    })
  })

  it('signs the user out when the clients call answers 401', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({ error: 'Your API key was rejected.' }, { status: 401 }),
      ),
    )
    const { queryClient } = renderWithProviders(<HierarchyTree />)
    queryClient.setQueryData(sessionQueryKey, { expiresAt: '2030-01-01T00:00:00.000Z' })

    await waitFor(() => expect(queryClient.getQueryData(sessionQueryKey)).toBeNull())
  })
})
