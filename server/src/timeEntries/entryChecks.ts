import { HttpError } from '../middleware/errorHandler.ts'
import {
  checkEntry,
  findErrors,
  unacceptedWarnings,
  type EntryDraft,
  type EntryRef,
  type Issue,
} from './rules/index.ts'
import type { TaskLookup } from './taskLookup.ts'
import type { TimeEntry, TimeEntryService } from './timeEntryService.ts'

/** What the client sent for an entry: the fields to save and the warnings it has confirmed. */
export interface EntryInput extends EntryDraft {
  acceptedWarnings: string[]
}

interface Options {
  service: TimeEntryService
  taskLookup: TaskLookup
  now?: () => Date
}

/** Only these fields leave the server in a warning: an entry also holds the API key (`userId`). */
const toRef = ({ id, taskId, start, end }: TimeEntry): EntryRef => ({
  id,
  taskId,
  start,
  end,
})

/** The values to send to Memtime: trimmed comment and exact UTC instants. */
export function toUpstream({ comment, start, end }: EntryDraft): EntryDraft {
  return {
    comment: comment.trim(),
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
  }
}

function rejectErrors(errors: Issue[]) {
  const [first] = errors
  if (first)
    throw new HttpError(400, first.message, undefined, {
      field: first.field,
      code: first.code,
    })
}

function rejectUnconfirmed(warnings: Issue[], accepted: string[]) {
  const pending = unacceptedWarnings(warnings, accepted)
  if (pending.length > 0)
    throw new HttpError(409, 'Please confirm this time entry', undefined, {
      warnings: pending,
    })
}

/**
 * Applies the shared time-entry rules to a request: a 400 for the first error, a 409 listing
 * the warnings the client hasn't accepted yet. Errors are checked before anything is loaded.
 */
export function createEntryChecks({
  service,
  taskLookup,
  now = () => new Date(),
}: Options) {
  return {
    async beforeCreate(apiKey: string, taskId: number, input: EntryInput) {
      const at = now()
      rejectErrors(findErrors(input, at))

      const [entries, taskStatus] = await Promise.all([
        service.getAllEntries(apiKey),
        taskLookup.getStatus(apiKey, taskId),
      ])
      const { warnings } = checkEntry(input, {
        now: at,
        otherEntries: entries.map(toRef),
        taskStatus,
      })
      rejectUnconfirmed(warnings, input.acceptedWarnings)
    },

    /** `entries` are all of the user's entries, already loaded; `original` is the one being edited. */
    beforeUpdate(entries: TimeEntry[], original: TimeEntry, input: EntryInput) {
      const at = now()
      rejectErrors(findErrors(input, at))

      const { warnings } = checkEntry(input, {
        now: at,
        otherEntries: entries.map(toRef),
        original,
      })
      rejectUnconfirmed(warnings, input.acceptedWarnings)
    },
  }
}

export type EntryChecks = ReturnType<typeof createEntryChecks>
