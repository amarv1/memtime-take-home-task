# 0010. Time entries kept in sync by `updatedAt`

- **Status:** Accepted
- **Date:** 2026-10-30
- **Supersedes:** the caching part of [0006](0006-time-entries-filtered-and-cached-on-server.md)

## Context

Under [0006](0006-time-entries-filtered-and-cached-on-server.md), every save and every expired cache reloaded a user's whole list, at 1 call per 100 entries. Only a complete load was cached, so a list longer than one rate-limit window (about 1,300 entries) never loaded, and saves got expensive long before that. Memtime can't filter entries, but its lists sort by `id` and `updatedAt`.

## Decision

- **The server keeps each user's list and syncs it instead of reloading it.** Saves made through the app update the list in place.
- **A stale list asks only for what changed:** entries sorted by `updatedAt` descending, down to the newest one already seen. Usually 1 call.
- **A count check catches deletes**, which leave no trace in `updatedAt`. One call reads the id-sorted list at our own count. Only a mismatch reads the whole list again.
- **Full reads go by `id` and resume across rate-limit windows.** Progress is kept between requests, and the old list is served until the new one is complete.

## Consequences

- Saves no longer cost list reads. A typical refresh costs 2 calls (changes and count), whatever the list size.
- A first load of a long list still takes 1 call per 100 entries, spread over as many windows as needed. The user waits through the 429 countdown once.
- Changes made elsewhere still show up only after the freshness window (5 minutes). A delete made elsewhere makes the next page views read the whole list again; they show the old list until that is done.
- The list is still in memory, so a single instance only; Redis would hold the same snapshot.
