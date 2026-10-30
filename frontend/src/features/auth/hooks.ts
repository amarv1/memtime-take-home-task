import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSession, login, logout, type Session } from './api'

export const sessionQueryKey = ['session'] as const

export function useSession() {
  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: getSession,
    retry: false,
    staleTime: Infinity,
  })
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['session', 'login'],
    mutationFn: login,
    onSuccess: (session: Session) => {
      queryClient.setQueryData(sessionQueryKey, session)
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['session', 'logout'],
    mutationFn: logout,
    onSettled: () => {
      queryClient.clear()
      queryClient.setQueryData(sessionQueryKey, null)
    },
  })
}
