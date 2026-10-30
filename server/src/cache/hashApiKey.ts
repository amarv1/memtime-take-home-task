import { createHash } from 'node:crypto'

/** Cached data belongs to the key's owner, so the key (hashed, never stored raw) is the cache key. */
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex')
}
