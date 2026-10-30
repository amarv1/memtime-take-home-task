import { setupServer } from 'msw/node'

/** Shared MSW server for mocking the upstream API. Add per-test handlers with `server.use(...)`. */
export const server = setupServer()
