import { act, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router'
import { toast } from 'sonner'
import { buildEntry, mockEntries } from '../support/entries'
import { mockHierarchy } from '../support/hierarchy'
import { server } from '../support/server'
import { renderWithProviders } from '../support/utils'
import { AddEntryPage } from '@/pages/AddEntryPage'
import { TaskEntriesPage } from '@/pages/TaskEntriesPage'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), info: vi.fn() } }))

const tooMany = (retryAfter = '3') =>
  HttpResponse.json(
    { error: 'Memtime is receiving too many requests.' },
    {
      status: 429,
      headers: { 'Retry-After': retryAfter },
    },
  )

/** Moves the fake clock and lets the resulting requests settle. */
const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

describe('resending after a 429', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockHierarchy()
    vi.mocked(toast.success).mockClear()
  })
  afterEach(() => vi.useRealTimers())

  describe('saving', () => {
    function mockCreate(...answers: (() => Response)[]) {
      const calls = { count: 0 }
      server.use(
        http.post('/api/tasks/:taskId/entries', () => {
          const answer = answers[Math.min(calls.count++, answers.length - 1)]
          return answer?.() ?? HttpResponse.json(buildEntry(77, 398), { status: 201 })
        }),
      )
      return calls
    }

    function renderForm() {
      const view = renderWithProviders(
        <Routes>
          <Route path="/tasks/:taskId/entries/new" element={<AddEntryPage />} />
          <Route path="/tasks/:taskId/entries" element={<p>Entries list</p>} />
        </Routes>,
        { route: '/tasks/398/entries/new' },
      )
      return view
    }

    async function submit(user: ReturnType<typeof renderForm>['user']) {
      await user.type(screen.getByLabelText('Comment'), 'Work')
      await user.click(screen.getByRole('button', { name: 'Add entry' }))
    }

    const created = () => HttpResponse.json(buildEntry(77, 398), { status: 201 })

    it('counts down, then saves on its own', async () => {
      const calls = mockCreate(() => tooMany(), created)
      const { user } = renderForm()
      await submit(user)

      expect(
        await screen.findByText('Memtime is busy, saving in 3s…'),
      ).toBeInTheDocument()
      expect(screen.getByRole('status')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
      expect(screen.getByLabelText('Comment')).toHaveAttribute('readonly')
      expect(screen.queryByRole('alert')).toBeNull()

      await wait(1000)
      expect(screen.getByText('Memtime is busy, saving in 2s…')).toBeInTheDocument()
      expect(calls.count).toBe(1)

      await wait(2500)
      expect(await screen.findByText('Entries list')).toBeInTheDocument()
      expect(calls.count).toBe(2)
      expect(toast.success).toHaveBeenCalledWith(
        'Time entry #77 added',
        expect.anything(),
      )
    })

    it('stops resending on Cancel saving and leaves the form as it was', async () => {
      const calls = mockCreate(() => tooMany())
      const { user } = renderForm()
      await submit(user)
      await user.click(await screen.findByRole('button', { name: 'Cancel saving' }))

      expect(screen.queryByRole('status')).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.getByLabelText('Comment')).toHaveValue('Work')
      expect(screen.getByRole('button', { name: 'Add entry' })).toBeEnabled()

      await wait(10_000)
      expect(calls.count).toBe(1)
    })

    it('does not resend after leaving the page', async () => {
      const calls = mockCreate(() => tooMany(), created)
      const { user, unmount } = renderForm()
      await submit(user)
      await screen.findByText('Memtime is busy, saving in 3s…')

      unmount()
      await wait(10_000)

      expect(calls.count).toBe(1)
      expect(toast.success).not.toHaveBeenCalled()
    })

    it('does not resend after navigating away', async () => {
      const calls = mockCreate(() => tooMany(), created)
      const { user } = renderForm()
      await submit(user)
      await screen.findByText('Memtime is busy, saving in 3s…')

      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(await screen.findByText('Entries list')).toBeInTheDocument()
      await wait(10_000)

      expect(calls.count).toBe(1)
    })

    it('shows the old error after two resends all got a 429', async () => {
      const calls = mockCreate(() => tooMany('1'))
      const { user } = renderForm()
      await submit(user)

      await screen.findByText('Memtime is busy, saving in 1s…')
      await wait(1000)
      await screen.findByText('Memtime is busy, saving in 1s…')
      await wait(1000)

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Memtime is receiving too many requests. Try again in about 1s.',
      )
      expect(calls.count).toBe(3)
      await wait(10_000)
      expect(calls.count).toBe(3)
    })

    it('does not resend a 503', async () => {
      const calls = mockCreate(() =>
        HttpResponse.json(
          { error: 'Memtime is unavailable right now.' },
          { status: 503, headers: { 'Retry-After': '2' } },
        ),
      )
      const { user } = renderForm()
      await submit(user)

      expect(await screen.findByRole('alert')).toHaveTextContent('unavailable')
      expect(screen.queryByRole('status')).toBeNull()
      await wait(10_000)
      expect(calls.count).toBe(1)
    })
  })

  describe('deleting', () => {
    it('resends a delete on its own', async () => {
      const entries = [buildEntry(1, 398)]
      mockEntries(entries)
      let calls = 0
      server.use(
        http.delete('/api/tasks/:taskId/entries/:entryId', () =>
          ++calls === 1 ? tooMany() : new HttpResponse(null, { status: 204 }),
        ),
      )
      const { user } = renderWithProviders(
        <Routes>
          <Route path="/tasks/:taskId/entries" element={<TaskEntriesPage />} />
        </Routes>,
        { route: '/tasks/398/entries' },
      )

      await user.click(await screen.findByRole('button', { name: 'Delete entry 1' }))
      const dialog = await screen.findByRole('alertdialog')
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

      expect(
        await within(dialog).findByText('Memtime is busy, deleting in 3s…'),
      ).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: 'Deleting…' })).toBeDisabled()

      await wait(3500)
      expect(calls).toBe(2)
      expect(toast.success).toHaveBeenCalledWith('Time entry #1 deleted')
    })
  })
})
