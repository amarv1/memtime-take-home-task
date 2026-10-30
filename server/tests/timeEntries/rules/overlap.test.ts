import { findOverlaps } from '../../../src/timeEntries/rules/index.ts'
import { draft, HOUR, ref } from './support.ts'

// The draft is [-2h, -1h).
const d = draft()

describe('findOverlaps', () => {
  it('finds partial, containing and contained overlaps', () => {
    const others = [
      ref(1, -3 * HOUR, -1.5 * HOUR),
      ref(2, -1.5 * HOUR, 0),
      ref(3, -3 * HOUR, 0),
      ref(4, -1.8 * HOUR, -1.2 * HOUR),
    ]
    expect(findOverlaps(d, others).map((e) => e.id)).toEqual([1, 2, 3, 4])
  })

  it('treats an exact duplicate as an overlap', () => {
    expect(findOverlaps(d, [ref(1, -2 * HOUR, -HOUR)])).toHaveLength(1)
  })

  it('does not count entries that only touch', () => {
    const others = [ref(1, -3 * HOUR, -2 * HOUR), ref(2, -HOUR, 0)]
    expect(findOverlaps(d, others)).toEqual([])
  })

  it('counts an overlap of 1 ms', () => {
    expect(findOverlaps(d, [ref(1, -3 * HOUR, -2 * HOUR + 1)])).toHaveLength(1)
  })

  it('looks at entries of every task', () => {
    const others = [ref(1, -2 * HOUR, -HOUR, 1), ref(2, -2 * HOUR, -HOUR, 2)]
    expect(findOverlaps(d, others).map((e) => e.taskId)).toEqual([1, 2])
  })

  it('excludes the entry being edited, including id 0', () => {
    const others = [ref(0, -2 * HOUR, -HOUR), ref(1, -2 * HOUR, -HOUR)]
    expect(findOverlaps(d, others, 0).map((e) => e.id)).toEqual([1])
  })

  it('finds nothing for an unreadable draft or unreadable entries', () => {
    const bad = { id: 9, taskId: 1, start: 'x', end: 'y' }
    expect(findOverlaps({ start: 'x', end: 'y' }, [ref(1, -3 * HOUR, 0)])).toEqual([])
    expect(findOverlaps(d, [bad])).toEqual([])
  })
})
