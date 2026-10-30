import '@testing-library/jest-dom/vitest'
import { server } from './server'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// jsdom doesn't implement scrolling.
export const scrollIntoView = vi.fn()
Element.prototype.scrollIntoView = scrollIntoView
