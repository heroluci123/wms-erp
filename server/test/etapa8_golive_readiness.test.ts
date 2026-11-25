import test from 'node:test'
import assert from 'node:assert/strict'
import { createDbConnection } from '../src/db/client.js'
import { runMigrationsAndSeed } from '../src/db/migrate.js'
import { buildApp } from '../src/app.js'

const TEST_ENV = {
  NODE_ENV: 'test' as const,
  PG_DRIVER: 'pglite' as const,
  PGLITE_DATA_DIR: 'memory://',
  JWT_SECRET: 'test-jwt-secret-etapa8-golive-readiness-check-2026-strong',
  CORS_ORIGIN: 'https://wms-erp-cow3.vercel.app/, https://*.vercel.app',
}

test('Etapa 8: Prontidão Go-Live, /api/health enriquecido, CORS resiliente e /api/system/golive-status', async () => {
  const conn = await createDbConnection(TEST_ENV)
  await runMigrationsAndSeed(conn)
  const app = await buildApp(conn, TEST_ENV)

  try {
    // 1) Healthcheck enriquecido
    const healthRes = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://wms-erp-cow3.vercel.app' },
    })
    assert.equal(healthRes.statusCode, 200)
    const health = healthRes.json()
    assert.equal(health.ok, true)
    assert.equal(health.service, 'wms-erp-server')
    assert.equal(health.driver, 'pglite')
    assert.equal(typeof health.uptime_sec, 'number')
    // CORS deve aceitar origem exata mesmo com trailing slash na config
    assert.equal(healthRes.headers['access-control-allow-origin'], 'https://wms-erp-cow3.vercel.app')

    // 2) CORS wildcard preview da Vercel deve ser aceito e origem desconhecida bloqueada
    const previewRes = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://wms-erp-git-main-preview.vercel.app' },
    })
    assert.equal(previewRes.statusCode, 200)
    assert.equal(previewRes.headers['access-control-allow-origin'], 'https://wms-erp-git-main-preview.vercel.app')

    const evilRes = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://dominio-nao-autorizado.example.com' },
    })
    assert.equal(evilRes.headers['access-control-allow-origin'], undefined)

    // 3) Login MASTER e consulta ao diagnóstico Go-Live
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'Luciano', senha: '7410' },
    })
    assert.equal(loginRes.statusCode, 200)
    const token = loginRes.json().token as string

    const goliveRes = await app.inject({
      method: 'GET',
      url: '/api/system/golive-status',
      headers: { authorization: `Bearer ${token}` },
    })
    assert.equal(goliveRes.statusCode, 200, goliveRes.body)
    const gl = goliveRes.json()
    assert.equal(gl.success, true)
    assert.equal(gl.ambiente.jwt_seguro, true)
    assert.equal(gl.ambiente.driver, 'pglite')
    assert.ok(Array.isArray(gl.checks) && gl.checks.length >= 10)
    assert.ok(gl.score_prontidao_pct >= 0 && gl.score_prontidao_pct <= 100)
    assert.equal(typeof gl.pulso_operacional.caixas_em_estoque, 'number')

    const corsCheck = gl.checks.find((c: any) => c.id === 'cors_producao')
    assert.equal(corsCheck?.status, 'OK')
    const jwtCheck = gl.checks.find((c: any) => c.id === 'jwt_seguro')
    assert.equal(jwtCheck?.status, 'OK')
    const pgCheck = gl.checks.find((c: any) => c.id === 'banco_pg')
    assert.equal(pgCheck?.status, 'ALERTA') // PGlite local deve alertar para trocar para pg em producao
  } finally {
    await app.close()
    await conn.close()
  }
})
