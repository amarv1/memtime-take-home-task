import { logger } from '../logger.ts'
import { MemtimeKeyRejectedError } from '../middleware/endSessionOnRevokedKey.ts'
import { HttpError } from '../middleware/errorHandler.ts'
import type { MemtimeClient } from './memtimeClient.ts'

/**
 * Checks an API key with one cheap upstream call.
 * Returns false when the key is rejected; throws an HttpError when the check can't be completed
 * (including a 503 while the Memtime circuit is open). Error messages never include the key.
 */
export async function verifyApiKey(
  client: MemtimeClient,
  apiKey: string,
): Promise<boolean> {
  let status: number
  try {
    ;({ status } = await client.get(apiKey, '/clients', 'limit=1', 'POST /api/session'))
  } catch (err) {
    if (err instanceof MemtimeKeyRejectedError) return false
    throw err
  }

  if (status >= 200 && status < 300) return true
  if (status === 403) return false
  if (status === 429) {
    logger.warn('Memtime key check rate limited (429)')
    throw new HttpError(429, 'Too many attempts. Wait a minute and try again.')
  }
  logger.error(`Memtime key check failed: upstream returned ${status}`)
  throw new HttpError(502, "Couldn't reach Memtime. Please try again.")
}
