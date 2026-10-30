# 0009. Memtime rate-limit budget

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

Memtime allows 15 requests per 60 seconds per API key and answers 429 beyond that. Nothing tracked the remaining budget, so reads kept calling Memtime until it refused, and a user's save could then be refused too.

## Decision

- **The server tracks each key's remaining budget** from the rate-limit headers on Memtime's responses.
- **When a read would use up the budget, it fails at once** with a 429 and the exact `Retry-After`, without calling Memtime.
- **2 calls stay in reserve for writes.** Reads stop at 2 remaining; writes stop at 0. Every call made while handling a save, its checks included, counts as a write.
- **An unknown key or an expired window is let through.** No state means no guess.
- **State is in memory, per instance**, like the circuit breaker in [ADR 0008](0008-memtime-circuit-breaker-and-readiness.md).

## Consequences

- Calls made outside this app are only seen through the next response's headers.
- Loading a cold set of time entries now stops after about 13 pages instead of running into Memtime's 429.
- The reserve covers a typical save (task lookup and the write). A save whose checks must first load the entries cold can still run out.
- A queue that waits instead of failing can later replace the gate's internals without changing its callers.
