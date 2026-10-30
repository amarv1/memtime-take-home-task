import { parseInstant } from './instant.ts'
import { LONG_DURATION_MS, MAX_DURATION_MS, OLD_START_MS } from './limits.ts'
import { findOverlaps } from './overlap.ts'
import type { EntryDraft, Issue, RuleContext, WarningCode } from './types.ts'

type Warning = Issue<WarningCode>

function overlapWarning({ otherEntries, original }: RuleContext, draft: EntryDraft) {
  if (!otherEntries) return undefined
  const entries = findOverlaps(draft, otherEntries, original?.id)
  if (entries.length === 0) return undefined
  return {
    code: 'overlap',
    field: 'start',
    message:
      entries.length === 1
        ? 'Overlaps another of your entries'
        : `Overlaps ${entries.length} of your other entries`,
    entries,
  } satisfies Warning
}

/**
 * Things worth a second look but allowed once the user confirms. A check whose
 * input is missing from the context is skipped, and a draft with unreadable times has none.
 * This does not apply the edit rule; see `checkEntry`.
 */
export function findWarnings(draft: EntryDraft, context: RuleContext): Warning[] {
  const start = parseInstant(draft.start)
  const end = parseInstant(draft.end)
  if (start === undefined || end === undefined) return []

  const warnings: Warning[] = []
  const overlap = overlapWarning(context, draft)
  if (overlap) warnings.push(overlap)

  const duration = end - start
  if (duration > LONG_DURATION_MS && duration <= MAX_DURATION_MS)
    warnings.push({
      code: 'long_duration',
      field: 'end',
      message: 'This entry is longer than 12 hours',
    })
  if (context.now.getTime() - start > OLD_START_MS)
    warnings.push({
      code: 'old_start',
      field: 'start',
      message: 'This entry starts more than 30 days ago',
    })
  if (context.taskStatus === 'completed')
    warnings.push({
      code: 'completed_task',
      field: 'task',
      message: 'This task is completed',
    })
  return warnings
}
