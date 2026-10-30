import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  MEMTIME_API_URL: z.url().default('https://interview-api.memtime-demo.deno.net/api/v1'),
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
