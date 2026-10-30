# 0001. Lightweight web frontend

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

We are integrating the Memtime API into our own solution. We don't control that API; we only consume it.

The product is simple. Users need to:

- browse the client → project → task tree, and
- see, create, and edit time entries per task.

They need a UI for this, and a web app is the simplest way to reach them. There is no public or SEO-relevant content, and all data is private to the signed-in user, so server-side rendering adds nothing.

## Decision

We will build a separate web frontend project as a client-rendered single-page app, kept deliberately light:

- **Vite + React + TypeScript** for the app and build.
- **React Router** for the few screens.
- **TanStack Query** for fetching and caching data in the browser.
- **React Hook Form + zod** for the time entry form and its validation.
- **Vitest + Testing Library + MSW** for tests.

We will not use a full-stack framework such as Next.js or Remix. Their routing conventions, rendering server, and deployment constraints solve problems this scope doesn't have.

## Consequences

- Few dependencies, fast builds, and a static bundle that can be served from anywhere.
- No SSR, so the first paint shows loading states while data is fetched. That's fine for a signed-in tool.
- If the scope grows a lot, we revisit this in a new ADR.
