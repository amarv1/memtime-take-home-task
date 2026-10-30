import { z } from 'zod'

/**
 * Value for Express's `trust proxy`: true/false, a hop count, or a list of
 * addresses, subnets or names such as `loopback`.
 */
const trustProxy = z
  .string()
  .trim()
  .default('false')
  .transform((value, ctx): boolean | number | string[] => {
    if (value === 'true') return true
    if (value === 'false') return false
    if (/^\d+$/.test(value)) return Number(value)
    const list = value.split(',').map((item) => item.trim())
    // A bare number in the list (e.g. -1) is a typo, not an address.
    if (list.some((item) => item === '' || /^-?\d+$/.test(item))) {
      ctx.addIssue({
        code: 'custom',
        message: 'Use true, false, a hop count, or a comma-separated list of addresses',
      })
      return z.NEVER
    }
    return list
  })

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z
    .enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'])
    .default('info'),
  PORT: z.coerce.number().int().positive().default(3000),
  MEMTIME_API_URL: z.url().default('https://interview-api.memtime-demo.deno.net/api/v1'),
  SESSION_TTL_MS: z.coerce.number().int().positive().default(3_600_000),
  TIME_ENTRIES_CACHE_TTL_MS: z.coerce.number().int().positive().default(300_000),
  HIERARCHY_CACHE_TTL_MS: z.coerce.number().int().positive().default(300_000),
  TIME_ENTRIES_KEEP_MS: z.coerce.number().int().positive().default(3_600_000),
  MEMTIME_BREAKER_THRESHOLD: z.coerce.number().int().positive().default(5),
  MEMTIME_BREAKER_OPEN_MS: z.coerce.number().int().positive().default(30_000),
  SIGN_IN_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  TRUST_PROXY: trustProxy,
  MAX_SESSIONS: z.coerce.number().int().positive().default(1000),
  MAX_SESSIONS_PER_KEY: z.coerce.number().int().positive().default(5),
  // Secure unless explicitly turned off, so a deploy that forgets it stays safe.
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
})

export type Env = z.infer<typeof envSchema>

/** Validates environment variables; throws a readable error if any are invalid. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`)
  }
  return result.data
}
