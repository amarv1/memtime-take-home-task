import { createApp } from './app.ts'
import { loadEnv } from './env.ts'
import { registerGracefulShutdown } from './shutdown.ts'

const env = loadEnv()

const server = createApp().listen(env.PORT, () => {
  console.info(`Server listening on http://localhost:${env.PORT}`)
})

registerGracefulShutdown(server)
