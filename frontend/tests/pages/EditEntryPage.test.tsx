import { fireEvent, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes, useLocation } from 'react-router'
import { toast } from 'sonner'
import { buildEntry } from '../support/entries'
import { mockHierarchy } from '../support/hierarchy'
import { server } from '../support/server'
import { renderWithProviders } from '../support/utils'
import { EditEntryPage } from '@/pages/EditEntryPage'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), info: vi.fn() } }))

function Location() {
  return <p data-testid="location">{useLocation().pathname}</p>
}

function renderAt(route: string) {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/tasks/:taskId/entries/:entryId/edit" element={<EditEntryPage />} />
        <Route path="/tasks/:taskId/entries" element={<p>Entries list</p>} />
      </Routes>
      <Location />
    </>,
    { route },
  )
}

const entry = buildEntry(7, 398, {
  comment: 'Fix the header',
  start: new Date('2025-01-01T09:00').toISOString(),
  end: new Date('2025-01-01T10:05').toISOString(),
})

function mockEntry(respond?: () => Response) {
  server.use(
    http.get(
      '/api/tasks/:taskId/entries/:entryId',
      ({ params }) =>
        respond?.() ??
        (Number(params.entryId) === 7
          ? HttpResponse.json(entry)
          : HttpResponse.json({ error: 'Time entry not found' }, { status: 404 })),
    ),
  )
}

function mockUpdate(respond?: () => Response) {
  const calls: { url: string; body: unknown }[] = []
  server.use(
    http.put('/api/tasks/:taskId/entries/:entryId', async ({ request }) => {
      calls.push({ url: new URL(request.url).pathname, body: await request.json() })
      return respond?.() ?? HttpResponse.json(entry)
    }),
  )
  return calls
}

const field = (name: string) => screen.getByLabelText(name)
const fill = (name: string, value: string) =>
  fireEvent.change(field(name), { target: { value } })

