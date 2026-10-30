# Memtime server

Express 5 + TypeScript server that sits between the frontend and the Memtime API.
The frontend dev server proxies `/api` here (port 3000 by default).
Design decisions are recorded in [docs/adr](../docs/adr/README.md).

## Getting started

```bash
pnpm install
cp .env.example .env   # optional; every variable has a default (see the comments there)
pnpm dev
```

Check it's running: `curl localhost:3000/api/health` → `{"status":"ok"}`.

## Scripts

| Script                         | What it does                                         |
| ------------------------------ | ---------------------------------------------------- |
| `pnpm dev`                     | Runs `src/index.ts` with tsx, restarts on change     |
| `pnpm build` / `start`         | Compiles to `dist/` / runs the compiled server       |
| `pnpm lint` / `lint:fix`       | ESLint (typescript-eslint, type-checked)             |
| `pnpm format` / `format:check` | Prettier                                             |
| `pnpm test`                    | Vitest + supertest + MSW                             |
| `pnpm check`                   | Typecheck, lint, format check, tests (run before PR) |

## Structure

```
src/
  app.ts          createApp(): routes and middleware, no listen (used by tests)
  index.ts        entry point: loads env, starts listening
  env.ts          environment variables, validated with zod
  logger.ts       shared winston logger
  middleware/     error handling, sessions, request ids
  sessions/       session store and the /api/session routes
  memtime/        calls to the upstream Memtime API
  timeEntries/    time entry routes, rules and caching
```

## Testing

- Tests live in `tests/`, mirroring `src/`, as `*.test.ts`.
- Call the app in memory with `request(createApp())` from supertest.
- Mock the upstream API with `server.use(http.get(...))` from `tests/support/server.ts`.
  Any upstream request without a handler fails the test, so tests never reach
  the real API.
