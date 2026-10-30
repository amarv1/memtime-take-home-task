import { setupServer } from 'msw/node'

/** Shared MSW server. Add per-test handlers with `server.use(...)`. */
export const server = setupServer()
