import { toast } from 'sonner'
import { sessionQueryKey } from '@/features/auth/hooks'
import { ApiError } from '@/lib/api'
import { createQueryClient, queryClient } from '@/lib/queryClient'

vi.mock('sonner', () => ({ toast: { info: vi.fn() } }))

const session = { expiresAt: '2030-01-01T00:00:00.000Z' }

const noop = () => undefined

function fail(error: Error) {
  return () => Promise.reject(error)
}

beforeEach(() => vi.mocked(toast.info).mockClear())

describe('createQueryClient', () => {
  it('exports an app client', () => {
    expect(queryClient.getDefaultOptions().queries?.staleTime).toBe(60_000)
  })

  it('signs out and toasts on a 401 from another query', async () => {
    const client = createQueryClient()
    client.setQueryData(sessionQueryKey, session)
    await client
      .fetchQuery({
        queryKey: ['clients'],
        queryFn: fail(new ApiError(401, 'x')),
        retry: false,
      })
      .catch(noop)
    expect(client.getQueryData(sessionQueryKey)).toBeNull()
    expect(toast.info).toHaveBeenCalledWith(
      'Your session has expired. Please sign in again.',
    )
  })

  it('toasts only once when already signed out', async () => {
    const client = createQueryClient()
    client.setQueryData(sessionQueryKey, null)
    await client
      .fetchQuery({
        queryKey: ['clients'],
        queryFn: fail(new ApiError(401, 'x')),
        retry: false,
      })
      .catch(noop)
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('handles a 401 from a mutation', async () => {
    const client = createQueryClient()
    client.setQueryData(sessionQueryKey, session)
    await client
      .getMutationCache()
      .build(client, {
        mutationKey: ['things'],
        mutationFn: fail(new ApiError(401, 'x')),
      })
      .execute(undefined)
      .catch(noop)
    expect(client.getQueryData(sessionQueryKey)).toBeNull()
    expect(toast.info).toHaveBeenCalledTimes(1)
  })

  it('ignores 401s from the session query and mutations', async () => {
    const client = createQueryClient()
    client.setQueryData(sessionQueryKey, session)
    await client
      .fetchQuery({
        queryKey: sessionQueryKey,
        queryFn: fail(new ApiError(401, 'x')),
        retry: false,
        staleTime: 0,
      })
      .catch(noop)
    await client
      .getMutationCache()
      .build(client, {
        mutationKey: ['session', 'login'],
        mutationFn: fail(new ApiError(401, 'x')),
      })
      .execute(undefined)
      .catch(noop)
    expect(toast.info).not.toHaveBeenCalled()
    expect(client.getQueryData(sessionQueryKey)).toEqual(session)
  })

  it('ignores non-401 and non-API errors', async () => {
    const client = createQueryClient()
    client.setQueryData(sessionQueryKey, session)
    await client
      .fetchQuery({
        queryKey: ['a'],
        queryFn: fail(new ApiError(500, 'x')),
        retry: false,
      })
      .catch(noop)
    await client
      .fetchQuery({ queryKey: ['b'], queryFn: fail(new Error('x')), retry: false })
      .catch(noop)
    expect(toast.info).not.toHaveBeenCalled()
    expect(client.getQueryData(sessionQueryKey)).toEqual(session)
  })
})
