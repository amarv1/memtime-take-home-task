import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle, Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'
import type { TimeEntry } from './api'
import { useCreateEntry } from './hooks'
import { toDateTimeInput } from './format'

const MAX_COMMENT_LENGTH = 1000

const schema = z
  .object({
    comment: z
      .string()
      .trim()
      .min(1, 'Enter a comment')
      .max(MAX_COMMENT_LENGTH, `Keep the comment under ${MAX_COMMENT_LENGTH} characters`),
    start: z.string().min(1, 'Enter a start time'),
    end: z.string().min(1, 'Enter an end time'),
  })
  .refine(({ start, end }) => !start || !end || new Date(end) > new Date(start), {
    path: ['end'],
    message: 'End must be after the start',
  })
type FormValues = z.infer<typeof schema>

interface Props {
  taskId: number
  taskName: string | undefined
  onCreated: (entry: TimeEntry) => void
  onCancel: () => void
}

/** The task is fixed by the page, so it's shown but can't be changed here. */
export function AddEntryForm({ taskId, taskName, onCreated, onCancel }: Props) {
  const create = useCreateEntry(taskId)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults(),
  })

  function onSubmit({ comment, start, end }: FormValues) {
    create.mutate(
      {
        comment,
        // The inputs hold local time without a zone; this makes it an exact instant.
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
      },
      { onSuccess: onCreated },
    )
  }

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

      <Field label="Comment" id="comment" error={errors.comment?.message}>
        <Input
          id="comment"
          autoComplete="off"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the form is the point of this page
          autoFocus
          placeholder="What did you work on?"
          aria-invalid={errors.comment ? true : undefined}
          aria-describedby={errors.comment ? 'comment-error' : undefined}
          {...register('comment', { onChange: () => create.reset() })}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Start" id="start" error={errors.start?.message}>
          <Input
            id="start"
            type="datetime-local"
            aria-invalid={errors.start ? true : undefined}
            aria-describedby={errors.start ? 'start-error' : undefined}
            {...register('start', { onChange: () => create.reset() })}
          />
        </Field>
        <Field label="End" id="end" error={errors.end?.message}>
          <Input
            id="end"
            type="datetime-local"
            aria-invalid={errors.end ? true : undefined}
            aria-describedby={errors.end ? 'end-error' : undefined}
            {...register('end', { onChange: () => create.reset() })}
          />
        </Field>
      </div>

      {create.isError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{errorMessage(create.error)}</p>
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
            'Add entry'
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

/** An hour ending now, which is the common case when logging time you just spent. */
function defaults(): FormValues {
  const end = new Date()
  const start = new Date(end.getTime() - 60 * 60 * 1000)
  return { comment: '', start: toDateTimeInput(start), end: toDateTimeInput(end) }
}

function errorMessage(error: Error): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return "This task doesn't exist any more."
    if (error.status === 400) return `The entry wasn't accepted. ${error.message}`
    if (error.status === 429 || error.status === 0) return error.message
  }
  return "Couldn't save the time entry. Please try again."
}
