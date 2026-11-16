import type { FastifyInstance } from 'fastify'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { DbConnection } from '../../db/client.js'
import { empresas, filiais, operadores, sessoesUsuarios, tenants } from '../../db/schema/index.js'
import { gerarTokenSessao, hashSenha, verificarSenha } from '../../utils/crypto.js'
import { uuidv7 } from '../../utils/uuid.js'
import { isMaster } from '../../utils/permissoes.js'
import {
  HttpError,
  createAuthMiddleware,
  formatarOperadorResposta,
  registrarAuditoria,
} from '../../middlewares/auth.js'

const LoginSchema = z.object({
  login: z.string().trim().min(1, 'Informe o usuario (login).'),
  senha: z.string().min(1, 'Informe sua senha.'),
  tenantSlug: z.string().trim().optional(),
  deviceInfo: z.string().trim().optional(),
})

const ChangePasswordSchema = z.object({
  senhaAtual: z.string().min(1, 'Informe a senha atual.'),
  novaSenha: z.string().min(4, 'A nova senha deve possuir pelo menos 4 caracteres.'),
})

export function registerAuthRoutes(app: FastifyInstance, conn: DbConnection) {
  const { verifySession, requirePermission } = createAuthMiddleware(app, conn)

  async function carregarContextoTenant(tenantId: string, empresaId: string) {
    const [tenantRows, empRows, filialRows] = await Promise.all([
      conn.db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1),
      conn.db.select().from(empresas).where(eq(empresas.id, empresaId)).limit(1),
      conn.db
        .select()
        .from(filiais)
        .where(and(eq(filiais.tenantId, tenantId), eq(filiais.ativo, 1))),
    ])
    return {
      tenant: tenantRows[0] || null,
      empresa: empRows[0] || null,
      filiais: filialRows,
    }
  }

  app.post('/api/auth/login', async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados de login invalidos.')
    }

    const { login, senha, tenantSlug, deviceInfo } = parsed.data
    let tenantFilterId: string | null = null
    if (tenantSlug) {
      const tRow = await conn.db.select().from(tenants).where(eq(tenants.slug, tenantSlug)).limit(1)
      if (!tRow[0]) {
        return reply.status(401).send({ success: false, error: 'Usuario ou senha incorretos.' })
      }
      tenantFilterId = tRow[0].id
    }

    const whereClause = tenantFilterId
      ? and(eq(operadores.tenantId, tenantFilterId), sql`LOWER(${operadores.login}) = LOWER(${login})`)
      : sql`LOWER(${operadores.login}) = LOWER(${login})`

    const rows = await conn.db.select().from(operadores).where(whereClause).limit(10)
    if (rows.length === 0) {
      return reply.status(401).send({ success: false, error: 'Usuario ou senha incorretos.' })
    }

    let row: (typeof rows)[0] | null = null
    let senhaValida = false
    for (const candidate of rows) {
      if (await verificarSenha(senha, candidate.senhaHash)) {
        row = candidate
        senhaValida = true
        break
      }
    }

    if (!senhaValida) {
      const onlyInactive = rows.length === 1 && Number(rows[0].ativo) !== 1
      if (onlyInactive) {
        return reply
          .status(403)
          .send({ success: false, error: 'Esta conta esta desativada. Procure o administrador.' })
      }
      return reply.status(401).send({ success: false, error: 'Usuario ou senha incorretos.' })
    }

    if (!row || Number(row.ativo) !== 1) {
      return reply
        .status(403)
        .send({ success: false, error: 'Esta conta esta desativada. Procure o administrador.' })
    }

    const sessionToken = gerarTokenSessao()
    await conn.db.insert(sessoesUsuarios).values({
      id: uuidv7(),
      tenantId: row.tenantId,
      operadorId: row.id,
      token: sessionToken,
      deviceInfo: deviceInfo || 'web',
      ativo: 1,
    })

    await conn.db
      .update(operadores)
      .set({ ultimoAcesso: sql`NOW()` })
      .where(eq(operadores.id, row.id))

    const contexto = await carregarContextoTenant(row.tenantId, row.empresaId)
    const filialFallback =
      contexto.filiais.find((f) => f.isPadrao === 1)?.id || contexto.filiais[0]?.id || ''
    const opFmt = formatarOperadorResposta(row, filialFallback)

    const jwtToken = app.jwt.sign(
      {
        sub: row.id,
        tid: row.tenantId,
        eid: row.empresaId,
        sid: sessionToken,
      },
      { expiresIn: '12h' }
    )

    await registrarAuditoria(conn, {
      tenantId: row.tenantId,
      targetUserId: row.id,
      targetUserNome: row.nome,
      acao: 'LOGIN',
      detalhesDepois: { login: opFmt.login, nivel: opFmt.nivel, setor: opFmt.setor },
      executor: opFmt,
    })

    return {
      success: true,
      token: jwtToken,
      sessionToken,
      operador: opFmt,
      contexto,
    }
  })

  app.post('/api/auth/logout', async (req) => {
    try {
      const ctx = await verifySession(req)
      await conn.db
        .update(sessoesUsuarios)
        .set({ ativo: 0, encerradaEm: sql`NOW()` })
        .where(eq(sessoesUsuarios.token, ctx.sessionToken))
    } catch {
      // Logout sempre idempotente
    }
    return { success: true }
  })

  app.get('/api/auth/me', async (req) => {
    const ctx = await verifySession(req)
    const contexto = await carregarContextoTenant(ctx.tenantId, ctx.empresaId)
    return {
      success: true,
      operador: ctx.operador,
      contexto,
    }
  })

  app.post(
    '/api/auth/change-password',
    { preHandler: requirePermission(null, { write: false, bloquearCliente: false, permitirTrocaSenhaPendente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const op = ctx.operador

      if (!isMaster(op) && op.permissoes?.alterar_propria_senha === false && op.deve_trocar_senha !== 1) {
        throw new HttpError(
          403,
          'Seu usuario nao esta autorizado a alterar a propria senha. Solicite ao administrador.'
        )
      }

      const parsed = ChangePasswordSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
      }
      const { senhaAtual, novaSenha } = parsed.data
      if (novaSenha === senhaAtual) {
        throw new HttpError(400, 'A nova senha deve ser diferente da senha atual.')
      }

      const rows = await conn.db
        .select({ senhaHash: operadores.senhaHash })
        .from(operadores)
        .where(and(eq(operadores.id, op.id), eq(operadores.tenantId, ctx.tenantId)))
        .limit(1)

      const ok = await verificarSenha(senhaAtual, rows[0]?.senhaHash)
      if (!ok) {
        throw new HttpError(400, 'Senha atual incorreta.')
      }

      const novoHash = await hashSenha(novaSenha)
      await conn.db
        .update(operadores)
        .set({
          senhaHash: novoHash,
          deveTrocarSenha: 0,
          atualizadoPorNome: op.nome,
          updatedAt: sql`NOW()`,
        })
        .where(and(eq(operadores.id, op.id), eq(operadores.tenantId, ctx.tenantId)))

      await registrarAuditoria(conn, {
        tenantId: ctx.tenantId,
        targetUserId: op.id,
        targetUserNome: op.nome,
        acao: 'TROCA_PROPRIA_SENHA',
        executor: op,
      })

      return { success: true }
    }
  )
}
