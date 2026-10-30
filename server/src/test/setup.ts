import { server } from './server.ts'

const LOCAL_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost'])

beforeAll(() =>
  server.listen({
    // supertest calls the app over a local socket, so let those requests through.
    // Any other request without a handler (e.g. a real upstream call) fails the test.
    // Throwing is what blocks the request: MSW answers it with a 500.
    onUnhandledFrame: ({ frame }) => {
      const { request } = frame.data as { request?: unknown }
      if (!(request instanceof Request)) throw new Error('[MSW] Unhandled network frame')

      if (LOCAL_HOSTS.has(new URL(request.url).hostname)) return

      const message = `[MSW] Unhandled request: ${request.method} ${request.url}. Add a handler with server.use(...).`
      console.error(message)
      throw new Error(message)
    },
  }),
)
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
