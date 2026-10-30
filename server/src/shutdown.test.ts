import type { Server } from 'node:http'
import { registerGracefulShutdown } from './shutdown.ts'

function fakeServer(closeError?: Error) {
  let onClose: ((err?: Error) => void) | undefined
  const server = {
    close: vi.fn((cb: (err?: Error) => void) => {
      onClose = cb
    }),
    closeIdleConnections: vi.fn(),
    closeAllConnections: vi.fn(),
  }
  return {
    server: server as unknown as Server,
    mocks: server,
    finishClose: () => onClose?.(closeError),
  }
}

describe('registerGracefulShutdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'info').mockImplementation(vi.fn())
    vi.spyOn(console, 'error').mockImplementation(vi.fn())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
  })

  it('stops accepting connections, closes idle ones, and exits 0 once closed', () => {
    const { server, mocks, finishClose } = fakeServer()
    const exit = vi.fn()
    const shutdown = registerGracefulShutdown(server, { exit })

    shutdown('SIGTERM')
    expect(mocks.close).toHaveBeenCalledOnce()
    expect(mocks.closeIdleConnections).toHaveBeenCalledOnce()
    expect(exit).not.toHaveBeenCalled()

    finishClose()
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('exits 1 if closing fails', () => {
    const { server, finishClose } = fakeServer(new Error('boom'))
    const exit = vi.fn()

    registerGracefulShutdown(server, { exit })('SIGINT')
    finishClose()

    expect(exit).toHaveBeenCalledWith(1)
  })

  it('forces exit when in-flight requests outlast the timeout', () => {
    const { server, mocks } = fakeServer()
    const exit = vi.fn()

    registerGracefulShutdown(server, { timeoutMs: 500, exit })('SIGTERM')
    vi.advanceTimersByTime(500)

    expect(mocks.closeAllConnections).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('ignores repeated signals', () => {
    const { server, mocks } = fakeServer()
    const shutdown = registerGracefulShutdown(server, { exit: vi.fn() })

    shutdown('SIGINT')
    shutdown('SIGTERM')

    expect(mocks.close).toHaveBeenCalledOnce()
  })

  it('is triggered by SIGTERM', () => {
    const { server, mocks } = fakeServer()
    registerGracefulShutdown(server, { exit: vi.fn() })

    process.emit('SIGTERM')

    expect(mocks.close).toHaveBeenCalledOnce()
  })
})
