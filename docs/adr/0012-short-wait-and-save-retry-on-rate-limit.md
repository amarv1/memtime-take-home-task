# 0012. Short wait and save retry on rate limit

- **Status:** Accepted
- **Date:** 2026-10-30
- **Supersedes:** the "fails at once" part of [0009](0009-memtime-rate-limit-budget.md)

## Context

Under [0009](0009-memtime-rate-limit-budget.md), a call that finds the budget used up fails at once with a 429, even when the window resets in a second. A save that lands just before a reset is refused for no good reason.

A full per-key queue with write priority would fix that, but gains little. Most countdowns come from long first loads, which a queue can't fit into one request either. It also holds requests open for up to a minute (proxy timeouts) and makes cancelling hard, because calls are shared between requests in `hierarchyCache.ts` and `timeEntryService.ts`.

## Decision

- **Server: the gate waits up to 5 s for the window to reset** (`maxWaitMs`), then checks again before sending. A reset further away still fails at once with `Retry-After`. It never waits and then fails on the same budget.
- **Same rule for reads and writes.** No queue, no priority, nothing to cancel.
- **Frontend: a save or delete that gets a 429 waits and resends.** The UI shows "Memtime is busy, saving in Ns…" and resends when the wait ends, up to 2 times. This is safe because a 429 means nothing was sent.
- **The user can cancel, and leaving the page cancels it.** Reads keep the countdown.

## Consequences

- A request may take up to about 5 s longer.
- Waiters that wake together after a reset can all go out before the first response teaches the new budget. That is fine at 15 per minute.
- A wake-up check can still fail if a new budget was learned meanwhile and is used up.
- State is still in memory, per instance.
