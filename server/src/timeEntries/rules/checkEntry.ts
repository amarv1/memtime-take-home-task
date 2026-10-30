import { withoutKnownWarnings } from './edit.ts'
import { findErrors } from './errors.ts'
import type { EntryDraft, Issue, RuleContext, WarningCode } from './types.ts'
import { findWarnings } from './warnings.ts'

export interface CheckResult {
  errors: Issue[]
  /** Empty while there are errors: nothing can be confirmed until those are fixed. */
  warnings: Issue<WarningCode>[]
}

/** Runs every rule. With `context.original` set (an edit), warnings the original already had are left out. */
export function checkEntry(draft: EntryDraft, context: RuleContext): CheckResult {
  const errors = findErrors(draft, context.now)
  if (errors.length > 0) return { errors, warnings: [] }

  const warnings = findWarnings(draft, context)
  const { original } = context
  return {
    errors,
    warnings: original
      ? withoutKnownWarnings(warnings, findWarnings(original, context))
      : warnings,
  }
}

/** The warnings whose code the user hasn't accepted yet. */
export function unacceptedWarnings<Warning extends Issue>(
  warnings: Warning[],
  accepted: readonly string[],
): Warning[] {
  return warnings.filter((warning) => !accepted.includes(warning.code))
}
