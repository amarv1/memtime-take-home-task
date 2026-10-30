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
  pages/        route-level components
  components/   shared components (ui/ reserved for shadcn)
  lib/          queryClient, utils
  test/         test setup
```

## Stack

Vite, React 19, TypeScript (strict), React Router, TanStack Query,
React Hook Form + Zod, Tailwind CSS 4, Sonner, Vitest.

TypeScript is pinned to 6.x because typescript-eslint doesn't support 7 yet.
