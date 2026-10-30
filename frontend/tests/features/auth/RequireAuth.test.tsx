import { screen } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router'
import { mockSession } from '../../support/session'
import { server } from '../../support/server'
import { renderWithProviders } from '../../support/utils'
import { RequireAuth } from '@/features/auth/RequireAuth'

function renderGuarded() {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<p>login page</p>} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<p>secret</p>} />
      </Route>
    </Routes>,
  )
}

describe('RequireAuth', () => {
  it('shows a status while checking', async () => {
    server.use(
      http.get('/api/session', async () => {
        await delay(50)
        return HttpResponse.json({ expiresAt: 'x' })
      }),
    )
    renderGuarded()
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session…')
    expect(await screen.findByText('secret')).toBeInTheDocument()
  })

  it('redirects to login when signed out', async () => {
    mockSession(false)
    renderGuarded()
    expect(await screen.findByText('login page')).toBeInTheDocument()
  })

  it('renders the child when signed in', async () => {
    mockSession(true)
    renderGuarded()
    expect(await screen.findByText('secret')).toBeInTheDocument()
  })

  it('offers a retry on error', async () => {
    server.use(
      http.get('/api/session', () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    )
    const { user } = renderGuarded()
    await screen.findByText("We couldn't check your session.")
    mockSession(true)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('secret')).toBeInTheDocument()
  })
})
