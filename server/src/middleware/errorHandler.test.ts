import express from 'express'
import request from 'supertest'
import { logger } from '../logger.ts'
import { HttpError, errorHandler } from './errorHandler.ts'

function appThatThrows(error: unknown) {
  const app = express()
  app.use(express.json())
  app.post('/test', () => {
    throw error
  })
  app.use(errorHandler)
  return app
}

describe('errorHandler', () => {
  it('uses the status and message of an HttpError', async () => {
    const res = await request(appThatThrows(new HttpError(409, 'Conflict'))).post('/test')

    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'Conflict' })
  })

  it('returns 400 for a malformed JSON body', async () => {
    const res = await request(appThatThrows(new Error('unreachable')))
      .post('/test')
      .set('Content-Type', 'application/json')
      .send('{not json')

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Invalid JSON body' })
  })

  it('hides details of unexpected errors', async () => {
    const consoleError = vi.spyOn(logger, 'error').mockImplementation(vi.fn())

    const res = await request(appThatThrows(new Error('db password is hunter2'))).post(
      '/test',
    )

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
