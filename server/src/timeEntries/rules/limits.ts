const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** Longest comment, after trimming. */
export const MAX_COMMENT_LENGTH = 500

/** Longest entry; a longer one is almost certainly a mistake, so it is an error. */
export const MAX_DURATION_MS = 24 * HOUR_MS

/** Longer than this (up to the maximum) needs the user's confirmation. */
export const LONG_DURATION_MS = 12 * HOUR_MS

/** An entry starting further back than this needs the user's confirmation. */
export const OLD_START_MS = 30 * DAY_MS

/** How far past `now` an end may be, so a slightly fast clock doesn't block a save. */
export const FUTURE_TOLERANCE_MS = 5 * MINUTE_MS

/** Earlier starts are treated as typos (such as a wrong year). */
export const EARLIEST_START = Date.parse('2000-01-01T00:00:00Z')
