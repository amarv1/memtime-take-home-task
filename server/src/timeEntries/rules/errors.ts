import {
  EARLIEST_START,
  FUTURE_TOLERANCE_MS,
  MAX_COMMENT_LENGTH,
  MAX_DURATION_MS,
} from './limits.ts'
import { parseInstant } from './instant.ts'
import type { EntryDraft, Issue } from './types.ts'

function commentError(comment: string): Issue | undefined {
  const length = comment.trim().length
  if (length === 0)
    return { code: 'comment_required', field: 'comment', message: 'Enter a comment' }
  if (length > MAX_COMMENT_LENGTH)
    return {
      code: 'comment_too_long',
      field: 'comment',
      message: `Keep the comment to ${MAX_COMMENT_LENGTH} characters or fewer`,
    }
  return undefined
}

function timeErrors(start: number, end: number, now: Date): Issue[] {
  const issues: Issue[] = []
  if (end <= start)
    issues.push({
      code: 'end_not_after_start',
      field: 'end',
      message: 'End must be after the start',
    })
  else if (end - start > MAX_DURATION_MS)
    issues.push({
      code: 'too_long',
      field: 'end',
      message: "An entry can't be longer than 24 hours",
    })
  if (end > now.getTime() + FUTURE_TOLERANCE_MS)
    issues.push({
      code: 'in_future',
      field: 'end',
      message: "End can't be in the future",
    })
  if (start < EARLIEST_START)
    issues.push({
      code: 'too_early',
      field: 'start',
      message: "Start can't be before the year 2000",
    })
  return issues
}

/** Everything that makes the draft impossible to save, in field order. Empty means it can be saved (maybe after warnings). */
export function findErrors(draft: EntryDraft, now: Date): Issue[] {
  const issues: Issue[] = []
  const comment = commentError(draft.comment)
  if (comment) issues.push(comment)

  const start = parseInstant(draft.start)
  const end = parseInstant(draft.end)
  if (start === undefined)
    issues.push({
      code: 'invalid_start',
      field: 'start',
      message: 'Enter a valid start time',
    })
  if (end === undefined)
    issues.push({ code: 'invalid_end', field: 'end', message: 'Enter a valid end time' })
  if (start !== undefined && end !== undefined)
    issues.push(...timeErrors(start, end, now))
  return issues
}
