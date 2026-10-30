import { findWarnings } from '../../../src/timeEntries/rules/index.ts'
import { at, DAY, draft, HOUR, NOW, ref } from './support.ts'

const codes = (d = draft(), context = {}) =>
  findWarnings(d, { now: NOW, ...context }).map((w) => w.code)

describe('findWarnings', () => {
  it('finds nothing in an ordinary entry', () => {
    expect(codes(draft(), { otherEntries: [], taskStatus: 'active' })).toEqual([])
  })

  describe('long_duration', () => {
    it('allows exactly 12 hours and warns past it', () => {
      const start = at(-20 * HOUR)
      expect(codes(draft({ start, end: at(-8 * HOUR) }))).toEqual([])
      expect(codes(draft({ start, end: at(-8 * HOUR + 1) }))).toEqual(['long_duration'])
    })

    it('still warns at exactly 24 hours, but leaves longer ones to the errors', () => {
      const start = at(-30 * HOUR)
      expect(codes(draft({ start, end: at(-6 * HOUR) }))).toContain('long_duration')
      expect(codes(draft({ start, end: at(-6 * HOUR + 1) }))).not.toContain(
        'long_duration',
      )
    })
  })

  describe('old_start', () => {
    it('allows a start exactly 30 days back and warns 1 ms earlier', () => {
      const end = at(-30 * DAY + HOUR)
      expect(codes(draft({ start: at(-30 * DAY), end }))).toEqual([])
      expect(codes(draft({ start: at(-30 * DAY - 1), end }))).toEqual(['old_start'])
    })
  })

  describe('completed_task', () => {
    it('warns for a completed task only', () => {
      expect(codes(draft(), { taskStatus: 'completed' })).toEqual(['completed_task'])
      expect(codes(draft(), { taskStatus: 'active' })).toEqual([])
    })
  })

  describe('overlap', () => {
    it('lists the overlapping entries', () => {
      const clash = ref(5, -2 * HOUR, -HOUR, 9)
      const [warning] = findWarnings(draft(), {
        now: NOW,
        otherEntries: [clash, ref(6, -10 * HOUR, -9 * HOUR)],
      })
      expect(warning).toMatchObject({ code: 'overlap', entries: [clash] })
      expect(warning?.message).toBe('Overlaps another of your entries')
    })

    it('counts them in the message', () => {
      const [warning] = findWarnings(draft(), {
        now: NOW,
        otherEntries: [ref(1, -2 * HOUR, -HOUR), ref(2, -2 * HOUR, -HOUR)],
      })
      expect(warning?.message).toBe('Overlaps 2 of your other entries')
    })

    it('skips the entry being edited', () => {
      const original = { id: 1, ...draft() }
      expect(
        codes(draft(), { otherEntries: [ref(1, -2 * HOUR, -HOUR)], original }),
      ).toEqual([])
    })
  })

  it('skips checks whose context is missing', () => {
    expect(codes(draft({ start: at(-60 * DAY), end: at(-60 * DAY + HOUR) }))).toEqual([
      'old_start',
    ])
  })

  it('has no warnings for unreadable times', () => {
    expect(codes(draft({ start: 'x' }), { taskStatus: 'completed' })).toEqual([])
  })
})
