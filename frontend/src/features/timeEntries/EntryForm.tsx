import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle, Loader2, TriangleAlert } from 'lucide-react'
import type { UseMutationResult } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'
import { isUnavailable, useAutoResend, withWait } from '@/lib/rateLimit'
import type { NewEntry, TimeEntry } from './api'
import {
  buildSchema,
  defaultValues,
  draftTimes,
  isUnchanged,
  toDraft,
  valuesOf,
  type FormValues,
} from './entryDraft'
import { findWarnings, type FormWarning, type RuleField } from './rules'
import { WarningPanel } from './WarningPanel'

interface Props {
  taskId: number
  taskName: string | undefined
  /** Set on create only, for the completed-task warning (edits don't check it, like the server). */
  taskStatus?: string
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
  taskStatus,
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
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: entry ? valuesOf(entry) : defaultValues(),
    // Errors show once the user leaves a field, then update while they type.
    mode: 'onTouched',
  })

  // Warnings the form can find on its own show while typing, before anything is sent.
  const values = useWatch({ control }) as FormValues
  const [openedAt] = useState(Date.now)
  const warningsAt = (now: number) => {
    const times = draftTimes(values, entry)
    if (!times) return []
    return findWarnings(times, {
      now,
      taskStatus,
      original: entry && { start: Date.parse(entry.start), end: Date.parse(entry.end) },
    })
  }
  const liveWarnings = warningsAt(openedAt)

  // Codes of the warnings the user has confirmed since the last edit.
  const [confirmed, setConfirmed] = useState<string[]>([])
  // Warnings found on submit, asked about before anything is sent.
  const [review, setReview] = useState<FormWarning[]>([])
  // What "Save anyway" sends again: the draft of the last submit.
  const lastDraft = useRef<NewEntry | null>(null)

  const error = create.error instanceof ApiError ? create.error : undefined
  // After a 429 the save is resent on its own; while Memtime is down, saving waits for the time the server named.
  const { waiting, secondsLeft, startOver } = useAutoResend(create.error, () => {
    if (create.variables) create.mutate(create.variables, { onSuccess: onSaved })
  })
  // The form stays locked while waiting, so the resent request matches what's on screen.
  const busy = create.isPending || waiting
  const warnings = error?.status === 409 ? (error.warnings ?? []) : review
  // A 400 the server pinned to a field shows under that field, not in the alert.
  const serverField =
    error?.status === 400 && error.field && FIELDS.includes(error.field)
      ? error.field
      : undefined
  const fieldError = (field: keyof FormValues) =>
    errors[field]?.message ?? (serverField === field ? error?.message : undefined)
  const fieldWarnings = (field: RuleField) =>
    liveWarnings.filter((warning) => warning.field === field)
  /** Error and warning ids for `aria-describedby`; an error hides the field's warnings. */
  const describedBy = (field: keyof FormValues) =>
    fieldError(field)
      ? `${field}-error`
      : fieldWarnings(field).length > 0
        ? `${field}-warning`
        : undefined

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
    const unconfirmed = warningsAt(Date.now()).filter(
      (warning) => !confirmed.includes(warning.code),
    )
    if (unconfirmed.length > 0) {
      create.reset()
      setReview(unconfirmed)
      return
    }
    startOver()
    send(draft, confirmed)
  }

  function saveAnyway() {
    if (!lastDraft.current) return
    const accepted = [...new Set([...confirmed, ...warnings.map((w) => w.code)])]
    setConfirmed(accepted)
    setReview([])
    startOver()
    send(lastDraft.current, accepted)
  }

  /** Any change makes the user's earlier confirmation, and what it was about, obsolete. */
  function resetConfirmation() {
    setConfirmed([])
    setReview([])
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
          aria-describedby={fieldWarnings('task').length > 0 ? 'task-warning' : undefined}
        />
        <FieldWarnings id="task" warnings={fieldWarnings('task')} />
      </div>

      <Field
        label="Comment"
        id="comment"
        error={fieldError('comment')}
        warnings={fieldWarnings('comment')}
      >
        <Input
          id="comment"
          autoComplete="off"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the form is the point of this page
          autoFocus
          placeholder="What did you work on?"
          aria-invalid={fieldError('comment') ? true : undefined}
          aria-describedby={describedBy('comment')}
          readOnly={busy}
          {...register('comment', fieldProps)}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Start"
          id="start"
          error={fieldError('start')}
          warnings={fieldWarnings('start')}
        >
          <Input
            id="start"
            type="datetime-local"
            aria-invalid={fieldError('start') ? true : undefined}
            aria-describedby={describedBy('start')}
            readOnly={busy}
            {...register('start', fieldProps)}
          />
        </Field>
        <Field
          label="End"
          id="end"
          error={fieldError('end')}
          warnings={fieldWarnings('end')}
        >
          <Input
            id="end"
            type="datetime-local"
            aria-invalid={fieldError('end') ? true : undefined}
            aria-describedby={describedBy('end')}
            readOnly={busy}
            {...register('end', fieldProps)}
          />
        </Field>
      </div>

      {warnings.length > 0 && (
        <WarningPanel
          warnings={warnings}
          disabled={busy}
          onConfirm={saveAnyway}
          onKeepEditing={resetConfirmation}
        />
      )}

      {waiting && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-lg bg-muted p-3 text-sm text-muted-foreground"
        >
          {/* Read out once; the visible countdown changes every second. */}
          <span className="sr-only">Memtime is busy. Saving as soon as it can.</span>
          <span aria-hidden>Memtime is busy, saving in {secondsLeft}s…</span>
          <Button type="button" variant="outline" size="xs" onClick={create.reset}>
            Cancel saving
          </Button>
        </div>
      )}

      {create.isError && !waiting && warnings.length === 0 && !serverField && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{errorMessage(create.error, notFoundMessage)}</p>
        </div>
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={busy || secondsLeft > 0}>
          {busy ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              Saving…
            </>
          ) : secondsLeft > 0 ? (
            `Try again in ${secondsLeft}s`
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
  warnings: FormWarning[]
  children: React.ReactNode
}

function Field({ label, id, error, warnings, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : (
        <FieldWarnings id={id} warnings={warnings} />
      )}
    </div>
  )
}

/** A heads-up under a field; saving still works after the user confirms. */
function FieldWarnings({ id, warnings }: { id: string; warnings: FormWarning[] }) {
  if (warnings.length === 0) return null
  return (
    <p
      id={`${id}-warning`}
      className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400"
    >
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{warnings.map((warning) => warning.message).join('. ')}</span>
    </p>
  )
}

function errorMessage(error: Error, notFoundMessage: string): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return notFoundMessage
    if (error.status === 400 || error.status === 0) return error.message
    if (error.status === 429) return withWait(error)
    if (isUnavailable(error)) return error.message
  }
  return "Couldn't save the time entry. Please try again."
}
