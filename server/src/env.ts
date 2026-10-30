import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  MEMTIME_API_URL: z.url().default('https://interview-api.memtime-demo.deno.net/api/v1'),
  SESSION_TTL_MS: z.coerce.number().int().positive().default(3_600_000),
  SIGN_IN_RATE_LIMIT: z.coerce.number().int().positive().default(10),
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
