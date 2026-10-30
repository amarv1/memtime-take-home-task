import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle, Clock, Eye, EyeOff, Loader2, Lock } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useLocation } from 'react-router'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useLogin, useSession } from '@/features/auth/hooks'
import { ApiError } from '@/lib/api'

const schema = z.object({
  apiKey: z.string().trim().min(1, 'Enter your API key'),
})
type FormValues = z.infer<typeof schema>

function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return GENERIC_ERROR
  if (error.status === 401) return "That API key wasn't accepted. Check it and try again."
  if (error.status === 429 || error.status === 0) return error.message
  return GENERIC_ERROR
}
const GENERIC_ERROR = 'Something went wrong on our side. Please try again.'

function redirectTarget(state: unknown): string {
  const from = (state as { from?: { pathname?: unknown } } | null)?.from?.pathname
  return typeof from === 'string' && from.startsWith('/') ? from : '/'
}

export function LoginPage() {
  const { data: session } = useSession()
  const login = useLogin()
  const location = useLocation()
  const [showKey, setShowKey] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { apiKey: '' },
  })
  const { ref: registerRef, onChange, ...field } = register('apiKey')

  // Move focus back to the field once a server error is shown.
  useEffect(() => {
    if (login.isError) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [login.isError])

  // Also covers a successful login: the session query updates and we leave.
  if (session) return <Navigate to={redirectTarget(location.state)} replace />

  function onSubmit({ apiKey }: FormValues) {
    login.mutate(apiKey)
  }

  const fieldError = errors.apiKey?.message

  return (
    <main className="grid min-h-svh place-items-center bg-muted/40 px-4 py-12">
      <title>Sign in · Memtime</title>
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Clock className="size-5" aria-hidden />
          </span>
          <span className="text-lg font-semibold">Memtime</span>
        </div>
        <Card className="w-full">
          <CardHeader>
            <CardTitle>
              <h1 className="text-lg">Sign in</h1>
            </CardTitle>
            <CardDescription>
              Enter your Memtime API key to see your clients, projects and time entries.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(event) => void handleSubmit(onSubmit)(event)}
              noValidate
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="apiKey">API key</Label>
                <div className="relative">
                  <Input
                    id="apiKey"
                    type={showKey ? 'text' : 'password'}
                    autoComplete="off"
                    spellCheck={false}
                    // eslint-disable-next-line jsx-a11y/no-autofocus -- the form is the only thing on the page
                    autoFocus
                    placeholder="Paste your API key"
                    className="h-9 pr-10 font-mono"
                    aria-invalid={fieldError ? true : undefined}
                    aria-describedby={fieldError ? 'apiKey-error' : undefined}
                    {...field}
                    ref={(element) => {
                      registerRef(element)
                      inputRef.current = element
                    }}
                    onChange={(event) => {
                      if (login.isError) login.reset()
                      void onChange(event)
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute top-1/2 right-1 -translate-y-1/2"
                    aria-label={showKey ? 'Hide API key' : 'Show API key'}
                    aria-pressed={showKey}
                    onClick={() => setShowKey((value) => !value)}
                  >
                    {showKey ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                  </Button>
                </div>
                {fieldError && (
                  <p id="apiKey-error" className="text-sm text-destructive">
                    {fieldError}
                  </p>
                )}
              </div>

              {login.isError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
                >
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <p>{errorMessage(login.error)}</p>
                </div>
              )}

              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={login.isPending}
              >
                {login.isPending ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden />
                    Signing in…
                  </>
                ) : (
                  'Sign in'
                )}
              </Button>

              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Your key stays on our server and is never stored in your browser. You'll
                be signed out after 1 hour.
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
