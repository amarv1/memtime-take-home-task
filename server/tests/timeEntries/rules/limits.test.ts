import {
  LONG_DURATION_MS,
  MAX_COMMENT_LENGTH,
  MAX_DURATION_MS,
} from '../../../src/timeEntries/rules/index.ts'

describe('limits', () => {
  it('has the agreed values', () => {
    expect(MAX_COMMENT_LENGTH).toBe(500)
    expect(MAX_DURATION_MS).toBe(24 * 3_600_000)
    expect(LONG_DURATION_MS).toBe(12 * 3_600_000)
  })
})
