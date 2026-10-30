import { formatDateTime, formatDuration } from '@/features/timeEntries/format'

describe('formatDuration', () => {
  it.each([
    ['2025-01-01T09:00:00Z', '2025-01-01T10:05:00Z', '1h 5m'],
    ['2025-01-01T09:00:00Z', '2025-01-01T11:00:00Z', '2h'],
    ['2025-01-01T09:00:00Z', '2025-01-01T09:12:30Z', '12m 30s'],
    ['2025-01-01T09:00:00Z', '2025-01-01T09:00:30Z', '30s'],
    ['2025-01-01T09:00:00Z', '2025-01-01T09:00:00Z', '0s'],
    ['2025-01-01T09:00:00Z', '2025-01-01T08:00:00Z', '0s'],
  ])('%s to %s is %s', (start, end, expected) => {
    expect(formatDuration(start, end)).toBe(expected)
  })

  it('shows a dash for an invalid date', () => {
    expect(formatDuration('nope', '2025-01-01T09:00:00Z')).toBe('—')
  })
})

describe('formatDateTime', () => {
  it('formats a date and time', () => {
    expect(formatDateTime('2025-01-01T09:00:00Z')).toMatch(
      /^Jan 1, 2025 \d{1,2}:00 [AP]M$/,
    )
  })

  it('shows a dash for an invalid date', () => {
    expect(formatDateTime('nope')).toBe('—')
  })
})
