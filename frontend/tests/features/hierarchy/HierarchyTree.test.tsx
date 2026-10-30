import { screen, waitFor, within, fireEvent } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes, useLocation, useNavigate } from 'react-router'
import { HierarchyTree } from '@/features/hierarchy/HierarchyTree'
import { sessionQueryKey } from '@/features/auth/hooks'
import {
  buildTask,
  hierarchyFixture,
  manyClients,
  manyProjects,
  manyTasks,
} from '../../fixtures/hierarchy'
import { mockHierarchy } from '../../support/hierarchy'
import { server } from '../../support/server'
import { scrollIntoView } from '../../support/setup'
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

/** Shows where the router is, and gives tests a way to go back. */
function Location() {
  const navigate = useNavigate()
  return (
    <>
      <p data-testid="location">{useLocation().pathname}</p>
      <button onClick={() => void navigate(-1)}>Back</button>
    </>
  )
}

/** The tree at a route, the way the app mounts it. */
function renderAt(route: string) {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/tasks/:taskId" element={<HierarchyTree />} />
        <Route path="/" element={<HierarchyTree />} />
      </Routes>
      <Location />
    </>,
    { route },
  )
}

const pathname = () => screen.getByTestId('location').textContent
const taskRequests = (requests: string[]) =>
  requests.filter((r) => /^\/api\/(tasks|projects)\/\d+$/.test(r))

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

  describe('selecting a task', () => {
    function mockedRender() {
      const { requests } = mockHierarchy()
      return { requests, ...renderAt('/') }
    }

    async function openTasks() {
      const { requests, user } = mockedRender()
      await screen.findByRole('treeitem', { name: 'Acme Corp' })
      await toggle(user, 'Acme Corp')
      await screen.findByRole('treeitem', { name: 'Website' })
      await toggle(user, 'Website')
      await screen.findByRole('treeitem', { name: 'Ship it' })
      return { requests, user }
    }

    it('puts the task in the URL and marks only it selected, without extra requests', async () => {
      const { requests, user } = await openTasks()
      const before = [...requests]

      await user.click(screen.getByText('Write copy'))

      expect(pathname()).toBe('/tasks/399')
      expect(item('Write copy')).toHaveAttribute('aria-selected', 'true')
      expect(item('Design homepage')).toHaveAttribute('aria-selected', 'false')
      expect(item('Ship it')).toHaveAttribute('aria-selected', 'false')
      expect(item('Write copy')).toHaveFocus()
      expect(requests).toEqual(before)
    })

    it('leaves clients and projects without aria-selected', async () => {
      await openTasks()

      expect(item('Acme Corp')).not.toHaveAttribute('aria-selected')
      expect(item('Website')).not.toHaveAttribute('aria-selected')
    })

    it.each([
      ['Enter', '{Enter}'],
      ['Space', ' '],
    ])('selects the focused task with %s', async (_name, keys) => {
      const { user } = await openTasks()
      item('Ship it').focus()

      await user.keyboard(keys)

      expect(pathname()).toBe('/tasks/400')
      expect(item('Ship it')).toHaveAttribute('aria-selected', 'true')
    })

    it('does not add a history entry when the selected task is clicked again', async () => {
      const { user } = await openTasks()

      await user.click(screen.getByText('Write copy'))
      await user.click(screen.getByText('Write copy'))
      await user.click(screen.getByRole('button', { name: 'Back' }))

      expect(pathname()).toBe('/')
      expect(item('Write copy')).toHaveAttribute('aria-selected', 'false')
    })

    it('follows history between tasks', async () => {
      const { requests, user } = await openTasks()
      await user.click(screen.getByText('Write copy'))
      await user.click(screen.getByText('Ship it'))

      await user.click(screen.getByRole('button', { name: 'Back' }))

      expect(pathname()).toBe('/tasks/399')
      expect(item('Write copy')).toHaveAttribute('aria-selected', 'true')
      expect(item('Ship it')).toHaveAttribute('aria-selected', 'false')
      expect(taskRequests(requests)).toEqual([])
    })

    it('keeps the tree as it was when the route changes', async () => {
      const { user } = await openTasks()

      await user.click(screen.getByText('Write copy'))
      await user.click(screen.getByRole('button', { name: 'Back' }))

      expect(item('Acme Corp')).toHaveAttribute('aria-expanded', 'true')
      expect(item('Website')).toHaveAttribute('aria-expanded', 'true')
      expect(item('Write copy')).toBeInTheDocument()
    })
  })

  describe('opening a task link', () => {
    const PROJECTS = '/api/clients/1/projects?limit=100&offset=0'
    const TASKS = '/api/projects/101/tasks?limit=100&offset=0'

    it('expands the path and selects the task with the minimum of requests', async () => {
      const { requests } = mockHierarchy()
      renderAt('/tasks/399')

      const task = await screen.findByRole('treeitem', { name: 'Write copy' })

      expect(item('Acme Corp')).toHaveAttribute('aria-expanded', 'true')
      expect(item('Website')).toHaveAttribute('aria-expanded', 'true')
      expect(task).toHaveAttribute('aria-selected', 'true')
      expect(item('Ship it')).toHaveAttribute('aria-selected', 'false')
      // The clients list and the task lookup start together; the rest follows from them.
      expect(requests).toHaveLength(5)
      expect(requests.slice(0, 2).sort()).toEqual([CLIENTS_REQUEST, '/api/tasks/399'])
      expect(requests.slice(2)).toEqual(['/api/projects/101', PROJECTS, TASKS])
    })

    it('marks the client and project that hold the task, even after collapsing', async () => {
      mockHierarchy()
      const { user } = renderAt('/tasks/399')
      await screen.findByRole('treeitem', { name: 'Write copy' })

      expect(item('Acme Corp')).toHaveAttribute('aria-current', 'true')
      expect(item('Website')).toHaveAttribute('aria-current', 'true')
      expect(item('Write copy')).not.toHaveAttribute('aria-current')

      await toggle(user, 'Acme Corp')

      expect(item('Acme Corp')).toHaveAttribute('aria-current', 'true')
    })

    it('marks nothing when no task is selected', async () => {
      mockHierarchy()
      renderAt('/')
      await screen.findByRole('treeitem', { name: 'Acme Corp' })

      expect(item('Acme Corp')).not.toHaveAttribute('aria-current')
    })

    it('says it is opening the task while the path resolves', async () => {
      mockHierarchy()
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => (release = resolve))
      server.use(
        http.get('/api/projects/101', async () => {
          await gate
          return HttpResponse.json(hierarchyFixture.projectsByClient[1]?.[0])
        }),
      )
      renderAt('/tasks/399')

      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent('Opening task #399…'),
      )
      expect(screen.getByRole('tree')).toBeInTheDocument()

      release()
      await screen.findByRole('treeitem', { name: 'Write copy' })
      expect(screen.queryByRole('status')).toBeNull()
    })

    it('makes the task the tab stop and scrolls to it without moving focus', async () => {
      mockHierarchy()
      renderAt('/tasks/399')

      const task = await screen.findByRole('treeitem', { name: 'Write copy' })

      await waitFor(() => expect(tabStops()).toEqual([task]))
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
      expect(task).not.toHaveFocus()
    })

    it('loads further pages until the client, project and task are found', async () => {
      const { requests } = mockHierarchy({
        clients: manyClients(150),
        projectsByClient: { 120: manyProjects(120, 150) },
        tasksByProject: { 1130: manyTasks(1130, 150) },
      })
      renderAt('/tasks/5120')

      const task = await screen.findByRole('treeitem', {
        name: 'Task 5120 for Project 1130',
      })

      expect(task).toHaveAttribute('aria-selected', 'true')
      expect(requests).toEqual(
        expect.arrayContaining([
          '/api/clients?limit=100&offset=100',
          '/api/clients/120/projects?limit=100&offset=100',
          '/api/projects/1130/tasks?limit=100&offset=100',
        ]),
      )
    })

    it('does not open the client again once the user collapsed it', async () => {
      const { requests } = mockHierarchy()
      const { user } = renderAt('/tasks/399')
      await screen.findByRole('treeitem', { name: 'Write copy' })
      const before = requests.length

      await toggle(user, 'Acme Corp')

      expect(item('Acme Corp')).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('treeitem', { name: 'Write copy' })).toBeNull()
      expect(requests).toHaveLength(before)
    })

    it('stops at the project when the task is not in its list', async () => {
      const { requests } = mockHierarchy()
      server.use(http.get('/api/tasks/777', () => HttpResponse.json(buildTask(777, 102))))
      renderAt('/tasks/777')

      expect(
        await screen.findByRole('treeitem', { name: 'No tasks' }),
      ).toBeInTheDocument()

      expect(item('Branding')).toHaveAttribute('aria-expanded', 'true')
      expect(
        requests.filter((r) => r.startsWith('/api/projects/102/tasks')),
      ).toHaveLength(1)
    })

    it('shows an alert for an unknown task, and clearing goes home', async () => {
      const { requests } = mockHierarchy()
      const { user } = renderAt('/tasks/9999')

      expect(await screen.findByRole('alert')).toHaveTextContent(
        "Task #9999 wasn't found.",
      )
      expect(screen.getByRole('tree')).toBeInTheDocument()
      expect(requests).toEqual([CLIENTS_REQUEST, '/api/tasks/9999'])

      await user.click(screen.getByRole('button', { name: 'Clear selection' }))

      expect(pathname()).toBe('/')
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it("shows an alert when the task's project is gone", async () => {
      mockHierarchy()
      server.use(http.get('/api/tasks/55', () => HttpResponse.json(buildTask(55, 999))))
      renderAt('/tasks/55')

      expect(await screen.findByRole('alert')).toHaveTextContent(
        "Couldn't find the project for task #55.",
      )
      expect(screen.getByRole('button', { name: 'Clear selection' })).toBeInTheDocument()
    })

    it.each(['abc', '0', '007'])(
      'shows an alert for the invalid id %s without asking the API',
      async (id) => {
        const { requests } = mockHierarchy()
        renderAt(`/tasks/${id}`)

        expect(await screen.findByRole('alert')).toHaveTextContent(
          "That task link isn't valid.",
        )
        expect(requests).toEqual([CLIENTS_REQUEST])
      },
    )

    it('offers a retry when the lookup fails, and opens the task after it', async () => {
      mockHierarchy()
      server.use(
        http.get('/api/tasks/399', () =>
          HttpResponse.json({ error: 'boom' }, { status: 500 }),
        ),
      )
      const { user } = renderAt('/tasks/399')

      expect(await screen.findByRole('alert')).toHaveTextContent(
        "Couldn't open task #399. boom",
      )

      mockHierarchy()
      await user.click(screen.getByRole('button', { name: 'Try again' }))

      expect(await screen.findByRole('treeitem', { name: 'Write copy' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(screen.queryByRole('alert')).toBeNull()
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
