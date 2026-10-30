import { fireEvent, screen, waitFor } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { Route, Routes, useLocation } from 'react-router'
import { toast } from 'sonner'
import { buildEntry } from '../support/entries'
import { mockHierarchy } from '../support/hierarchy'
import { server } from '../support/server'
import { renderWithProviders } from '../support/utils'
import { formatDateTime, toDateTimeInput } from '@/features/timeEntries/format'
import { AddEntryPage } from '@/pages/AddEntryPage'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), info: vi.fn() } }))

function Location() {
  return <p data-testid="location">{useLocation().pathname}</p>
}

function renderAt(route: string) {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/tasks/:taskId/entries/new" element={<AddEntryPage />} />
        <Route path="/tasks/:taskId/entries" element={<p>Entries list</p>} />
      </Routes>
      <Location />
    </>,
    { route },
  )
}

function mockCreate(respond?: () => Response | Promise<Response>) {
  const bodies: unknown[] = []
  server.use(
    http.post('/api/tasks/:taskId/entries', async ({ request, params }) => {
      const body = (await request.json()) as object
      bodies.push({ taskId: params.taskId, ...body })
      return respond?.() ?? HttpResponse.json(buildEntry(77, 398), { status: 201 })
    }),
  )
  return bodies
}

const HOUR = 3_600_000
/** A `datetime-local` value this many hours before now. */
const localAgo = (hours: number) => toDateTimeInput(new Date(Date.now() - hours * HOUR))

const field = (name: string) => screen.getByLabelText(name)
const fill = (name: string, value: string) =>
  fireEvent.change(field(name), { target: { value } })

