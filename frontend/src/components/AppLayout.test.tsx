import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { testSession } from '@/test/session'
import { AppLayout } from './AppLayout'

describe('AppLayout', () => {
  it('signs out and lands on the login page', async () => {
    let deleted = false
    server.use(
      http.delete('/api/session', () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { user, queryClient } = renderWithProviders(
      <Routes>
        <Route path="/login" element={<p>login page</p>} />
        <Route element={<AppLayout />}>
          <Route path="/" element={<p>home</p>} />
        </Route>
      </Routes>,
    )
    queryClient.setQueryData(['session'], testSession)
    expect(screen.getByText('home')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByText('login page')).toBeInTheDocument()
    expect(deleted).toBe(true)
    expect(queryClient.getQueryData(['session'])).toBeNull()
  })
})
