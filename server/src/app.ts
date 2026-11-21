import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import fastifyJwt from '@fastify/jwt'
import type { DbConnection } from './db/client.js'
import { env, type AppEnv } from './config/env.js'
import { HttpError } from './middlewares/auth.js'
import { registerAuthRoutes } from './modules/auth/routes.js'
import { registerOperadoresRoutes } from './modules/operadores/routes.js'
import { registerCadastrosRoutes } from './modules/cadastros/routes.js'
import { registerEstoqueRoutes } from './modules/estoque/routes.js'
import { registerProducaoRoutes } from './modules/producao/routes.js'
import { registerInventarioRoutes } from './modules/inventario/routes.js'
import { registerPedidosRoutes } from './modules/pedidos/routes.js'
import { registerRelatoriosRoutes } from './modules/relatorios/routes.js'
import { registerPendenciasRoutes } from './modules/pendencias/routes.js'
import { registerWhatsappRoutes } from './modules/whatsapp/routes.js'
import { registerComprasRoutes } from './modules/compras/routes.js'
import { registerNfeTxtRoutes } from './modules/compras/nfeTxtRoutes.js'
import { registerMapaProducaoRoutes } from './modules/producao/mapaRoutes.js'
import { registerDevolucaoRoutes } from './modules/pedidos/devolucaoRoutes.js'
import { registerRoteirizacaoRoutes } from './modules/pedidos/roteirizacaoRoutes.js'
import { registerFinanceiroRoutes } from './modules/financeiro/routes.js'
import { registerDreRoutes } from './modules/financeiro/dreRoutes.js'
import { registerFiscalRoutes } from './modules/fiscal/routes.js'
import { registerInterunidadesRoutes } from './modules/interunidades/routes.js'
import { registerVarejoRoutes } from './modules/varejo/routes.js'
import { registerInsumosRoutes } from './modules/insumos/routes.js'

export async function buildApp(
  conn: DbConnection,
  customEnv: Partial<AppEnv> = {}
): Promise<FastifyInstance> {
  const cfg = { ...env, ...customEnv }
  const app = Fastify({
    logger: cfg.NODE_ENV === 'production',
    bodyLimit: 10 * 1024 * 1024,
  })

  const allowedOrigins = cfg.CORS_ORIGIN.split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  await app.register(cors, {
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  })

  await app.register(fastifyJwt, {
    secret: cfg.JWT_SECRET,
  })

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ success: false, error: err.message })
    }
    const e = err as { code?: string; message?: string; statusCode?: number }
    if (e.code === '23505') {
      return reply.status(409).send({ success: false, error: 'Registro duplicado ja existente.' })
    }
    if (e.code === '23503') {
      return reply.status(400).send({ success: false, error: 'Referencia de cadastro invalida ou em uso.' })
    }
    const status = e.statusCode && e.statusCode >= 400 ? e.statusCode : 500
    if (status >= 500) {
      app.log.error(err)
      if (cfg.NODE_ENV !== 'production') {
        console.error('[WMS-API ERR 500]', err)
      }
    }
    return reply.status(status).send({
      success: false,
      error: status >= 500 ? 'Erro interno no servidor.' : e.message || 'Erro na requisicao.',
    })
  })

  app.get('/api/health', async () => {
    const res = await conn.queryRaw<{ ok: number }>('SELECT 1 AS ok')
    return {
      ok: Number(res[0]?.ok) === 1,
      driver: conn.driver,
      service: 'wms-erp-server',
      timestamp: new Date().toISOString(),
    }
  })

  registerAuthRoutes(app, conn)
  registerOperadoresRoutes(app, conn)
  registerCadastrosRoutes(app, conn)
  registerEstoqueRoutes(app, conn)
  registerProducaoRoutes(app, conn)
  registerInventarioRoutes(app, conn)
  registerPedidosRoutes(app, conn)
  registerRelatoriosRoutes(app, conn)
  registerPendenciasRoutes(app, conn)
  registerWhatsappRoutes(app, conn)
  registerComprasRoutes(app, conn)
  registerNfeTxtRoutes(app, conn)
  registerMapaProducaoRoutes(app, conn)
  registerDevolucaoRoutes(app, conn)
  registerRoteirizacaoRoutes(app, conn)
  registerFinanceiroRoutes(app, conn)
  registerDreRoutes(app, conn)
  registerFiscalRoutes(app, conn)
  registerInterunidadesRoutes(app, conn)
  registerVarejoRoutes(app, conn)
  registerInsumosRoutes(app, conn)

  return app
}
