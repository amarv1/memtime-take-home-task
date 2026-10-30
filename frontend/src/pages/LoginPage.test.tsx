import { screen, waitFor } from '@testing-library/react'
import { delay, http, HttpResponse, type JsonBodyType } from 'msw'
import { Navigate, Route, Routes, useLocation, type InitialEntry } from 'react-router'
import { mockSession, testSession } from '@/test/session'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { LoginPage } from './LoginPage'

function Where() {
  const location = useLocation()
  return <p>at {location.pathname}</p>
}

function renderLogin(route: InitialEntry = '/login') {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="*" element={<Where />} />
    </Routes>,
    { route },
  )
}

function postHandler(status: number, body: JsonBodyType, seen?: (b: unknown) => void) {
  server.use(
    http.post('/api/session', async ({ request }) => {
      seen?.(await request.json())
      return HttpResponse.json(body, { status })
    }),
  )
}

async function submit(user: ReturnType<typeof renderLogin>['user'], key = 'my-key') {
  const input = await screen.findByLabelText('API key')
  await user.type(input, key)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  return input
}

beforeEach(() => mockSession(false))

describe('LoginPage', () => {
  it('renders the form and the security note', async () => {
    renderLogin()
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByLabelText('API key')).toHaveAttribute('type', 'password')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByText(/never stored in your browser/i)).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Sign in · Memtime'))
  })

  it('shows validation for an empty submit without a request', async () => {
    const { user } = renderLogin()
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    const input = screen.getByLabelText('API key')
    const message = await screen.findByText('Enter your API key')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', message.id)
  })

  it('treats whitespace as empty', async () => {
    const { user } = renderLogin()
    await user.type(screen.getByLabelText('API key'), '   ')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Enter your API key')).toBeInTheDocument()
  })

  it('signs in with a trimmed key and goes home', async () => {
    let body: unknown
    postHandler(200, testSession, (b) => (body = b))
    const { user } = renderLogin()
    await submit(user, '  my-key  ')
    expect(await screen.findByText('at /')).toBeInTheDocument()
    expect(body).toEqual({ apiKey: 'my-key' })
  })

  it('returns to the page the user came from', async () => {
    postHandler(200, testSession)
    const { user } = renderWithProviders(
      <Routes>
        <Route
          path="/start"
          element={<Navigate to="/login" state={{ from: { pathname: '/reports' } }} />}
        />
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Where />} />
      </Routes>,
      { route: '/start' },
    )
    await submit(user)
    expect(await screen.findByText('at /reports')).toBeInTheDocument()
  })

  it.each([
    [
      401,
      { error: 'Invalid API key' },
      "That API key wasn't accepted. Check it and try again.",
    ],
    [
      429,
      { error: 'Too many attempts. Wait a minute and try again.' },
      'Too many attempts. Wait a minute and try again.',
    ],
    [500, { error: 'boom' }, 'Something went wrong on our side. Please try again.'],
    [
      502,
      { error: "Couldn't reach Memtime. Please try again." },
      'Something went wrong on our side. Please try again.',
    ],
  ])(
    'shows the right alert for %i and refocuses the input',
    async (status, body, text) => {
      postHandler(status, body)
      const { user } = renderLogin()
      const input = await submit(user)
      expect(await screen.findByRole('alert')).toHaveTextContent(text)
      await waitFor(() => expect(input).toHaveFocus())
    },
  )

  it('shows the network message when the server is unreachable', async () => {
    server.use(http.post('/api/session', () => HttpResponse.error()))
    const { user } = renderLogin()
    await submit(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Can't reach the server. Check your connection and try again.",
    )
  })

  it('shows the generic message for non-API errors', async () => {
    server.use(
      http.post('/api/session', () => new HttpResponse('<html>', { status: 200 })),
    )
    const { user } = renderLogin()
    await submit(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong on our side.',
    )
  })

  it('clears the alert when the user types', async () => {
    postHandler(401, { error: 'Invalid API key' })
    const { user } = renderLogin()
    const input = await submit(user)
    await screen.findByRole('alert')
    await user.type(input, 'x')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('disables the button while pending', async () => {
    server.use(
      http.post('/api/session', async () => {
        await delay(100)
        return HttpResponse.json(testSession)
      }),
    )
    const { user } = renderLogin()
    await submit(user)
    const button = await screen.findByRole('button', { name: /signing in/i })
    expect(button).toBeDisabled()
    expect(await screen.findByText('at /')).toBeInTheDocument()
  })

  it('toggles key visibility', async () => {
    const { user } = renderLogin()
    const input = screen.getByLabelText('API key')
    const toggle = screen.getByRole('button', { name: 'Show API key' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await user.click(toggle)
    expect(input).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide API key' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.click(screen.getByRole('button', { name: 'Hide API key' }))
    expect(input).toHaveAttribute('type', 'password')
  })

  it('redirects home when already signed in', async () => {
    mockSession(true)
    renderLogin()
    expect(await screen.findByText('at /')).toBeInTheDocument()
  })
})
