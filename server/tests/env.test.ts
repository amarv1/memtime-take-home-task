import { loadEnv } from '../src/env.ts'

describe('loadEnv', () => {
  it('applies defaults', () => {
    expect(loadEnv({})).toEqual({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      PORT: 3000,
      MEMTIME_API_URL: 'https://interview-api.memtime-demo.deno.net/api/v1',
      SESSION_TTL_MS: 3_600_000,
      SIGN_IN_RATE_LIMIT: 10,
      MAX_SESSIONS: 1000,
      MAX_SESSIONS_PER_KEY: 5,
      COOKIE_SECURE: true,
    })
  })

  it('parses PORT as a number', () => {
    expect(loadEnv({ PORT: '4000' }).PORT).toBe(4000)
  })

  it('only turns off COOKIE_SECURE when set to false', () => {
    expect(loadEnv({ NODE_ENV: 'production' }).COOKIE_SECURE).toBe(true)
    expect(loadEnv({ COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false)
    expect(() => loadEnv({ COOKIE_SECURE: '0' })).toThrow(/COOKIE_SECURE/)
  })

  it('throws a readable error for invalid values', () => {
    expect(() => loadEnv({ PORT: 'abc', MEMTIME_API_URL: 'not a url' })).toThrow(
      /Invalid environment[\s\S]*PORT[\s\S]*MEMTIME_API_URL/,
    )
  })
})
