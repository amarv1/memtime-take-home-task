# 0005. Selected task in the URL

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

A task should have a shareable link that opens the tree at that task. The API has no endpoint for a task's path, and the limit is 15 requests per minute.

## Decision

- **The URL holds only the task id** (`/tasks/:taskId`) and is the single source of truth for the selection.
- **The path is resolved from two detail calls** (task, then project), proxied by the server, on a cold link. Otherwise it comes from the lists already in the cache, so selecting in the tree costs no request.

## Consequences

- A cold link costs five calls: clients, task, project, projects and tasks.
- A task deep in a long list costs one more call per page.
