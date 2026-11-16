import { createDbConnection } from '../db/client.js'
import { runMigrationsAndSeed } from '../db/migrate.js'

async function main() {
  const conn = await createDbConnection()
  try {
    const res = await runMigrationsAndSeed(conn)
    console.log('[DB] Migrations e seed concluidos com sucesso:', JSON.stringify(res))
  } finally {
    await conn.close()
  }
}

main().catch((err) => {
  console.error('[DB] Erro ao rodar migrations:', err)
  process.exit(1)
})
