import winston from 'winston'
import { currentRequestId } from './requestId.ts'

/**
 * Shared application logger. Console only for now; add transports here.
 * Lines written while handling a request carry its id. Silent under test so expected errors don't clutter the output, and the level
 * is set from `LOG_LEVEL` at startup (see index.ts).
 */
export const logger = winston.createLogger({
  level: 'info',
  silent: process.env.NODE_ENV === 'test',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format((info) => {
      const requestId = currentRequestId()
      if (requestId) info.requestId = requestId
      return info
    })(),
    winston.format.json(),
  ),
  transports: [new winston.transports.Console()],
})
