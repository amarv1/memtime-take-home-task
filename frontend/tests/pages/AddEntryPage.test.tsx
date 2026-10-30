import { fireEvent, screen, waitFor } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { Route, Routes, useLocation } from 'react-router'
import { toast } from 'sonner'
import { buildEntry } from '../support/entries'
import { mockHierarchy } from '../support/hierarchy'
import { server } from '../support/server'
import { renderWithProviders } from '../support/utils'
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
    fill('Start', '2025-01-01T09:00')
    fill('End', '2025-01-01T10:30')
    await user.click(screen.getByRole('button', { name: 'Add entry' }))

    expect(await screen.findByText('Entries list')).toBeInTheDocument()
    expect(bodies).toEqual([
      {
        taskId: '398',
        comment: 'Fix the header',
        start: new Date('2025-01-01T09:00').toISOString(),
        end: new Date('2025-01-01T10:30').toISOString(),
      },
    ])
    expect(toast.success).toHaveBeenCalledWith('Time entry #77 added')
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
    fill('Start', '2025-01-01T10:00')
    fill('End', '2025-01-01T10:00')
    await user.click(screen.getByRole('button', { name: 'Add entry' }))

    expect(await screen.findByText('End must be after the start')).toBeInTheDocument()
    expect(bodies).toEqual([])
  })

  it.each([
    [404, "This task doesn't exist any more."],
    [400, "The entry wasn't accepted. Bad dates"],
    [429, 'Slow down'],
    [502, "Couldn't save the time entry. Please try again."],
  ])('explains a %i answer and keeps the input', async (status, message) => {
    mockCreate(() =>
      HttpResponse.json(
        { error: status === 429 ? 'Slow down' : 'Bad dates' },
        { status },
      ),
    )
    const { user } = renderAt('/tasks/398/entries/new')

    await user.type(field('Comment'), 'Work')
    await user.click(screen.getByRole('button', { name: 'Add entry' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(field('Comment')).toHaveValue('Work')
    expect(toast.success).not.toHaveBeenCalled()

    await user.type(field('Comment'), '!')
    expect(screen.queryByRole('alert')).toBeNull()
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
