# Architecture Decision Records

Short records of the significant decisions on this project: what we decided, why, and what it costs us.
New decisions get a new file. If a decision changes, add a new ADR that supersedes the old one instead of rewriting history.

## Index

| #                                                          | Title                                          | Status                                                                  |
| ---------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------- |
| [0001](0001-lightweight-web-frontend.md)                   | Lightweight web frontend                       | Accepted                                                                |
| [0002](0002-lightweight-server-for-api-key-security.md)    | Lightweight server to keep API keys secure     | Accepted                                                                |
| [0003](0003-in-memory-sessions-bound-to-api-key.md)        | In-memory sessions bound to the API key        | Accepted                                                                |
| [0004](0004-lazy-loaded-hierarchy.md)                      | Lazy-loaded client, project and task tree      | Proxy-only superseded by [0011](0011-hierarchy-cached-on-server.md)     |
| [0005](0005-selected-task-in-url.md)                       | Selected task in the URL                       | Accepted                                                                |
| [0006](0006-time-entries-filtered-and-cached-on-server.md) | Time entries filtered and cached on the server | Caching superseded by [0010](0010-time-entries-synced-by-updated-at.md) |
| [0007](0007-time-entry-rules-on-the-server.md)             | Time entry rules on the server                 | Accepted                                                                |
| [0008](0008-memtime-circuit-breaker-and-readiness.md)      | Memtime circuit breaker and readiness          | Accepted                                                                |
| [0009](0009-memtime-rate-limit-budget.md)                  | Memtime rate-limit budget                      | Accepted                                                                |
| [0010](0010-time-entries-synced-by-updated-at.md)          | Time entries kept in sync by `updatedAt`       | Accepted                                                                |
| [0011](0011-hierarchy-cached-on-server.md)                 | Hierarchy cached on the server                 | Accepted                                                                |

## Writing a new ADR

1. Copy [template.md](template.md) to `NNNN-short-title.md`, using the next number.
2. Fill in context, decision, and consequences. Keep it short: one decision per record.
3. Add it to the index above.
