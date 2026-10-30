/**
 * The time-entry checks the form can run without asking the server, so the user sees them
 * while typing and no request is spent on them. They copy the server's rules
 * (`server/src/timeEntries/rules`), which stay the authority: limits and messages must match
 * `limits.ts` there. Overlaps need all of the user's entries, so only the server checks them.
 */
import type { Warning } from '@/lib/api'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export const MAX_COMMENT_LENGTH = 500
const MAX_DURATION_MS = 24 * HOUR_MS
const LONG_DURATION_MS = 12 * HOUR_MS
const OLD_START_MS = 30 * DAY_MS
const FUTURE_TOLERANCE_MS = 5 * MINUTE_MS
const EARLIEST_START = Date.parse('2000-01-01T00:00:00Z')

export type RuleField = 'comment' | 'start' | 'end' | 'task'

export interface FieldIssue {
  field: RuleField
  message: string
}

export interface FormWarning extends Warning {
  field: RuleField
}

/** Exact instants as milliseconds. */
export interface Times {
  start: number
  end: number
}

/** What makes the times impossible to save. */
export function timeErrors({ start, end }: Times, now: number): FieldIssue[] {
  const issues: FieldIssue[] = []
  if (end <= start) issues.push({ field: 'end', message: 'End must be after the start' })
  else if (end - start > MAX_DURATION_MS)
    issues.push({ field: 'end', message: "An entry can't be longer than 24 hours" })
  if (end > now + FUTURE_TOLERANCE_MS)
    issues.push({ field: 'end', message: "End can't be in the future" })
  if (start < EARLIEST_START)
    issues.push({ field: 'start', message: "Start can't be before the year 2000" })
  return issues
}

interface WarningContext {
  now: number
  /** Only checked on create, like the server does. */
  taskStatus?: string
  /** Set when editing: warnings this entry already had are not raised again. */
  original?: Times
}

function warningsOf(times: Times, now: number, taskStatus?: string): FormWarning[] {
  const warnings: FormWarning[] = []
  const duration = times.end - times.start
  if (duration > LONG_DURATION_MS && duration <= MAX_DURATION_MS)
    warnings.push({
      code: 'long_duration',
      field: 'end',
      message: 'This entry is longer than 12 hours',
    })
  if (now - times.start > OLD_START_MS)
    warnings.push({
      code: 'old_start',
      field: 'start',
      message: 'This entry starts more than 30 days ago',
    })
  if (taskStatus === 'completed')
    warnings.push({
      code: 'completed_task',
      field: 'task',
      message: 'This task is completed',
    })
  return warnings
}

/** Things worth a second look; none while the times have an error. */
export function findWarnings(times: Times, context: WarningContext): FormWarning[] {
  if (timeErrors(times, context.now).length > 0) return []
  const warnings = warningsOf(times, context.now, context.taskStatus)
  const { original } = context
  if (!original) return warnings
  const known = new Set(warningsOf(original, context.now).map((w) => w.code))
  return warnings.filter((w) => !known.has(w.code))
}
