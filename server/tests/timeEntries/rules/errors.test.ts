import { findErrors, MAX_COMMENT_LENGTH } from '../../../src/timeEntries/rules/index.ts'
import { at, draft, HOUR, NOW } from './support.ts'

const codes = (d = draft()) => findErrors(d, NOW).map((issue) => issue.code)

describe('findErrors', () => {
  it('finds nothing in a valid entry', () => {
    expect(codes()).toEqual([])
  })

  describe('comment', () => {
    it.each(['', '   ', '\n\t'])('requires a comment (%j)', (comment) => {
      expect(codes(draft({ comment }))).toEqual(['comment_required'])
    })

    it('allows exactly the maximum length and rejects one more', () => {
      expect(codes(draft({ comment: 'x'.repeat(MAX_COMMENT_LENGTH) }))).toEqual([])
      expect(codes(draft({ comment: 'x'.repeat(MAX_COMMENT_LENGTH + 1) }))).toEqual([
        'comment_too_long',
      ])
    })

    it('counts the trimmed comment', () => {
      expect(codes(draft({ comment: `  ${'x'.repeat(MAX_COMMENT_LENGTH)}  ` }))).toEqual(
        [],
      )
    })

    it('says the limit in the message', () => {
      const [issue] = findErrors(draft({ comment: 'x'.repeat(501) }), NOW)
      expect(issue).toMatchObject({ field: 'comment' })
      expect(issue?.message).toContain('500')
    })
  })

  describe('dates', () => {
    it('rejects an unreadable start and end, and checks nothing else about them', () => {
      expect(codes(draft({ start: 'soon', end: 'later' }))).toEqual([
        'invalid_start',
        'invalid_end',
      ])
    })

    it('rejects an end before the start, or equal to it', () => {
      expect(codes(draft({ start: at(-HOUR), end: at(-2 * HOUR) }))).toEqual([
        'end_not_after_start',
      ])
      expect(codes(draft({ start: at(-HOUR), end: at(-HOUR) }))).toEqual([
        'end_not_after_start',
      ])
    })

    it('compares instants, not text', () => {
      const start = '2026-06-15T10:00:00+02:00' // 08:00Z
      expect(codes(draft({ start, end: '2026-06-15T09:00:00Z' }))).toEqual([])
    })

    it('allows exactly 24 hours and rejects 1 ms more', () => {
      const start = at(-30 * HOUR)
      expect(codes(draft({ start, end: at(-6 * HOUR) }))).toEqual([])
      expect(codes(draft({ start, end: at(-6 * HOUR + 1) }))).toEqual(['too_long'])
    })

    it('allows an end up to 5 minutes ahead and rejects 1 ms more', () => {
      const end = 5 * 60_000
      expect(codes(draft({ start: at(-HOUR), end: at(end) }))).toEqual([])
      expect(codes(draft({ start: at(-HOUR), end: at(end + 1) }))).toEqual(['in_future'])
    })

    it('allows a start at the year 2000 and rejects 1 ms before', () => {
      const earliest = Date.parse('2000-01-01T00:00:00Z')
      const end = new Date(earliest + HOUR).toISOString()
      expect(codes(draft({ start: new Date(earliest).toISOString(), end }))).toEqual([])
      expect(codes(draft({ start: new Date(earliest - 1).toISOString(), end }))).toEqual([
        'too_early',
      ])
    })

    it('reports every problem of an entry, with its field', () => {
      const issues = findErrors(
        { comment: '', start: '1999-01-01T00:00:00Z', end: at(HOUR) },
        NOW,
      )
      expect(issues.map((i) => [i.code, i.field])).toEqual([
        ['comment_required', 'comment'],
        ['too_long', 'end'],
        ['in_future', 'end'],
        ['too_early', 'start'],
      ])
    })
  })
})
