import { http, HttpResponse } from 'msw'
import { createMemoryCache } from '../../src/cache/memoryCache.ts'
import { createMemtimeClient } from '../../src/memtime/memtimeClient.ts'
import { HttpError } from '../../src/middleware/errorHandler.ts'
import { createTaskLookup } from '../../src/timeEntries/taskLookup.ts'
import { server } from '../support/server.ts'

const BASE = 'https://upstream.test/api/v1'

describe('taskLookup', () => {
  let calls: { id: string; auth: string | null }[]
  const lookup = () =>
    createTaskLookup({
      client: createMemtimeClient({ memtimeApiUrl: BASE }),
      cache: createMemoryCache<string>({ ttlMs: 60_000, maxEntries: 10 }),
    })

  function mockTask(respond: () => Response) {
    calls = []
    server.use(
      http.get(`${BASE}/tasks/:id`, ({ request, params }) => {
        calls.push({ id: String(params.id), auth: request.headers.get('authorization') })
        return respond()
      }),
    )
  }

  it('returns the status and calls upstream once per key and task', async () => {
    mockTask(() => HttpResponse.json({ id: 5, status: 'active' }))
    const tasks = lookup()

    expect(await tasks.getStatus('key-a', 5)).toBe('active')
    expect(await tasks.getStatus('key-a', 5)).toBe('active')
    await tasks.getStatus('key-b', 5)
    await tasks.getStatus('key-a', 6)

    expect(calls.map((c) => c.id)).toEqual(['5', '5', '6'])
    expect(calls[0]?.auth).toBe('Bearer key-a')
  })

  it.each([
    [404, 404, 'Task not found'],
    [500, 502, 'Memtime could not return the task.'],
  ])('maps upstream %i to %i', async (upstream, status, message) => {
    mockTask(() => HttpResponse.json({}, { status: upstream }))

    await expect(lookup().getStatus('key', 5)).rejects.toMatchObject({ status, message })
  })

  it('passes a rate limit on with its Retry-After', async () => {
    mockTask(() =>
      HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '9' } }),
    )

    const error = await lookup()
      .getStatus('key', 5)
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(HttpError)
    expect(error).toMatchObject({ status: 429, headers: { 'Retry-After': '9' } })
  })

  it('answers 502 for a body without a status, and does not cache the failure', async () => {
    mockTask(() => HttpResponse.json({ id: 5 }))
    const tasks = lookup()

    await expect(tasks.getStatus('key', 5)).rejects.toMatchObject({ status: 502 })
    await expect(tasks.getStatus('key', 5)).rejects.toMatchObject({ status: 502 })

    expect(calls).toHaveLength(2)
  })
})