describe('AddEntryPage', () => {
  beforeEach(() => {
    mockHierarchy()
    vi.mocked(toast.success).mockClear()
  })

  it('shows the selected task, read-only', async () => {
    renderAt('/tasks/398/entries/new')

    const task = screen.getByLabelText('Task')
    await waitFor(() => expect(task).toHaveValue('Design homepage (#398)'))
    expect(task).toHaveAttribute('readonly')
    expect(screen.getByRole('heading', { name: 'Add time entry' })).toBeInTheDocument()
  })

  it('starts with an hour that ends now', () => {
    renderAt('/tasks/398/entries/new')

    const start = new Date((field('Start') as HTMLInputElement).value).getTime()
    const end = new Date((field('End') as HTMLInputElement).value).getTime()
    expect(end - start).toBe(60 * 60 * 1000)
    expect(field('Comment')).toHaveValue('')
  })

  it('posts the entry with exact timestamps, thanks with the new id and goes back', async () => {
    const bodies = mockCreate()
    const { user } = renderAt('/tasks/398/entries/new')

    await user.type(field('Comment'), '  Fix the header ')
    fill('Start', localAgo(4))
    fill('End', localAgo(2.5))
    await user.click(screen.getByRole('button', { name: 'Add entry' }))

    expect(await screen.findByText('Entries list')).toBeInTheDocument()
    expect(bodies).toEqual([
      {
        taskId: '398',
        comment: 'Fix the header',
        start: new Date(localAgo(4)).toISOString(),
        end: new Date(localAgo(2.5)).toISOString(),
      },
    ])
    const created = buildEntry(77, 398)
    expect(toast.success).toHaveBeenCalledWith('Time entry #77 added', {
      description: `Entry 77 · ${formatDateTime(created.start)} – ${formatDateTime(created.end)} · 1h 5m`,
    })
    expect(screen.getByTestId('location')).toHaveTextContent('/tasks/398/entries')
  })

  it('refetches the task’s entries after saving', async () => {
    mockCreate()
    const { user, queryClient } = renderAt('/tasks/398/entries/new')
    queryClient.setQueryData(['entries', 398, 1], { items: [], total: 0 })

    await user.type(field('Comment'), 'Work')
    await user.click(screen.getByRole('button', { name: 'Add entry' }))

    await screen.findByText('Entries list')
    expect(queryClient.getQueryState(['entries', 398, 1])?.isInvalidated).toBe(true)
  })

  it('checks the input before calling the server', async () => {
    const bodies = mockCreate()
    const { user } = renderAt('/tasks/398/entries/new')

    fill('Start', '')
    fill('End', '')
    await user.type(field('Comment'), '   ')
    await user.click(screen.getByRole('button', { name: 'Add entry' }))

    expect(await screen.findByText('Enter a comment')).toBeInTheDocument()
    expect(screen.getByText('Enter a start time')).toBeInTheDocument()
    expect(screen.getByText('Enter an end time')).toBeInTheDocument()
    expect(field('Comment')).toHaveAttribute('aria-invalid', 'true')
    expect(field('Comment')).toHaveAccessibleDescription('Enter a comment')
    expect(bodies).toEqual([])
  })

  it('requires the end to be after the start', async () => {
    const bodies = mockCreate()
    const { user } = renderAt('/tasks/398/entries/new')

    await user.type(field('Comment'), 'Work')
    fill('Start', localAgo(2))
    fill('End', localAgo(2))
    await user.click(screen.getByRole('button', { name: 'Add entry' }))

    expect(await screen.findByText('End must be after the start')).toBeInTheDocument()
    expect(bodies).toEqual([])
  })

  it('shows an error for a comment over 500 characters and sends nothing', async () => {
    const bodies = mockCreate()
    const { user } = renderAt('/tasks/398/entries/new')

    fill('Comment', 'x'.repeat(501))
    await user.click(screen.getByRole('button', { name: 'Add entry' }))

    expect(
      await screen.findByText('Keep the comment to 500 characters or fewer'),
    ).toBeInTheDocument()
    expect(field('Comment')).toHaveAttribute('aria-invalid', 'true')
    expect(bodies).toEqual([])
  })

  it('shows a 400 under the field the server names, not in an alert', async () => {
    mockCreate(() =>
      HttpResponse.json(
        { error: "End can't be in the future", field: 'end', code: 'in_future' },
        { status: 400 },
      ),
    )
    const { user } = renderAt('/tasks/398/entries/new')
    fill('Comment', 'Work')

    await user.click(screen.getByRole('button', { name: 'Add entry' }))

    expect(await screen.findByText("End can't be in the future")).toBeInTheDocument()
    expect(field('End')).toHaveAttribute('aria-invalid', 'true')
    expect(field('End')).toHaveAccessibleDescription("End can't be in the future")
    expect(screen.queryByRole('alert')).toBeNull()

    await user.type(field('Comment'), '!')
    expect(screen.queryByText("End can't be in the future")).toBeNull()
  })

  it('shows a 400 without a field in the alert', async () => {
    mockCreate(() => HttpResponse.json({ error: 'Something odd' }, { status: 400 }))
    const { user } = renderAt('/tasks/398/entries/new')
    fill('Comment', 'Work')

    await user.click(screen.getByRole('button', { name: 'Add entry' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Something odd')
  })

  describe('warnings', () => {
    const submit = (user: ReturnType<typeof renderAt>['user']) =>
      user.click(screen.getByRole('button', { name: 'Add entry' }))

    const warn = (code: string, message: string, extra: object = {}) =>
      HttpResponse.json(
        {
          error: 'Please confirm this time entry',
          warnings: [{ code, field: 'start', message, ...extra }],
        },
        { status: 409 },
      )

    it('shows the warnings of a 409 with Save anyway and Keep editing', async () => {
      mockCreate(() => warn('long_duration', 'This entry is longer than 12 hours'))
      const { user } = renderAt('/tasks/398/entries/new')
      fill('Comment', 'Work')

      await submit(user)

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'This entry is longer than 12 hours',
      )
      expect(screen.getByRole('button', { name: 'Save anyway' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Keep editing' })).toBeInTheDocument()
      expect(screen.queryByText('Entries list')).toBeNull()
    })

    it('sends the confirmed warnings when saving anyway', async () => {
      let first = true
      const bodies = mockCreate(() => {
        if (!first) return HttpResponse.json(buildEntry(77, 398), { status: 201 })
        first = false
        return warn('completed_task', 'This task is completed')
      })
      const { user } = renderAt('/tasks/398/entries/new')
      fill('Comment', 'Work')
      await submit(user)

      await user.click(await screen.findByRole('button', { name: 'Save anyway' }))

      expect(await screen.findByText('Entries list')).toBeInTheDocument()
      expect(bodies[0]).not.toHaveProperty('acceptedWarnings')
      expect(bodies[1]).toMatchObject({ acceptedWarnings: ['completed_task'] })
    })

    it('hides the panel and forgets the confirmation when a field changes', async () => {
      const bodies = mockCreate(() => warn('old_start', 'Too old'))
      const { user } = renderAt('/tasks/398/entries/new')
      fill('Comment', 'Work')
      await submit(user)
      await screen.findByRole('alert')

      await user.type(field('Comment'), '!')
      expect(screen.queryByRole('alert')).toBeNull()

      await submit(user)
      await screen.findByRole('alert')
      expect(bodies).toHaveLength(2)
      expect(bodies[1]).not.toHaveProperty('acceptedWarnings')
    })

    it('hides the panel on Keep editing', async () => {
      mockCreate(() => warn('old_start', 'Too old'))
      const { user } = renderAt('/tasks/398/entries/new')
      fill('Comment', 'Work')
      await submit(user)

      await user.click(await screen.findByRole('button', { name: 'Keep editing' }))

      expect(screen.queryByRole('alert')).toBeNull()
    })

    const overlap = {
      error: 'Please confirm this time entry',
      warnings: [
        {
          code: 'overlap',
          field: 'start',
          message: 'Overlaps another of your entries',
          entries: [
            {
              id: 5,
              taskId: 12,
              start: '2026-06-01T09:00:00.000Z',
              end: '2026-06-01T10:00:00.000Z',
            },
          ],
        },
      ],
    }

    it('lists the overlapping entries of a 409', async () => {
      mockCreate(() => HttpResponse.json(overlap, { status: 409 }))
      const { user } = renderAt('/tasks/398/entries/new')
      fill('Comment', 'Work')

      await submit(user)

      const panel = await screen.findByRole('alert')
      expect(panel).toHaveTextContent('Overlaps another of your entries')
      expect(panel).toHaveTextContent(
        `Task #12, ${formatDateTime('2026-06-01T09:00:00.000Z')} – ${formatDateTime('2026-06-01T10:00:00.000Z')}`,
      )
    })

    it('keeps the confirmed codes when the server finds more', async () => {
      const second = {
        ...overlap,
        warnings: [{ code: 'old_start', field: 'start', message: 'Too old' }],
      }
      const answers = [overlap, second]
      const bodies = mockCreate(() => {
        const next = answers.shift()
        return next
          ? HttpResponse.json(next, { status: 409 })
          : HttpResponse.json(buildEntry(77, 398), { status: 201 })
      })
      const { user } = renderAt('/tasks/398/entries/new')
      fill('Comment', 'Work')
      await submit(user)
      await user.click(await screen.findByRole('button', { name: 'Save anyway' }))
      await screen.findByText('Too old')

      await user.click(screen.getByRole('button', { name: 'Save anyway' }))

      await screen.findByText('Entries list')
      expect(bodies[2]).toMatchObject({ acceptedWarnings: ['overlap', 'old_start'] })
    })
  })

  it.each([
    [404, "This task doesn't exist any more."],
    [400, 'Bad dates'],
    [502, "Couldn't save the time entry. Please try again."],
  ])('explains a %i answer and keeps the input', async (status, message) => {
    mockCreate(() => HttpResponse.json({ error: 'Bad dates' }, { status }))
    const { user } = renderAt('/tasks/398/entries/new')

    await user.type(field('Comment'), 'Work')
    await user.click(screen.getByRole('button', { name: 'Add entry' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(field('Comment')).toHaveValue('Work')
    expect(toast.success).not.toHaveBeenCalled()

    await user.type(field('Comment'), '!')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the server message and a countdown while Memtime is unavailable', async () => {
    mockCreate(() =>
      HttpResponse.json(
        { error: 'Memtime is unavailable right now. Try again in a minute.' },
        { status: 503, headers: { 'Retry-After': '30' } },
      ),
    )
    const { user } = renderAt('/tasks/398/entries/new')

    await user.type(field('Comment'), 'Work')
    await user.click(screen.getByRole('button', { name: 'Add entry' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Memtime is unavailable right now.',
    )
    expect(screen.getByRole('button', { name: /Try again in \d+s/ })).toBeDisabled()

    await user.type(field('Comment'), '!')
    expect(screen.getByRole('button', { name: 'Add entry' })).toBeEnabled()
  })

  it('disables saving while the request runs', async () => {
    mockCreate(async () => {
      await delay(50)
      return HttpResponse.json(buildEntry(77, 398), { status: 201 })
    })
    const { user } = renderAt('/tasks/398/entries/new')

    await user.type(field('Comment'), 'Work')
    await user.click(screen.getByRole('button', { name: 'Add entry' }))

    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled()
    await screen.findByText('Entries list')
  })

  it('goes back to the entries on cancel', async () => {
    const { user } = renderAt('/tasks/398/entries/new')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByText('Entries list')).toBeInTheDocument()
  })

  it('shows no form for an invalid task id', () => {
    renderAt('/tasks/abc/entries/new')
    expect(screen.getByText(/That task doesn't exist/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Comment')).toBeNull()
  })

  it('shows no form when the task is not found', async () => {
    renderAt('/tasks/99999/entries/new')
    expect(await screen.findByText(/That task doesn't exist/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Comment')).toBeNull()
  })
})
