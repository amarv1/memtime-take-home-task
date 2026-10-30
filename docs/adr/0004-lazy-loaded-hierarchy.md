# 0004. Lazy-loaded client, project and task tree

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

The home page shows clients, their projects and their tasks. The API has no endpoint for the whole hierarchy. Loading the hierarchy takes N+1 calls (clients, then projects per client, then tasks per project). The limit is 15 requests per minute.

## Decision

- **Load each level only when its parent is expanded.** Nothing below the clients is fetched on page load.
- **Request pages of 100,** the largest the API returned in testing. A "Load more" row appears while a page comes back full.
- **Cache for 5 minutes,** so collapsing and re-expanding a node doesn't refetch.
- **Don't retry 4xx errors,** so a 404 or 429 doesn't use up more of the budget.
- **The server only proxies** the three list routes, passing responses through unchanged.

## Consequences

- Opening a node costs one call. Browsing quickly can still hit the rate limit.
