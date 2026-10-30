import { Clock, LogOut } from 'lucide-react'
import { Outlet, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { useLogout } from '@/features/auth/hooks'
import { HierarchyTree } from '@/features/hierarchy/HierarchyTree'

export function AppLayout() {
  const navigate = useNavigate()
  const logout = useLogout()

  function signOut() {
    logout.mutate(undefined, {
      onSettled: () => void navigate('/login', { replace: true }),
    })
  }

  return (
    <div className="flex h-svh flex-col">
      <header className="shrink-0 border-b bg-background">
        <div className="flex h-14 items-center justify-between px-4">
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
      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[20rem_minmax(0,1fr)] md:grid-rows-1">
        <aside
          aria-label="Clients and projects"
          className="max-h-[45svh] overflow-y-auto border-b p-2 md:max-h-none md:border-r md:border-b-0"
        >
          <HierarchyTree />
        </aside>
        <div className="overflow-y-auto">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
