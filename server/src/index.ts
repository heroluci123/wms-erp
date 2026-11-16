import { env } from './config/env.js'
import { createDbConnection } from './db/client.js'
import { runMigrationsAndSeed } from './db/migrate.js'
import { buildApp } from './app.js'

async function main() {
  const conn = await createDbConnection()
  await runMigrationsAndSeed(conn)
  const app = await buildApp(conn)

  const shutdown = async () => {
    await app.close()
    await conn.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  await app.listen({ port: env.PORT, host: env.HOST })
  console.log(`[WMS-API] Rodando em http://${env.HOST}:${env.PORT} (driver: ${conn.driver})`)
}

main().catch((err) => {
  console.error('[WMS-API] Falha fatal ao iniciar:', err)
  process.exit(1)
})
