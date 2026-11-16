import 'dotenv/config'
import { z } from 'zod'

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3333),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  JWT_SECRET: z.string().min(16).default('wmsphere-dev-secret-trocar-em-producao-2026'),
  PG_DRIVER: z.enum(['pg', 'pglite']).default('pglite'),
  PGLITE_DATA_DIR: z.string().default('./data/pgdata'),
  DATABASE_URL: z.string().optional().default(''),
  CORS_ORIGIN: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
  TURSO_DATABASE_URL: z.string().optional().default(''),
  TURSO_AUTH_TOKEN: z.string().optional().default(''),
})

export type AppEnv = z.infer<typeof EnvSchema>

export function loadEnv(overrides: Partial<Record<keyof AppEnv, string>> = {}): AppEnv {
  const merged = { ...process.env, ...overrides }
  const parsed = EnvSchema.parse(merged)
  if (parsed.PG_DRIVER === 'pg' && !parsed.DATABASE_URL) {
    throw new Error('DATABASE_URL e obrigatoria quando PG_DRIVER=pg.')
  }
  if (parsed.NODE_ENV === 'production' && parsed.JWT_SECRET.includes('dev-secret')) {
    throw new Error('Defina um JWT_SECRET seguro em producao.')
  }
  return parsed
}

export const env = loadEnv()
