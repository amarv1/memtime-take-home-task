# 0002. Lightweight server to keep API keys secure

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

Every Memtime API request needs an API key as a bearer token. Keys are per user, and a key grants access to that user's time entries, including changing and deleting them. Keys must stay secret.

Anything that reaches the browser can be read by whoever uses it: values baked into the bundle, browser storage, and request headers in dev tools. A frontend that calls the Memtime API directly ([0001](0001-lightweight-web-frontend.md)) can't keep a key secret, however it stores it.

## Decision

We will add our own server between the frontend and the Memtime API. Its main job is to keep API keys secure:

- The keys stay on the server, which attaches them to upstream requests. A key is never sent back to the browser, logged, or returned in a response.
- The frontend only calls our server's `/api/*` routes on its own origin. In development, Vite proxies `/api` to the server.

We will keep the server light, because its job is narrow:

- **Express 5 + TypeScript**, with zod to validate environment variables and request bodies.
- No backend framework (such as NestJS), no database, no ORM.
- **Vitest + supertest + MSW** for tests, with the Memtime API always mocked.

## Consequences

- API keys never reach the browser.
- There are two projects to run and deploy instead of one static site.
- Each request makes an extra hop, which is small next to the upstream call itself.
- Later, the server is also the natural place to handle the Memtime rate limit (15 requests / 60 s per key) and caching, if we need them. Neither is built now.
