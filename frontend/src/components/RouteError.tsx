import { AlertTriangle } from 'lucide-react'
import { isRouteErrorResponse, useRouteError } from 'react-router'
import { Button } from '@/components/ui/button'

/** `errorElement` for the route tree: shown when a route throws while rendering. */
export function RouteError() {
  const error = useRouteError()
  const notFound = isRouteErrorResponse(error) && error.status === 404

  // The error is logged for developers; users only see a plain message.
  if (!notFound) console.error(error)

  return (
    <main className="grid min-h-svh place-items-center px-4">
      <title>Something went wrong · Memtime</title>
      <div role="alert" className="flex max-w-sm flex-col items-center gap-4 text-center">
        <span className="grid size-10 place-items-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">
            {notFound ? 'Page not found' : 'Something went wrong'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {notFound
              ? "We couldn't find that page."
              : 'The page hit an unexpected problem. Your data is safe. Reloading usually fixes it.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => window.location.reload()}>Reload page</Button>
          <Button variant="outline" asChild>
            <a href="/">Go to home</a>
          </Button>
        </div>
      </div>
    </main>
  )
}