describe('EditEntryPage', () => {
  beforeEach(() => {
    mockHierarchy()
    mockEntry()
    vi.mocked(toast.success).mockClear()
  })

  it('preloads the entry, with the task read-only', async () => {
    renderAt('/tasks/398/entries/7/edit')

    expect(await screen.findByLabelText('Comment')).toHaveValue('Fix the header')
    expect(field('Start')).toHaveValue('2025-01-01T09:00')
    expect(field('End')).toHaveValue('2025-01-01T10:05')
    expect(screen.getByRole('heading', { name: 'Edit time entry' })).toBeInTheDocument()
    expect(screen.getByLabelText('Task')).toHaveAttribute('readonly')
    expect(await screen.findByDisplayValue('Design homepage (#398)')).toBeInTheDocument()
  })

  it('opens an entry whose id is 0', async () => {
    server.use(
      http.get('/api/tasks/:taskId/entries/0', () =>
        HttpResponse.json(buildEntry(0, 398, { comment: 'First' })),
      ),
    )

    renderAt('/tasks/398/entries/0/edit')

    expect(await screen.findByLabelText('Comment')).toHaveValue('First')
  })

  it('shows a loading status first', async () => {
    renderAt('/tasks/398/entries/7/edit')

    expect(screen.getByRole('status')).toHaveTextContent('Loading time entry…')
    await screen.findByLabelText('Comment')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('puts the changes, thanks with the id and goes back', async () => {
    const calls = mockUpdate()
    const { user } = renderAt('/tasks/398/entries/7/edit')
    const comment = await screen.findByLabelText('Comment')

    await user.clear(comment)
    await user.type(comment, 'Fix the footer')
    fill('End', '2025-01-01T11:00')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Entries list')).toBeInTheDocument()
    expect(calls).toEqual([
      {
        url: '/api/tasks/398/entries/7',
        body: {
          comment: 'Fix the footer',
          start: entry.start,
          end: new Date('2025-01-01T11:00').toISOString(),
        },
      },
    ])
    expect(toast.success).toHaveBeenCalledWith('Time entry #7 updated')
  })

  it('marks the task’s entries stale after saving', async () => {
    mockUpdate()
    const { user, queryClient } = renderAt('/tasks/398/entries/7/edit')
    queryClient.setQueryData(['entries', 398, 1], { items: [], total: 0 })
    await user.type(await screen.findByLabelText('Comment'), '!')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await screen.findByText('Entries list')
    expect(queryClient.getQueryState(['entries', 398, 1])?.isInvalidated).toBe(true)
  })

  it('checks the input before calling the server', async () => {
    const calls = mockUpdate()
    const { user } = renderAt('/tasks/398/entries/7/edit')
    const comment = await screen.findByLabelText('Comment')

    await user.clear(comment)
    fill('End', '2025-01-01T08:00')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Enter a comment')).toBeInTheDocument()
    expect(screen.getByText('End must be after the start')).toBeInTheDocument()
    expect(calls).toEqual([])
  })

  it.each([
    [404, "This time entry doesn't exist any more."],
    [400, "The entry wasn't accepted. Bad dates"],
    [502, "Couldn't save the time entry. Please try again."],
  ])('explains a %i answer and keeps the input', async (status, message) => {
    mockUpdate(() => HttpResponse.json({ error: 'Bad dates' }, { status }))
    const { user } = renderAt('/tasks/398/entries/7/edit')
    await screen.findByLabelText('Comment')

    await user.type(field('Comment'), '!')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(field('Comment')).toHaveValue('Fix the header!')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('keeps the seconds of a time that was not touched', async () => {
    const exact = {
      ...entry,
      start: new Date('2025-01-01T09:00:30.123').toISOString(),
      end: new Date('2025-01-01T10:05:45.500').toISOString(),
    }
    mockEntry(() => HttpResponse.json(exact))
    const calls = mockUpdate()
    const { user } = renderAt('/tasks/398/entries/7/edit')

    await user.type(await screen.findByLabelText('Comment'), '!')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await screen.findByText('Entries list')
    expect(calls[0]?.body).toEqual({
      comment: 'Fix the header!',
      start: exact.start,
      end: exact.end,
    })
  })

  it('rounds a time the user changed to the minute they typed', async () => {
    const exact = { ...entry, start: new Date('2025-01-01T09:00:30.123').toISOString() }
    mockEntry(() => HttpResponse.json(exact))
    const calls = mockUpdate()
    const { user } = renderAt('/tasks/398/entries/7/edit')
    await screen.findByLabelText('Comment')

    fill('Start', '2025-01-01T08:30')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await screen.findByText('Entries list')
    expect(calls[0]?.body).toMatchObject({
      start: new Date('2025-01-01T08:30').toISOString(),
      end: exact.end,
    })
  })

  it('sends nothing, says so and goes back when nothing changed', async () => {
    const calls = mockUpdate()
    const { user } = renderAt('/tasks/398/entries/7/edit')
    await screen.findByLabelText('Comment')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Entries list')).toBeInTheDocument()
    expect(calls).toEqual([])
    expect(toast.info).toHaveBeenCalledWith('No changes to save')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('saves a change to an old entry without asking', async () => {
    const calls = mockUpdate()
    const { user } = renderAt('/tasks/398/entries/7/edit')

    await user.type(await screen.findByLabelText('Comment'), '!')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Entries list')).toBeInTheDocument()
    expect(calls).toHaveLength(1)
  })

  it('saves anyway after a 409, sending the confirmed codes', async () => {
    let first = true
    const calls = mockUpdate(() => {
      if (!first) return HttpResponse.json(entry)
      first = false
      return HttpResponse.json(
        {
          error: 'Please confirm this time entry',
          warnings: [
            { code: 'long_duration', field: 'end', message: 'Longer than 12 hours' },
          ],
        },
        { status: 409 },
      )
    })
    const { user } = renderAt('/tasks/398/entries/7/edit')
    await screen.findByLabelText('Comment')

    fill('End', '2025-01-01T22:00')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Longer than 12 hours')

    await user.click(screen.getByRole('button', { name: 'Save anyway' }))

    expect(await screen.findByText('Entries list')).toBeInTheDocument()
    expect(calls[1]?.body).toMatchObject({ acceptedWarnings: ['long_duration'] })
  })

  it('shows the warnings of a 409', async () => {
    mockUpdate(() =>
      HttpResponse.json(
        {
          error: 'Please confirm this time entry',
          warnings: [
            {
              code: 'overlap',
              field: 'start',
              message: 'Overlaps 2 of your other entries',
              entries: [],
            },
          ],
        },
        { status: 409 },
      ),
    )
    const { user } = renderAt('/tasks/398/entries/7/edit')

    await user.type(await screen.findByLabelText('Comment'), '!')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Overlaps 2 of your other entries',
    )
    expect(screen.getByRole('button', { name: 'Save anyway' })).toBeInTheDocument()
  })

  it('goes back to the entries on cancel', async () => {
    const { user } = renderAt('/tasks/398/entries/7/edit')
    await screen.findByLabelText('Comment')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByText('Entries list')).toBeInTheDocument()
  })

  it('says so when the entry does not exist, with a way back', async () => {
    renderAt('/tasks/398/entries/8/edit')

    expect(await screen.findByText(/That time entry doesn't exist/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back to the task/ })).toHaveAttribute(
      'href',
      '/tasks/398/entries',
    )
    expect(screen.queryByLabelText('Comment')).toBeNull()
  })

  it('shows an error with a way to retry', async () => {
    let fail = true
    mockEntry(() =>
      fail
        ? HttpResponse.json({ error: 'Boom' }, { status: 502 })
        : HttpResponse.json(entry),
    )
    const { user } = renderAt('/tasks/398/entries/7/edit')

    expect(await screen.findByRole('alert')).toHaveTextContent('Boom')
    fail = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByLabelText('Comment')).toHaveValue('Fix the header')
  })

  it('shows no form for an invalid id', () => {
    renderAt('/tasks/398/entries/abc/edit')

    expect(screen.getByText(/That time entry doesn't exist/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Comment')).toBeNull()
  })
})
