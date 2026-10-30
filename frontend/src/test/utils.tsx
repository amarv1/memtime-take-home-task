import { QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderOptions } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter, type InitialEntry } from 'react-router'
import { createQueryClient } from '@/lib/queryClient'

interface Options extends Omit<RenderOptions, 'wrapper'> {
  /** Initial URL for the in-memory router. */
  route?: InitialEntry
}

/** Renders with the app's providers; a fresh QueryClient per call, no retries. */
export function renderWithProviders(
  ui: ReactElement,
  { route = '/', ...options }: Options = {},
) {
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: {
      ...queryClient.getDefaultOptions().queries,
      retry: false,
      gcTime: Infinity,
    },
  })

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </QueryClientProvider>
    )
  }

  return {
    user: userEvent.setup(),
    queryClient,
    ...render(ui, { wrapper: Wrapper, ...options }),
  }
}
