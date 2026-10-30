# Memtime

A web app for browsing clients, projects and tasks and for logging time entries against the Memtime API.

## Getting started

Requires Node 22+ and pnpm 10 (`corepack enable` will give you the pinned version).

```bash
pnpm install
cp server/.env.example server/.env       # optional; every variable has a default
cp frontend/.env.example frontend/.env   # optional; the proxy defaults to :3000
pnpm dev                                 # server on :3000, frontend on :5173
```

Open http://localhost:5173 and sign in with your Memtime API key.
