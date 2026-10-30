# 0011. Hierarchy cached on the server

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

Memtime allows 15 calls a minute per API key, and the server keeps 2 of them for writes. The browser caches the client, project and task lists, but every new tab and every reload starts empty, and a pasted task link costs 5 calls. This supersedes the "server only proxies" bullet of [0004](0004-lazy-loaded-hierarchy.md).

## Decision

- **Cache each list page and lookup per API key hash for 5 minutes,** with the query sorted so the same page asked in another param order shares an entry.
- **Share one in-flight load** between concurrent requests for the same page or item.
- **Cache only successes:** a 2xx JSON array for a list, a 2xx object with a numeric `id` for a lookup. Errors, 429s and other bodies are never cached.
- **Index every item seen** in a list or lookup, so a task or project lookup and the save's task-status check are answered without a call when the item was already seen.
- **Keep it in memory, per instance.**

## Consequences

- A reload or a second tab within the TTL costs no calls, and neither does a link to a task already seen.
- Changes made in Memtime can show up late, by up to the server TTL plus the browser's 5-minute stale time.
- A single instance only; sharing the cache between instances would need Redis, which the cache interface allows.
