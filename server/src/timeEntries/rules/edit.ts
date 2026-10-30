import { parseInstant } from './instant.ts'
import type { EntryDraft, Issue } from './types.ts'

/** Whether saving the draft would change nothing. Times are compared as instants, so `Z` and `+00:00` are equal. */
export function isUnchanged(original: EntryDraft, draft: EntryDraft): boolean {
  const sameInstant = (a: string, b: string) => {
    const first = parseInstant(a)
    return first !== undefined && first === parseInstant(b)
  }
  return (
    original.comment.trim() === draft.comment.trim() &&
    sameInstant(original.start, draft.start) &&
    sameInstant(original.end, draft.end)
  )
}

/**
 * Drops the warnings the original entry already had, so editing one thing on an old entry
 * doesn't nag about the rest. An overlap stays when it involves an entry the original didn't overlap.
 */
export function withoutKnownWarnings<Warning extends Issue>(
  warnings: Warning[],
  originalWarnings: Issue[],
): Warning[] {
  return warnings.filter((warning) => {
    const known = originalWarnings.find((o) => o.code === warning.code)
    if (!known) return true
    if (warning.code !== 'overlap') return false
    const knownIds = new Set(known.entries?.map((e) => e.id))
    return warning.entries?.some((e) => !knownIds.has(e.id)) ?? false
  })
}
