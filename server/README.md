# Memtime server

Express 5 + TypeScript server that sits between the frontend and the Memtime API.
The frontend dev server proxies `/api` here (port 3000 by default).

## Getting started

```bash
pnpm install
cp .env.example .env   # optional; every variable has a default
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
  middleware/     error handling ({ error } responses, like the upstream API), requireSession
  sessions/       in-memory session store and the /api/session routes
  memtime/        calls to the upstream Memtime API (API key check)
  test/           Vitest setup and the shared MSW server
```

## Signing in

Users sign in with their Memtime API key. The server checks it with one upstream
call (`GET /clients?limit=1`), then keeps it in an in-memory session and gives the
browser an HttpOnly cookie (`memtime_sid`, SameSite=Strict, Path=/api, `Secure` in
production). The key is never sent back to the browser. See
[ADR 0003](../docs/adr/0003-in-memory-sessions-bound-to-api-key.md).

| Route                 | Result                                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/session`   | Body `{ apiKey }`. 200 `{ expiresAt }` + cookie; 400 bad body; 401 key rejected; 429 upstream rate limit; 502 upstream unreachable or failing |
| `GET /api/session`    | 200 `{ expiresAt }` if signed in, otherwise 401 `Not signed in`                                                                               |
| `DELETE /api/session` | Always 204; ends the session and clears the cookie                                                                                            |

Later routes use `requireSession(store)`, which puts the session on `res.locals.session`
(read it with `getSession(res)`) or answers 401.

| Variable         | Default   | Meaning                                           |
| ---------------- | --------- | ------------------------------------------------- |
| `SESSION_TTL_MS` | `3600000` | How long a sign-in lasts (absolute, not extended) |

## Testing

- Tests sit next to the code as `*.test.ts`.
- Call the app in memory with `request(createApp())` from supertest.
- Mock the upstream API with `server.use(http.get(...))` from `src/test/server.ts`.
  Any upstream request without a handler fails the test, so tests never reach
  the real API.
