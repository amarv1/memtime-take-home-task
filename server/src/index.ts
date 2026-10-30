import { createApp } from './app.ts'
import { loadEnv } from './env.ts'

const env = loadEnv()

const server = createApp().listen(env.PORT, () => {
  console.info(`Server listening on http://localhost:${env.PORT}`)
})

function shutdown() {
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
