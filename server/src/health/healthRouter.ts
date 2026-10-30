import { Router } from 'express'
import type { ReadinessCheck } from './readiness.ts'

interface Options {
  readiness: ReadinessCheck
}

/**
 * `/api/health` says the process is alive. `/api/health/ready` says Memtime can be reached, so a
 * load balancer can stop sending traffic during an outage. Neither body carries URLs or error details.
 */
export function healthRouter({ readiness }: Options) {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json({ status: 'ok' })
  })

  router.get('/ready', async (_req, res) => {
    const { ready, memtime, circuit } = await readiness.check()
    res
      .status(ready ? 200 : 503)
      .set('Cache-Control', 'no-store')
      .json({
        status: ready ? 'ready' : 'not_ready',
        checks: { memtime: { status: memtime, circuit } },
      })
  })

  return router
}
