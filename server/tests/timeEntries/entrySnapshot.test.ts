import {
  addReloadPage,
  applyChanges,
  applyDeleted,
  applySaved,
  countMatches,
  emptySnapshot,
  markStale,
  merge,
  startReload,
  type Snapshot,
} from '../../src/timeEntries/entrySnapshot.ts'
import { buildEntry } from './support.ts'

const at = (minute: number) => new Date(Date.UTC(2025, 0, 2, 9, minute)).toISOString()
const entry = (id: number, minute = 0, comment = `Entry ${id}`) =>
  buildEntry(id, 5, { updatedAt: at(minute), comment })
const ids = (entries: { id: number }[] | null | undefined) => entries?.map((e) => e.id)

const served = (entries = [entry(1), entry(2), entry(3)]): Snapshot => ({
  ...emptySnapshot,
  entries,
  highWater: at(0),
  checkedAt: 1,
})

describe('merge', () => {
  it('keeps whichever version was updated last, sorted by id', () => {
    const result = merge(
      [entry(3, 5, 'new'), entry(1)],
      [entry(3, 1, 'old'), entry(2), entry(1, 0, 'same time')],
    )

    expect(ids(result)).toEqual([1, 2, 3])
    expect(result.find((e) => e.id === 3)?.comment).toBe('new')
    expect(result.find((e) => e.id === 1)?.comment).toBe('same time')
  })
})

describe('applyChanges', () => {
  it('merges the changes and moves highWater to the newest', () => {
    const result = applyChanges(served(), [entry(4, 9), entry(2, 7, 'edited')])

    expect(ids(result.entries)).toEqual([1, 2, 3, 4])
    expect(result.entries?.[1]?.comment).toBe('edited')
    expect(result.highWater).toBe(at(9))
  })

  it('leaves a list that is not loaded yet alone', () => {
    expect(applyChanges(emptySnapshot, [entry(1)])).toBe(emptySnapshot)
  })
})

describe('countMatches', () => {
  it('expects exactly our last entry at the end of Memtime’s list', () => {
    const entries = [entry(1), entry(2)]

    expect(countMatches(entries, [entry(2)])).toBe(true)
    expect(countMatches(entries, [])).toBe(false)
    expect(countMatches(entries, [entry(3)])).toBe(false)
    expect(countMatches(entries, [entry(2), entry(3)])).toBe(false)
    expect(countMatches([], [])).toBe(true)
    expect(countMatches([], [entry(1)])).toBe(false)
  })
})

describe('a full read', () => {
  it('collects pages, then serves the result with the changes seen since it began', () => {
    let s = startReload(
      served([entry(1), entry(2, 8, 'changed meanwhile'), entry(9)]),
      at(5),
    )
    s = addReloadPage(s, [entry(1), entry(2)], 2, 100)
    expect(s.reload?.offset).toBe(2)
    expect(ids(s.entries)).toEqual([1, 2, 9])

    s = addReloadPage(s, [entry(3)], 2, 100)

    // 9 is gone from Memtime (not read, unchanged since the read began); 2 keeps its newer version.
    expect(ids(s.entries)).toEqual([1, 2, 3])
    expect(s.entries?.[1]?.comment).toBe('changed meanwhile')
    expect(s).toMatchObject({ reload: null, checkedAt: 100, highWater: at(5) })
  })

  it('keeps its place when this server saves or deletes entries meanwhile', () => {
    let s = startReload(served(), at(0))
    s = addReloadPage(s, [entry(1), entry(2), entry(4)], 3, 0)

    s = applyDeleted(s, 2)
    expect(s.reload).toMatchObject({ offset: 2 })
    expect(ids(s.reload?.entries)).toEqual([1, 4])

    // Below the last read: Memtime's list moves down by one.
    s = applySaved(s, entry(3, 1))
    expect(s.reload).toMatchObject({ offset: 3 })
    expect(ids(s.reload?.entries)).toEqual([1, 3, 4])

    // Past the last read: a later page brings it.
    s = applySaved(s, entry(7, 1))
    expect(s.reload).toMatchObject({ offset: 3 })
    expect(ids(s.reload?.entries)).toEqual([1, 3, 4])
  })
})

describe('saves', () => {
  it('put the saved entry into the list and bump the version', () => {
    const s = applySaved(served(), entry(2, 4, 'saved'))

    expect(s.entries?.[1]?.comment).toBe('saved')
    expect(s.version).toBe(1)
  })

  it('drop a deleted entry and bump the version', () => {
    const s = applyDeleted(served(), 2)

    expect(ids(s.entries)).toEqual([1, 3])
    expect(s.version).toBe(1)
  })

  it('force a check after an unknown outcome', () => {
    expect(markStale(served())).toMatchObject({ checkedAt: 0, version: 1 })
  })
})
