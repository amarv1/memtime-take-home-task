import {
  isUnchanged,
  withoutKnownWarnings,
} from '../../../src/timeEntries/rules/index.ts'
import type { Issue } from '../../../src/timeEntries/rules/index.ts'
import { HOUR, ref } from './support.ts'

describe('isUnchanged', () => {
  const original = {
    comment: 'Work',
    start: '2026-06-15T09:00:30.123Z',
    end: '2026-06-15T10:00:00.000Z',
  }

  it('is true for the same values', () => {
    expect(isUnchanged(original, { ...original })).toBe(true)
  })

  it('compares times as instants and ignores comment padding', () => {
    expect(
      isUnchanged(original, {
        comment: ' Work ',
        start: '2026-06-15T11:00:30.123+02:00',
        end: '2026-06-15T10:00:00Z',
      }),
    ).toBe(true)
  })

  it.each([
    ['comment', { comment: 'Other' }],
    ['start', { start: '2026-06-15T09:00:00Z' }],
    ['end', { end: '2026-06-15T10:00:00.001Z' }],
  ])('is false when the %s differs', (_name, change) => {
    expect(isUnchanged(original, { ...original, ...change })).toBe(false)
  })

  it('is false for an unreadable time', () => {
    expect(isUnchanged({ ...original, start: 'x' }, { ...original, start: 'x' })).toBe(
      false,
    )
  })
})

describe('withoutKnownWarnings', () => {
  const warning = (code: Issue['code'], entries?: Issue['entries']): Issue => ({
    code,
    field: 'start',
    message: code,
    entries,
  })

  it('drops warnings with a code the original had, keeps the others', () => {
    const result = withoutKnownWarnings(
      [warning('old_start'), warning('long_duration')],
      [warning('old_start')],
    )
    expect(result.map((w) => w.code)).toEqual(['long_duration'])
  })

  it('keeps everything when the original had no warnings', () => {
    expect(withoutKnownWarnings([warning('old_start')], [])).toHaveLength(1)
  })

  it('drops an overlap with only entries the original overlapped', () => {
    const a = ref(1, 0, HOUR)
    const b = ref(2, 0, HOUR)
    expect(
      withoutKnownWarnings([warning('overlap', [a])], [warning('overlap', [a, b])]),
    ).toEqual([])
  })

  it('keeps an overlap that has a new entry', () => {
    const a = ref(1, 0, HOUR)
    const b = ref(2, 0, HOUR)
    const result = withoutKnownWarnings(
      [warning('overlap', [a, b])],
      [warning('overlap', [a])],
    )
    expect(result).toHaveLength(1)
  })
})
