import { parseInstant } from './instant.ts'
import type { EntryDraft, EntryRef } from './types.ts'

/**
 * The entries that share time with the draft, on any task. Intervals are half-open,
 * so an entry that ends exactly when another starts doesn't overlap it.
 * `excludeId` is the entry being edited, which must not overlap itself.
 */
export function findOverlaps(
  draft: Pick<EntryDraft, 'start' | 'end'>,
  otherEntries: EntryRef[],
  excludeId?: number,
): EntryRef[] {
  const start = parseInstant(draft.start)
  const end = parseInstant(draft.end)
  if (start === undefined || end === undefined) return []

  return otherEntries.filter((other) => {
    if (other.id === excludeId) return false
    const otherStart = parseInstant(other.start)
    const otherEnd = parseInstant(other.end)
    if (otherStart === undefined || otherEnd === undefined) return false
    return otherStart < end && start < otherEnd
  })
}
