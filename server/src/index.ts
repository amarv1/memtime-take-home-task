import { createApp } from './app.ts'
import { loadEnv } from './env.ts'
import { createSessionStore } from './sessions/sessionStore.ts'
import { registerGracefulShutdown } from './shutdown.ts'

const env = loadEnv()
const sessionStore = createSessionStore({ ttlMs: env.SESSION_TTL_MS })

const server = createApp({ env, sessionStore }).listen(env.PORT, () => {
  console.info(`Server listening on http://localhost:${env.PORT}`)
})

registerGracefulShutdown(server)
