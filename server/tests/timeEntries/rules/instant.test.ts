import { parseInstant } from '../../../src/timeEntries/rules/index.ts'

describe('parseInstant', () => {
  it.each([
    ['2025-01-01T09:00:00Z', Date.UTC(2025, 0, 1, 9)],
    ['2025-01-01T09:00Z', Date.UTC(2025, 0, 1, 9)],
    ['2025-01-01T09:00:30.123Z', Date.UTC(2025, 0, 1, 9, 0, 30, 123)],
    ['2025-01-01T10:00:00+01:00', Date.UTC(2025, 0, 1, 9)],
    ['2025-01-01T09:00:00z', Date.UTC(2025, 0, 1, 9)],
  ])('reads %s', (value, expected) => {
    expect(parseInstant(value)).toBe(expected)
  })

  it.each([
    '',
    'tomorrow',
    '2025-01-01',
    '2025-01-01T09:00:00',
    '2025-01-01 09:00:00Z',
    '2025-13-01T09:00:00Z',
    '2025-02-30T09:00:00Z',
    '2025-01-01T25:00:00Z',
  ])('rejects %j', (value) => {
    expect(parseInstant(value)).toBeUndefined()
  })

  it('accepts a leap day only in a leap year', () => {
    expect(parseInstant('2024-02-29T00:00:00Z')).toBeDefined()
    expect(parseInstant('2025-02-29T00:00:00Z')).toBeUndefined()
  })
})
