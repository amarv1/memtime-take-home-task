import express from 'express'
import request from 'supertest'
import { logger } from '../../src/logger.ts'
import { HttpError, errorHandler } from '../../src/middleware/errorHandler.ts'

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

  it('returns 413 for a body over the size limit', async () => {
    const res = await request(appThatThrows(new Error('unreachable')))
      .post('/test')
      .send({ comment: 'x'.repeat(200_000) })

    expect(res.status).toBe(413)
    expect(res.body).toEqual({ error: 'Request body too large' })
  })

  it('uses the status and message of other exposed 4xx errors', async () => {
    const error = Object.assign(new Error('Unprocessable'), { status: 422, expose: true })

    const res = await request(appThatThrows(error)).post('/test')

    expect(res.status).toBe(422)
    expect(res.body).toEqual({ error: 'Unprocessable' })
  })

  it('does not expose the message of a 4xx error that is not marked safe', async () => {
    vi.spyOn(logger, 'error').mockImplementation(vi.fn())
    const error = Object.assign(new Error('internal detail'), { status: 400 })

    const res = await request(appThatThrows(error)).post('/test')

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
    vi.restoreAllMocks()
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
