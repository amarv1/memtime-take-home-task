# 0003. In-memory sessions bound to the API key

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

Users sign in with their own Memtime API key. By [0002](0002-lightweight-server-for-api-key-security.md) the key must stay on our server, so the browser needs another way to prove who it is on later requests. There is no user database and we don't want to add one. Memtime has no login endpoint, so the only way to check a key is to use it.

## Decision

We will use cookie sessions that hold the key in server memory:

- Signing in checks the key with one upstream call (`GET /clients?limit=1`). If it is accepted, the server creates a session `{ apiKey, expiresAt }` in memory and sets a cookie with a random session id (32 random bytes, base64url).
- The cookie is `HttpOnly` and `SameSite=Strict`, limited to `/api`, and `Secure` by default (`COOKIE_SECURE=false` turns it off for local development over http). It never contains the key.
- A session lasts 1 hour from sign in. The limit is absolute: activity does not extend it. Expired sessions are rejected when read and swept every minute.
- Signing in again replaces the old session. Signing out deletes it.
- `/api/*` routes that call Memtime use a `requireSession` middleware to get the key.
- If Memtime answers 401 to a call made with a session's key (the key was revoked or changed mid-session), the route throws `MemtimeKeyRejectedError`. An error middleware then deletes the session, clears the cookie and responds 401, so the frontend's existing 401 handler signs the user out. Memtime returns 401 for a bad or missing key, so that is the only status that ends a session this way.

We will not add a CSRF token for now. `SameSite=Strict` keeps the cookie off cross-site requests, and as a second layer the server answers 415 to any POST, PUT or PATCH that is not `Content-Type: application/json` (a cross-site form or `text/plain` request cannot send that type without a CORS preflight, which we never approve). DELETE is not a simple method, so browsers already preflight it.

Because sign-in lets anyone test keys through our server, and each attempt costs an upstream call, abuse is limited in three ways:

- `POST /api/session` is limited per client IP (10 attempts per 15 minutes by default, then 429).
- The store keeps at most 5 sessions per API key; creating another drops that key's oldest.
- The store holds at most 1000 sessions in total. When it is full of unexpired sessions, sign-in answers 503.

The server also sends security headers (helmet: CSP with `frame-ancestors`, HSTS, `nosniff`).

## Consequences

- The key never reaches the browser, and there is no database to run.
- Sessions are lost when the server restarts, and users sign in again.
- It works for a single server instance only. Running several instances needs a shared store such as Redis; the session store is small and isolated so it can be swapped.
- The key stays in memory for up to an hour, so a memory dump of the server would expose it. We accept this for now.
- A user who changes or revokes their key is only noticed on the next upstream call. That call ends the session (see above), so the user sees one failed request and is then sent to sign in again.
