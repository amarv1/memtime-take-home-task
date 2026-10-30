/**
 * The rules a time entry must follow, enforced by the server. Errors block a save;
 * warnings need the user's confirmation. Nothing here reads the clock or does I/O.
 *
 * - `limits.ts`: every threshold, as a named constant
 * - `types.ts`: drafts, context and issues
 * - `instant.ts`: strict date-time parsing
 * - `errors.ts`: `findErrors`
 * - `warnings.ts`: `findWarnings`
 * - `overlap.ts`: `findOverlaps`
 * - `edit.ts`: `isUnchanged`, `withoutKnownWarnings`
 * - `checkEntry.ts`: `checkEntry`, `unacceptedWarnings`
 */
export * from './limits.ts'
export type * from './types.ts'
export { parseInstant } from './instant.ts'
export { findErrors } from './errors.ts'
export { findWarnings } from './warnings.ts'
export { findOverlaps } from './overlap.ts'
export { isUnchanged, withoutKnownWarnings } from './edit.ts'
export { checkEntry, unacceptedWarnings } from './checkEntry.ts'
export type { CheckResult } from './checkEntry.ts'
