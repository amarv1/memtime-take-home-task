# Memtime frontend

React + TypeScript + Vite client. In dev, requests to `/api` are proxied to our
server (`API_PROXY_TARGET`). Design decisions are recorded in
[docs/adr](../docs/adr/README.md).

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
| `pnpm test:e2e`                | Playwright, with the API mocked                      |
| `pnpm check`                   | Typecheck, lint, format check, tests (run before PR) |

## Structure

```
src/
  pages/        route-level components
  features/     feature modules (auth, hierarchy)
  components/   shared components; ui/ holds shadcn components
  lib/          api client, queryClient, utils
```

Tests live in `tests/`, which mirrors `src/`. `tests/support/` holds the setup and
helpers, `tests/fixtures/` the test data, and `tests/e2e/` the Playwright tests.

## Stack

Vite, React 19, TypeScript (strict), React Router, TanStack Query,
React Hook Form + Zod, Tailwind CSS 4, Sonner, Vitest.

TypeScript is pinned to 6.x because typescript-eslint doesn't support 7 yet.
