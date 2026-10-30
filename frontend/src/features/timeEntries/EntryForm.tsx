import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle, Loader2 } from 'lucide-react'
import type { UseMutationResult } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'
import type { NewEntry, TimeEntry } from './api'
import {
  buildSchema,
  defaultValues,
  isUnchanged,
  toDraft,
  valuesOf,
  type FormValues,
} from './entryDraft'
import { WarningPanel } from './WarningPanel'

interface Props {
  taskId: number
  taskName: string | undefined
  /** The entry being edited; without it the form starts a new one. */
  entry?: TimeEntry
  save: UseMutationResult<TimeEntry, Error, NewEntry>
  submitLabel: string
  /** Shown when the save answers 404. */
  notFoundMessage: string
  onSaved: (entry: TimeEntry) => void
  /** Called instead of saving when an edit changes nothing. */
  onUnchanged?: () => void
  onCancel: () => void
}

const FIELDS = ['comment', 'start', 'end']

/** The task is fixed by the page, so it's shown but can't be changed here. */
export function EntryForm({
  taskId,
  taskName,
  entry,
  save: create,
  submitLabel,
  notFoundMessage,
  onSaved,
  onUnchanged,
  onCancel,
}: Props) {
  const schema = useMemo(() => buildSchema(entry), [entry])
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: entry ? valuesOf(entry) : defaultValues(),
  })

  // Codes of the warnings the user has confirmed since the last edit.
  const [confirmed, setConfirmed] = useState<string[]>([])
  // What "Save anyway" sends again: the draft of the last submit.
  const lastDraft = useRef<NewEntry | null>(null)

  const error = create.error instanceof ApiError ? create.error : undefined
  const warnings = error?.status === 409 ? (error.warnings ?? []) : []
  // A 400 the server pinned to a field shows under that field, not in the alert.
  const serverField =
    error?.status === 400 && error.field && FIELDS.includes(error.field)
      ? error.field
      : undefined
  const fieldError = (field: keyof FormValues) =>
    errors[field]?.message ?? (serverField === field ? error?.message : undefined)

  function send(draft: NewEntry, accepted: string[]) {
    create.mutate(
      { ...draft, ...(accepted.length > 0 && { acceptedWarnings: accepted }) },
      { onSuccess: onSaved },
    )
  }

  function onSubmit(values: FormValues) {
    const draft = toDraft(values, entry)
    if (entry && onUnchanged && isUnchanged(entry, draft)) {
      onUnchanged()
      return
    }
    lastDraft.current = draft
    send(draft, confirmed)
  }

  function saveAnyway() {
    if (!lastDraft.current) return
    const accepted = [...new Set([...confirmed, ...warnings.map((w) => w.code)])]
    setConfirmed(accepted)
    send(lastDraft.current, accepted)
  }

  /** Any change makes the user's earlier confirmation, and what it was about, obsolete. */
  function resetConfirmation() {
    setConfirmed([])
    create.reset()
  }

  const fieldProps = { onChange: resetConfirmation }

  return (
    <form
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      noValidate
      className="flex max-w-xl flex-col gap-5"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="task">Task</Label>
        <Input
          id="task"
          readOnly
          value={taskName ? `${taskName} (#${taskId})` : `#${taskId}`}
          className="bg-muted/50"
        />
      </div>

      <Field label="Comment" id="comment" error={fieldError('comment')}>
        <Input
          id="comment"
          autoComplete="off"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the form is the point of this page
          autoFocus
          placeholder="What did you work on?"
          aria-invalid={fieldError('comment') ? true : undefined}
          aria-describedby={fieldError('comment') ? 'comment-error' : undefined}
          {...register('comment', fieldProps)}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Start" id="start" error={fieldError('start')}>
          <Input
            id="start"
            type="datetime-local"
            aria-invalid={fieldError('start') ? true : undefined}
            aria-describedby={fieldError('start') ? 'start-error' : undefined}
            {...register('start', fieldProps)}
          />
        </Field>
        <Field label="End" id="end" error={fieldError('end')}>
          <Input
            id="end"
            type="datetime-local"
            aria-invalid={fieldError('end') ? true : undefined}
            aria-describedby={fieldError('end') ? 'end-error' : undefined}
            {...register('end', fieldProps)}
          />
        </Field>
      </div>

      {warnings.length > 0 && (
        <WarningPanel
          warnings={warnings}
          disabled={create.isPending}
          onConfirm={saveAnyway}
          onKeepEditing={resetConfirmation}
        />
      )}

      {create.isError && warnings.length === 0 && !serverField && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{errorMessage(create.error, notFoundMessage)}</p>
        </div>
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              Saving…
            </>
          ) : (
            submitLabel
          )}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

interface FieldProps {
  label: string
  id: string
  error: string | undefined
  children: React.ReactNode
}

function Field({ label, id, error, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

function errorMessage(error: Error, notFoundMessage: string): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return notFoundMessage
    if (error.status === 400 || error.status === 429 || error.status === 0)
      return error.message
  }
  return "Couldn't save the time entry. Please try again."
}
