import { parseISO } from 'date-fns'
import { z } from 'zod'
import type { NewEntry, TimeEntry } from './api'
import { toDateTimeInput } from './format'

/** Only for a quick answer; the server enforces the full rules (limits, overlaps, warnings). */
const MAX_COMMENT_LENGTH = 500

export interface FormValues {
  comment: string
  start: string
  end: string
}

/** An hour ending now, which is the common case when logging time you just spent. */
export function defaultValues(): FormValues {
  const end = new Date()
  const start = new Date(end.getTime() - 60 * 60 * 1000)
  return { comment: '', start: toDateTimeInput(start), end: toDateTimeInput(end) }
}

export function valuesOf(entry: TimeEntry): FormValues {
  return {
    comment: entry.comment,
    start: toDateTimeInput(parseISO(entry.start)),
    end: toDateTimeInput(parseISO(entry.end)),
  }
}

/** The inputs hold local time without a zone; this makes it an exact instant. */
const toInstant = (local: string) => new Date(local).toISOString()

/**
 * The entry the form describes, as the API takes it. An input that still holds its
 * starting value keeps the entry's own time: `datetime-local` drops seconds, and
 * rounding them away would change an entry the user never touched.
 */
export function toDraft(values: FormValues, entry?: TimeEntry): NewEntry {
  const initial = entry ? valuesOf(entry) : undefined
  return {
    comment: values.comment.trim(),
    start:
      entry && values.start === initial?.start ? entry.start : toInstant(values.start),
    end: entry && values.end === initial?.end ? entry.end : toInstant(values.end),
  }
}

/** Whether saving would change nothing. Times are compared as instants. */
export function isUnchanged(entry: TimeEntry, draft: NewEntry): boolean {
  return (
    entry.comment.trim() === draft.comment &&
    Date.parse(entry.start) === Date.parse(draft.start) &&
    Date.parse(entry.end) === Date.parse(draft.end)
  )
}

/** Light checks that need no other data. The server is the authority on everything else. */
export function buildSchema(entry?: TimeEntry) {
  return z
    .object({
      comment: z
        .string()
        .trim()
        .min(1, 'Enter a comment')
        .max(
          MAX_COMMENT_LENGTH,
          `Keep the comment to ${MAX_COMMENT_LENGTH} characters or fewer`,
        ),
      start: z.string().min(1, 'Enter a start time'),
      end: z.string().min(1, 'Enter an end time'),
    })
    .refine(
      (values) =>
        !values.start ||
        !values.end ||
        Date.parse(toDraft(values, entry).end) > Date.parse(toDraft(values, entry).start),
      { path: ['end'], message: 'End must be after the start' },
    )
}
