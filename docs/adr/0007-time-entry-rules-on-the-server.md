# 0007. Time entry rules on the server

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

The Memtime API only rejects an end that isn't after the start, an unknown task, malformed dates and partial bodies. It accepts overlapping or duplicate entries, future or year-1900 times, multi-day entries, completed tasks, and empty or 5000-character comments. Those cases need guarding on our side.

## Decision

- **The rules live in one server module** ([`server/src/timeEntries/rules`](../../server/src/timeEntries/rules/limits.ts)), and the server is the authority. `limits.ts` is the source of truth for thresholds.
- **The frontend only does basic field checks** (comment present and short enough, times present, end after start) and shows what the server answers.
- **Errors block, warnings ask.** An error is answered with 400 (`error`, `field`, `code`), shown under its field. A warning is answered with 409 and a `warnings` list; the client resends the same request with `acceptedWarnings` (the codes the user confirmed), and the server saves once every warning is accepted.
- **Edits only warn about what is new.** A warning the original entry already had is not raised again, so changing a comment on an old entry doesn't nag. An edit that changes nothing sends nothing upstream.
- **Task status** for the completed-task warning comes from a cached task lookup, on create only.

## Consequences

- A create can cost a task lookup and a cold load of all entries, against the 15 requests per minute limit.
- Overlap checks can miss entries changed outside this app for up to the cache TTL.
- A warning costs the user a round trip: the form can't show it before the first submit.
