import { parseISO } from 'date-fns'
import { z } from 'zod'
import type { NewEntry, TimeEntry } from './api'
import { toDateTimeInput } from './format'
import { MAX_COMMENT_LENGTH, timeErrors, type Times } from './rules'

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

/** The draft's times as exact instants, or undefined while a time is missing or unreadable. */
export function draftTimes(values: FormValues, entry?: TimeEntry): Times | undefined {
  if (!values.start || !values.end) return undefined
  try {
    const draft = toDraft(values, entry)
    return { start: Date.parse(draft.start), end: Date.parse(draft.end) }
  } catch {
    // An unreadable local time can't become an instant.
    return undefined
  }
}

/** The checks that need no other data, run on every change. The server is the authority on everything else. */
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
    .superRefine((values, ctx) => {
      if (!values.start || !values.end) return
      const times = draftTimes(values, entry)
      if (!times) {
        ctx.addIssue({ code: 'custom', path: ['end'], message: 'Enter a valid time' })
        return
      }
      for (const issue of timeErrors(times, Date.now()))
        ctx.addIssue({ code: 'custom', path: [issue.field], message: issue.message })
    })
}
