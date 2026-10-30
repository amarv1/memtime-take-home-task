/** The fields of an entry the user sets. `start` and `end` are ISO 8601 with a zone. */
export interface EntryDraft {
  comment: string
  start: string
  end: string
}

/** Another saved entry, as far as the rules need to know it. */
export interface EntryRef {
  id: number
  taskId: number
  start: string
  end: string
}

export interface RuleContext {
  /** Always given by the caller, so rules never read the clock. */
  now: Date
  /** All of the user's other entries, on any task. Without it the overlap check is skipped. */
  otherEntries?: EntryRef[]
  /** Without it the completed-task check is skipped. */
  taskStatus?: string
  /** Set when editing: the entry as it was saved. */
  original?: EntryDraft & { id: number }
}

export type ErrorCode =
  | 'comment_required'
  | 'comment_too_long'
  | 'invalid_start'
  | 'invalid_end'
  | 'end_not_after_start'
  | 'too_long'
  | 'in_future'
  | 'too_early'

export type WarningCode = 'overlap' | 'long_duration' | 'old_start' | 'completed_task'

export type IssueField = 'comment' | 'start' | 'end' | 'task'

export interface Issue<Code extends string = ErrorCode | WarningCode> {
  code: Code
  field: IssueField
  /** Plain, timezone-neutral text for the user. */
  message: string
  /** The entries an `overlap` warning is about. */
  entries?: EntryRef[]
}
