import type { EntryDraft, EntryRef } from '../../../src/timeEntries/rules/index.ts'

/** The clock every test uses. */
export const NOW = new Date('2026-06-15T12:00:00.000Z')

export const HOUR = 3_600_000
export const DAY = 24 * HOUR

/** An ISO time `ms` from `NOW` (negative is earlier). */
export const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString()

/** A valid one-hour entry that ended an hour ago. */
export function draft(overrides: Partial<EntryDraft> = {}): EntryDraft {
  return { comment: 'Work', start: at(-2 * HOUR), end: at(-HOUR), ...overrides }
}

export function ref(id: number, startMs: number, endMs: number, taskId = 1): EntryRef {
  return { id, taskId, start: at(startMs), end: at(endMs) }
}
