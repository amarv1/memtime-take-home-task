import { createSessionStore } from './sessionStore.ts'

describe('sessionStore', () => {
  let time = 1_000_000
  const now = () => time
  const stores: ReturnType<typeof createSessionStore>[] = []

  function makeStore(sweepIntervalMs?: number) {
    const store = createSessionStore({ ttlMs: 1000, now, sweepIntervalMs })
    stores.push(store)
    return store
  }

  beforeEach(() => {
    time = 1_000_000
  })
  afterEach(() => {
    stores.splice(0).forEach((s) => s.stop())
    vi.useRealTimers()
  })

  it('creates sessions with unique base64url ids of 43 characters', () => {
    const store = makeStore()
    const a = store.create('key-a')
    const b = store.create('key-b')

    expect(a.id).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a.id).not.toBe(b.id)
    expect(a.apiKey).toBe('key-a')
    expect(a.expiresAt).toBe(time + 1000)
  })

  it('returns a session until it expires, then removes it', () => {
    const store = makeStore()
    const { id } = store.create('key')

    time += 999
    expect(store.get(id)?.apiKey).toBe('key')

    time += 1
    expect(store.get(id)).toBeUndefined()

    time -= 1
    expect(store.get(id)).toBeUndefined()
  })

  it('returns undefined for an unknown id', () => {
    expect(makeStore().get('nope')).toBeUndefined()
  })

  it('deletes a session', () => {
    const store = makeStore()
    const { id } = store.create('key')

    store.delete(id)

    expect(store.get(id)).toBeUndefined()
  })

  it('sweep removes only expired sessions', () => {
    const store = makeStore()
    const old = store.create('old')
    time += 600
    const fresh = store.create('fresh')
    time += 500

    store.sweep()
    time -= 500 // rewind: if sweep hadn't removed it, get() would return it again

    expect(store.get(old.id)).toBeUndefined()
    expect(store.get(fresh.id)?.apiKey).toBe('fresh')
  })

  it('sweeps on a timer until stopped', () => {
    vi.useFakeTimers()
    const store = makeStore(60_000)
    const { id } = store.create('key')

    time += 2000
    vi.advanceTimersByTime(60_000)
    time -= 2000
    expect(store.get(id)).toBeUndefined()

    store.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
