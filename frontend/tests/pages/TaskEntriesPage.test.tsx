import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { toast } from 'sonner'
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
        HttpResponse.json(
          { error: 'raw' },
          { status: 429, headers: { 'Retry-After': '23' } },
        ),
      ),
    )

    renderAt('/tasks/398/entries')

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many requests/i)
    expect(screen.getByRole('alert')).not.toHaveTextContent('raw')
    expect(screen.getByRole('button', { name: 'Try again in 23s' })).toBeDisabled()
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

  describe('deleting', () => {
    function mockDelete(entries: ReturnType<typeof many>, respond?: () => Response) {
      const deleted: string[] = []
      server.use(
        http.get('/api/tasks/:taskId/entries', ({ request }) => {
          const url = new URL(request.url)
          const limit = Number(url.searchParams.get('limit'))
          const offset = Number(url.searchParams.get('offset'))
          return HttpResponse.json({
            items: entries.slice(offset, offset + limit),
            total: entries.length,
            limit,
            offset,
          })
        }),
        http.delete('/api/tasks/:taskId/entries/:entryId', ({ params }) => {
          if (respond) return respond()
          deleted.push(String(params.entryId))
          entries.splice(
            entries.findIndex((e) => e.id === Number(params.entryId)),
            1,
          )
          return new HttpResponse(null, { status: 204 })
        }),
      )
      return deleted
    }

    beforeEach(() => vi.spyOn(toast, 'success').mockImplementation(() => 1))

    it('asks first, and does nothing on cancel', async () => {
      const deleted = mockDelete(many(2))
      const { user } = renderAt('/tasks/398/entries')

      await user.click(await screen.findByRole('button', { name: 'Delete entry 1' }))
      const dialog = await screen.findByRole('alertdialog')
      expect(dialog).toHaveTextContent('Delete time entry #1?')
      expect(dialog).toHaveTextContent('“Entry 1” will be removed')
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
      expect(deleted).toEqual([])
      expect(screen.getAllByRole('row')).toHaveLength(3)
    })

    it('deletes the entry, refreshes the list and says so', async () => {
      const deleted = mockDelete(many(2))
      const { user } = renderAt('/tasks/398/entries')

      await user.click(await screen.findByRole('button', { name: 'Delete entry 1' }))
      await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', {
          name: 'Delete',
        }),
      )

      await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2))
      expect(deleted).toEqual(['1'])
      expect(screen.queryByRole('button', { name: 'Delete entry 1' })).toBeNull()
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(toast.success).toHaveBeenCalledWith('Time entry #1 deleted')
    })

    it('shows the empty state after the last entry goes', async () => {
      mockDelete(many(1))
      const { user } = renderAt('/tasks/398/entries')

      await user.click(await screen.findByRole('button', { name: 'Delete entry 1' }))
      await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', {
          name: 'Delete',
        }),
      )

      expect(
        await screen.findByText('No time entries for this task yet.'),
      ).toBeInTheDocument()
    })

    it('moves to the last page when the current one becomes empty', async () => {
      mockDelete(many(26))
      const { user } = renderAt('/tasks/398/entries?page=2')

      await user.click(await screen.findByRole('button', { name: 'Delete entry 26' }))
      await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', {
          name: 'Delete',
        }),
      )

      expect(await screen.findByText('Showing 1–25 of 25')).toBeInTheDocument()
      expect(location()).toBe('/tasks/398/entries?page=1')
    })

    it.each([
      [404, "This time entry doesn't exist any more."],
      [502, "Couldn't delete the time entry. Please try again."],
    ])('keeps the dialog open and explains a %i answer', async (status, message) => {
      mockDelete(many(2), () => HttpResponse.json({ error: 'raw' }, { status }))
      const { user } = renderAt('/tasks/398/entries')

      await user.click(await screen.findByRole('button', { name: 'Delete entry 1' }))
      const dialog = await screen.findByRole('alertdialog')
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(message)
      expect(toast.success).not.toHaveBeenCalled()
      expect(screen.getAllByRole('row', { hidden: true })).toHaveLength(3)
    })
  })
})
