import { findWarnings, timeErrors } from '@/features/timeEntries/rules'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const now = Date.parse('2026-06-15T12:00:00Z')
const ago = (ms: number) => now - ms

describe('timeErrors', () => {
  it('accepts an hour that ended now', () => {
    expect(timeErrors({ start: ago(HOUR), end: now }, now)).toEqual([])
  })

  it('allows an end a few minutes ahead, for a fast clock', () => {
    expect(timeErrors({ start: ago(HOUR), end: now + 5 * 60_000 }, now)).toEqual([])
    expect(timeErrors({ start: ago(HOUR), end: now + 6 * 60_000 }, now)).toEqual([
      { field: 'end', message: "End can't be in the future" },
    ])
  })

  it('rejects an end that is not after the start', () => {
    expect(timeErrors({ start: ago(HOUR), end: ago(HOUR) }, now)).toEqual([
      { field: 'end', message: 'End must be after the start' },
    ])
  })

  it('allows exactly 24 hours but not more', () => {
    expect(timeErrors({ start: ago(DAY), end: now }, now)).toEqual([])
    expect(timeErrors({ start: ago(DAY + 1), end: now }, now)).toEqual([
      { field: 'end', message: "An entry can't be longer than 24 hours" },
    ])
  })

  it('rejects a start before 2000', () => {
    const start = Date.parse('1999-12-31T23:00:00Z')
    expect(timeErrors({ start, end: start + HOUR }, now)).toEqual([
      { field: 'start', message: "Start can't be before the year 2000" },
    ])
  })
})

describe('findWarnings', () => {
  const codes = (...args: Parameters<typeof findWarnings>) =>
    findWarnings(...args).map((warning) => warning.code)

  it('warns about entries over 12 hours', () => {
    expect(codes({ start: ago(12 * HOUR), end: now }, { now })).toEqual([])
    expect(codes({ start: ago(12 * HOUR + 1), end: now }, { now })).toEqual([
      'long_duration',
    ])
  })

  it('warns about a start more than 30 days ago', () => {
    const start = ago(31 * DAY)
    expect(codes({ start, end: start + HOUR }, { now })).toEqual(['old_start'])
  })

  it('warns about a completed task', () => {
    expect(
      codes({ start: ago(HOUR), end: now }, { now, taskStatus: 'completed' }),
    ).toEqual(['completed_task'])
  })

  it('has none while the times have an error', () => {
    const start = ago(40 * DAY)
    expect(codes({ start, end: start }, { now, taskStatus: 'completed' })).toEqual([])
  })

  it('leaves out what the original entry already had', () => {
    const start = ago(40 * DAY)
    const original = { start, end: start + HOUR }
    expect(codes({ start, end: start + 13 * HOUR }, { now, original })).toEqual([
      'long_duration',
    ])
  })
})
