import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes, useLocation } from 'react-router'
import { buildEntry, mockEntries } from '../support/entries'
import { mockHierarchy } from '../support/hierarchy'
import { server } from '../support/server'
import { renderWithProviders } from '../support/utils'
import { TaskEntriesPage } from '@/pages/TaskEntriesPage'

function Location() {
  const { pathname, search } = useLocation()
  return <p data-testid="location">{pathname + search}</p>
}

function renderAt(route: string) {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/tasks/:taskId/entries" element={<TaskEntriesPage />} />
      </Routes>
      <Location />
    </>,
    { route },
  )
}

const location = () => screen.getByTestId('location').textContent
const many = (count: number) =>
  Array.from({ length: count }, (_, i) => buildEntry(i + 1, 398))

describe('TaskEntriesPage', () => {
  beforeEach(() => mockHierarchy())

  it('shows the task and a row per entry with every column', async () => {
    mockEntries([buildEntry(7, 398, { comment: 'Fix the header' })])

    renderAt('/tasks/398/entries')

    expect(
      await screen.findByRole('heading', { name: 'Design homepage' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Task #398 · Time entries')).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Design homepage · Memtime'))
    expect(
      screen.getAllByRole('columnheader').map((header) => header.textContent),
    ).toEqual([
      'ID',
      'Task ID',
      'Comment',
      'Start',
      'End',
      'Duration',
      'Created At',
      'Actions',
    ])
    const row = (await screen.findAllByRole('row'))[1]!
    const cells = within(row).getAllByRole('cell')
    expect(cells[0]).toHaveTextContent('7')
    expect(cells[1]).toHaveTextContent('398')
    expect(cells[2]).toHaveTextContent('Fix the header')
    expect(cells[3]).toHaveTextContent(/^Jan 1, 2025 /)
    expect(cells[4]).toHaveTextContent(/^Jan 1, 2025 /)
    expect(cells[5]).toHaveTextContent('1h 5m')
    expect(cells[6]).toHaveTextContent(/^Jan 1, 2025 /)
    expect(within(cells[7]!).getByRole('link', { name: 'Edit entry 7' })).toHaveAttribute(
      'href',
      '/tasks/398/entries/7/edit',
    )
  })

  it('shows a loading status first', async () => {
    mockEntries(many(1))

    renderAt('/tasks/398/entries')

    expect(screen.getByRole('status')).toHaveTextContent('Loading time entries…')
    expect(await screen.findAllByRole('row')).toHaveLength(2)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('pages through the URL', async () => {
    const { requests } = mockEntries(many(60))
    const { user } = renderAt('/tasks/398/entries')
    const nav = await screen.findByRole('navigation', { name: 'Time entries pagination' })
    expect(within(nav).getByText('Showing 1–25 of 60')).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: 'Previous' })).toBeDisabled()

    await user.click(within(nav).getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Showing 26–50 of 60')).toBeInTheDocument()
    expect(location()).toBe('/tasks/398/entries?page=2')
    expect(requests).toContain('/api/tasks/398/entries?limit=25&offset=25')

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Showing 51–60 of 60')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByText('Showing 26–50 of 60')).toBeInTheDocument()
  })

  it('opens the page given in the URL', async () => {
    const { requests } = mockEntries(many(60))

    renderAt('/tasks/398/entries?page=3')

    expect(await screen.findByText('Showing 51–60 of 60')).toBeInTheDocument()
    expect(requests).toEqual(['/api/tasks/398/entries?limit=25&offset=50'])
  })

  it.each(['0', '-2', 'abc', '1.5', ''])('treats page=%j as page 1', async (value) => {
    mockEntries(many(60))

    renderAt(`/tasks/398/entries?page=${value}`)

    expect(await screen.findByText('Showing 1–25 of 60')).toBeInTheDocument()
  })

  it('replaces a page past the last with the last page', async () => {
    mockEntries(many(60))

    renderAt('/tasks/398/entries?page=9')

    expect(await screen.findByText('Showing 51–60 of 60')).toBeInTheDocument()
    expect(location()).toBe('/tasks/398/entries?page=3')
  })

  it('says so when the task has no entries', async () => {
    mockEntries([])

    renderAt('/tasks/398/entries')

    expect(
      await screen.findByText('No time entries for this task yet.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows an error with a way to retry', async () => {
    let fail = true
    server.use(
      http.get('/api/tasks/:taskId/entries', () =>
        fail
          ? HttpResponse.json({ error: 'Boom' }, { status: 502 })
          : HttpResponse.json({
              items: [buildEntry(1, 398)],
              total: 1,
              limit: 25,
              offset: 0,
            }),
      ),
    )
    const { user } = renderAt('/tasks/398/entries')

    expect(await screen.findByRole('alert')).toHaveTextContent('Boom')
    fail = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('explains a rate limit', async () => {
    server.use(
      http.get('/api/tasks/:taskId/entries', () =>
        HttpResponse.json({ error: 'raw' }, { status: 429 }),
      ),
    )

    renderAt('/tasks/398/entries')

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many requests/i)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('links to the form for adding an entry', async () => {
    mockEntries([])

    renderAt('/tasks/398/entries')

    expect(await screen.findByRole('link', { name: 'Add entry' })).toHaveAttribute(
      'href',
      '/tasks/398/entries/new',
    )
  })

  it('rejects an invalid task id without calling the server', () => {
    const { requests } = mockEntries([])

    renderAt('/tasks/abc/entries')

    expect(screen.getByRole('heading', { name: 'Task not found' })).toBeInTheDocument()
    expect(requests).toEqual([])
  })
})
