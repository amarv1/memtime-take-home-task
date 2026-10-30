import { Clock, LogOut } from 'lucide-react'
import { Outlet, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { useLogout } from '@/features/auth/hooks'

export function AppLayout() {
  const navigate = useNavigate()
  const logout = useLogout()

  function signOut() {
    logout.mutate(undefined, {
      onSettled: () => void navigate('/login', { replace: true }),
    })
  }

  return (
    <div className="min-h-svh">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <span className="flex items-center gap-2 text-lg font-semibold">
            <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
              <Clock className="size-4" aria-hidden />
            </span>
            Memtime
          </span>
          <Button variant="ghost" onClick={signOut} disabled={logout.isPending}>
            <LogOut aria-hidden />
            Sign out
          </Button>
        </div>
      </header>
      <Outlet />
    </div>
  )
}
