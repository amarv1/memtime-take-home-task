import { http, HttpResponse } from 'msw'
import { listTaskEntries } from '@/features/timeEntries/api'
import { server } from '../../support/server'

describe('listTaskEntries', () => {
  it('requests one page of a task', async () => {
    const seen: string[] = []
    const body = { items: [], total: 0, limit: 25, offset: 50 }
    server.use(
      http.get('/api/tasks/398/entries', ({ request }) => {
        const url = new URL(request.url)
        seen.push(url.pathname + url.search)
        return HttpResponse.json(body)
      }),
    )

    await expect(listTaskEntries(398, 25, 50)).resolves.toEqual(body)
    expect(seen).toEqual(['/api/tasks/398/entries?limit=25&offset=50'])
  })
})
