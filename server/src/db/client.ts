import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from './schema/index.js'
import { env, type AppEnv } from '../config/env.js'

export type AppDatabase = NodePgDatabase<typeof schema>

export interface DbConnection {
  db: AppDatabase
  driver: 'pg' | 'pglite'
  execMulti: (sqlText: string) => Promise<void>
  queryRaw: <T = Record<string, unknown>>(sqlText: string, params?: unknown[]) => Promise<T[]>
  close: () => Promise<void>
}

export async function createDbConnection(customEnv: Partial<AppEnv> = {}): Promise<DbConnection> {
  const cfg = { ...env, ...customEnv }

  if (cfg.PG_DRIVER === 'pg') {
    if (!cfg.DATABASE_URL) {
      throw new Error('DATABASE_URL e obrigatoria quando PG_DRIVER=pg.')
    }
    const needsSsl = !/localhost|127\.0\.0\.1/i.test(cfg.DATABASE_URL)
    const pool = new pg.Pool({
      connectionString: cfg.DATABASE_URL,
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
      max: 10,
    })
    const db = drizzlePg(pool, { schema })
    return {
      db,
      driver: 'pg',
      execMulti: async (sqlText: string) => {
        await pool.query(sqlText)
      },
      queryRaw: async <T = Record<string, unknown>>(sqlText: string, params: unknown[] = []) => {
        const res = await pool.query(sqlText, params)
        return res.rows as T[]
      },
      close: async () => {
        await pool.end()
      },
    }
  }

  // Modo PGlite (PostgreSQL real em processo para desenvolvimento local e testes automatizados)
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle: drizzlePglite } = await import('drizzle-orm/pglite')

  const dataDir = cfg.PGLITE_DATA_DIR || './data/pgdata'
  if (dataDir !== 'memory://' && !dataDir.startsWith('idb://')) {
    fs.mkdirSync(path.resolve(dataDir), { recursive: true })
  }

  const pgLiteClient = dataDir === 'memory://' ? new PGlite() : new PGlite(path.resolve(dataDir))
  await pgLiteClient.waitReady
  const db = drizzlePglite(pgLiteClient, { schema }) as unknown as AppDatabase

  return {
    db,
    driver: 'pglite',
    execMulti: async (sqlText: string) => {
      await pgLiteClient.exec(sqlText)
    },
    queryRaw: async <T = Record<string, unknown>>(sqlText: string, params: unknown[] = []) => {
      const res = await pgLiteClient.query(sqlText, params)
      return (res.rows || []) as T[]
    },
    close: async () => {
      await pgLiteClient.close()
    },
  }
}
