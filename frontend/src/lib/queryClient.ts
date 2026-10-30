import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { sessionQueryKey } from '@/features/auth/hooks'
import { ApiError } from '@/lib/api'

/**
 * Retry a failed query twice, but never a 4xx (the request itself is wrong or refused) or a 503
 * (the server's circuit to Memtime is open): asking again only wastes calls.
 */
export function shouldRetry(failureCount: number, error: Error): boolean {
  const final =
    error instanceof ApiError &&
    ((error.status >= 400 && error.status < 500) || error.status === 503)
  return failureCount < 2 && !final
}

/** Builds a client that signs the user out locally when any call returns 401. */
export function createQueryClient() {
  const handleError = (error: Error, key: readonly unknown[] | undefined) => {
    // The session calls handle their own 401s (that's how login/logout work).
    if (key?.[0] === sessionQueryKey[0]) return
    if (!(error instanceof ApiError) || error.status !== 401) return
    if (client.getQueryData(sessionQueryKey) === null) return // already signed out
    client.setQueryData(sessionQueryKey, null)
    toast.info('Your session has expired. Please sign in again.')
  }

  const client = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => handleError(error, query.queryKey),
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) =>
        handleError(error, mutation.options.mutationKey),
    }),
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        retry: shouldRetry,
        refetchOnWindowFocus: false,
      },
    },
  })
  return client
}

export const queryClient = createQueryClient()
