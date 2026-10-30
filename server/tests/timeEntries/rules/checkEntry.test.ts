import { checkEntry, unacceptedWarnings } from '../../../src/timeEntries/rules/index.ts'
import { at, DAY, draft, HOUR, NOW, ref } from './support.ts'

describe('checkEntry', () => {
  it('returns errors and no warnings for an invalid draft', () => {
    const result = checkEntry(draft({ comment: '' }), {
      now: NOW,
      taskStatus: 'completed',
    })
    expect(result.errors.map((e) => e.code)).toEqual(['comment_required'])
    expect(result.warnings).toEqual([])
  })

  it('returns warnings for a valid draft', () => {
    const result = checkEntry(draft(), { now: NOW, taskStatus: 'completed' })
    expect(result.errors).toEqual([])
    expect(result.warnings.map((w) => w.code)).toEqual(['completed_task'])
  })

  describe('editing', () => {
    const old = {
      id: 1,
      comment: 'Old work',
      start: at(-60 * DAY),
      end: at(-60 * DAY + HOUR),
    }

    it('does not repeat a warning the original already had', () => {
      const result = checkEntry(
        { ...old, comment: 'Better words' },
        { now: NOW, original: old },
      )
      expect(result.warnings).toEqual([])
    })

    it('warns about a problem the original did not have', () => {
      const result = checkEntry(
        { ...old, end: at(-60 * DAY + 13 * HOUR) },
        { now: NOW, original: old },
      )
      expect(result.warnings.map((w) => w.code)).toEqual(['long_duration'])
    })

    it('does not count the entry itself as an overlap', () => {
      const result = checkEntry(
        { ...old, comment: 'x' },
        { now: NOW, original: old, otherEntries: [{ ...old, taskId: 1 }] },
      )
      expect(result.warnings).toEqual([])
    })

    it('keeps an old overlap quiet but not a new one', () => {
      const other = ref(2, -60 * DAY, -60 * DAY + HOUR)
      const context = { now: NOW, original: old, otherEntries: [other] }
      expect(checkEntry({ ...old, comment: 'x' }, context).warnings).toEqual([])

      // Moving the entry makes it overlap another one it didn't overlap before.
      const fresh = ref(3, -59 * DAY, -59 * DAY + HOUR)
      const moved = { ...old, start: at(-59 * DAY), end: at(-59 * DAY + HOUR) }
      const result = checkEntry(moved, { ...context, otherEntries: [other, fresh] })
      expect(result.warnings.map((w) => w.code)).toEqual(['overlap'])
    })
  })
})

describe('unacceptedWarnings', () => {
  const warnings = checkEntry(draft(), {
    now: NOW,
    taskStatus: 'completed',
    otherEntries: [ref(1, -2 * HOUR, -HOUR)],
  }).warnings

  it('returns all when nothing is accepted', () => {
    expect(unacceptedWarnings(warnings, [])).toHaveLength(2)
  })

  it('returns the ones not accepted', () => {
    expect(unacceptedWarnings(warnings, ['overlap']).map((w) => w.code)).toEqual([
      'completed_task',
    ])
  })

  it('returns none when all are accepted, and ignores unknown codes', () => {
    expect(unacceptedWarnings(warnings, ['overlap', 'completed_task', 'nope'])).toEqual(
      [],
    )
  })
})
