# Memtime frontend

React + TypeScript + Vite client. In dev, requests to `/api` are proxied to our
server (`API_PROXY_TARGET`).

## Getting started

```bash
pnpm install
cp .env.example .env   # set API_PROXY_TARGET if the server isn't on :3000
pnpm dev
```

## Scripts

| Script                         | What it does                                         |
| ------------------------------ | ---------------------------------------------------- |
| `pnpm dev`                     | Dev server; proxies `/api` to `API_PROXY_TARGET`     |
| `pnpm build`                   | Typecheck + production build                         |
| `pnpm lint` / `lint:fix`       | ESLint (typescript-eslint, react-hooks, jsx-a11y)    |
| `pnpm format` / `format:check` | Prettier                                             |
| `pnpm test`                    | Vitest + Testing Library + MSW                       |
| `pnpm check`                   | Typecheck, lint, format check, tests (run before PR) |

## Structure

```
src/
  pages/        route-level components (LoginPage, HomePage)
  features/     feature modules; auth/ holds session api, hooks, RequireAuth
  components/   shared components (AppLayout; ui/ reserved for shadcn)
  lib/          api client, queryClient, utils
```

Tests live outside `src/`, in `tests/`, which mirrors `src/`. `tests/support/`
holds the test setup and helpers; `tests/e2e/` holds the Playwright tests.

## Authentication

Users sign in with their Memtime API key on `/login`. The key is sent once to
`POST /api/session`; the server verifies it and sets an HttpOnly session
cookie, so the key is never stored in the browser. `RequireAuth` guards the
app routes using `GET /api/session` and redirects to `/login` when signed out.
Sessions last 1 hour; any 401 from the API signs the user out with a toast.

## Stack

Vite, React 19, TypeScript (strict), React Router, TanStack Query,
React Hook Form + Zod, Tailwind CSS 4, Sonner, Vitest.

TypeScript is pinned to 6.x because typescript-eslint doesn't support 7 yet.
