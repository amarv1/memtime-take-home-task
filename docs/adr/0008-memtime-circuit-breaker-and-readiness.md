# 0008. Memtime circuit breaker and readiness

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

When Memtime is down or slow, every request waits for the 10 second timeout and then fails, and each retry adds load to a service that is already struggling. We also have no way for a load balancer to tell that the app can't do useful work.

## Decision

- **One circuit breaker per process guards every Memtime call**, sign-in included. It uses [cockatiel](https://github.com/connor4312/cockatiel)'s breaker rather than our own, behind a small wrapper. After 5 consecutive failures it opens for 30 seconds, then lets one trial call through to decide whether to close.
- **Failures are network errors, timeouts and 5xx answers.** Never a 4xx, and never a 429: Memtime answered, so it is up.
- **While open, calls fail at once** with 503 and a `Retry-After` header. The frontend does not retry a 503.
- **`/api/health` stays a liveness check.** `/api/health/ready` asks Memtime's keyless `/health` endpoint (result cached for 10 seconds) and reports the breaker state. It answers 503 when Memtime is down.

## Consequences

- Breaker state is per instance, so each instance finds out about an outage on its own.
- A load balancer that uses `/ready` takes the app out of rotation during a Memtime outage.
- No retries are added: a failed call fails.
