import { Loader2 } from 'lucide-react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { Button } from '@/components/ui/button'
import { useSession } from './hooks'

/** Layout route: renders children only for a signed-in user. */
export function RequireAuth() {
  const { data: session, isPending, isError, refetch } = useSession()
  const location = useLocation()

  if (isPending) {
    return (
      <div role="status" className="grid min-h-svh place-items-center">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Checking your session…
        </span>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="grid min-h-svh place-items-center px-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-sm">We couldn't check your session.</p>
          <Button variant="outline" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  if (session === null) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}
