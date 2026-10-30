# 0006. Time entries filtered and cached on the server

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

The API can't filter time entries by task, and it allows 15 requests per minute per key. A task's entries page still needs a filtered, paginated list with a total.

## Decision

- **The server loads all of a key's entries** (100 per call), filters by task, sorts newest first, paginates and returns a total.
- **Entries are kept in an in-memory cache with a TTL**, keyed by a hash of the API key, so all sessions of one user share it. Concurrent loads of the same key share one in-flight request, and failed loads are not cached. Redis is meant to replace the cache later.
- **The cache is capped by total entries held** (200,000 by default, `TIME_ENTRIES_CACHE_MAX_ENTRIES`), not by number of users. When over it, the user stored longest ago is dropped first. The newest user is always kept, so a huge account can't evict itself mid-load.

## Consequences

- A cold load costs one call per 100 entries, so very large accounts (about 1,400+ entries) can't load within one rate-limit window.
- Data can be up to 5 minutes stale. Changes to entries must invalidate the key's cache.
- The cache lives in one process, so only a single instance is supported.
- The selected-task URL is now `/tasks/:taskId/entries`. The old `/tasks/:taskId` redirects to it.
