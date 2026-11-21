import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { and, eq, sql } from 'drizzle-orm'
import type { DbConnection } from '../db/client.js'
import { auditoriaAcessos, filiais, operadores, sessoesUsuarios } from '../db/schema/index.js'
import {
  CHAVES_PROIBIDAS_CLIENTE,
  isCliente,
  isMaster,
  sanitizarPermissoes,
  temAlgumaPermissao,
  temPermissao,
  type OperadorAuthContext,
} from '../utils/permissoes.js'
import { uuidv7 } from '../utils/uuid.js'

export interface JwtPayload {
  sub: string
  tid: string
  eid: string
  sid: string
}

export interface RequestAuthContext {
  operador: OperadorAuthContext
  sessionToken: string
  tenantId: string
  empresaId: string
  filialId: string
}

declare module 'fastify' {
  interface FastifyRequest {
    authCtx?: RequestAuthContext
  }
}

export class HttpError extends Error {
  statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
  }
}

export function formatarOperadorResposta(row: typeof operadores.$inferSelect, fallbackFilialId = '') {
  const nivel = String(row.nivel || (Number(row.isAdm) === 1 ? 'ADMINISTRADOR' : 'OPERACIONAL')).toUpperCase()
  const perfil = String(row.perfil || nivel).toUpperCase()
  const filiaisPermitidas = Array.isArray(row.filiaisPermitidasJson)
    ? row.filiaisPermitidasJson.map((x) => String(x)).filter(Boolean)
    : []
  return {
    id: row.id,
    legacy_id: row.legacyId ?? null,
    tenantId: row.tenantId,
    empresaId: row.empresaId,
    filialId: row.filialPadraoId || filiaisPermitidas[0] || fallbackFilialId,
    filiais_permitidas: filiaisPermitidas,
    nome: row.nome,
    login: row.login,
    perfil,
    nivel,
    setor: row.setor || 'Produção',
    is_adm: nivel === 'MASTER' || nivel === 'ADMINISTRADOR' || Number(row.isAdm) === 1 ? 1 : 0,
    ativo: Number(row.ativo ?? 1),
    deve_trocar_senha: Number(row.deveTrocarSenha ?? 0),
    permissoes: sanitizarPermissoes(row.permissoesJson, nivel, perfil),
    ultimo_acesso: row.ultimoAcesso ? row.ultimoAcesso.toISOString() : null,
    criado_por_nome: row.criadoPorNome || null,
    atualizado_por_nome: row.atualizadoPorNome || null,
    created_at: row.createdAt ? row.createdAt.toISOString() : null,
    updated_at: row.updatedAt ? row.updatedAt.toISOString() : null,
  }
}

export async function registrarAuditoria(
  conn: DbConnection,
  params: {
    tenantId: string
    targetUserId?: string | null
    targetUserNome?: string
    acao: string
    detalhesAntes?: unknown
    detalhesDepois?: unknown
    executor?: { id?: string; nome?: string; login?: string } | null
  }
): Promise<void> {
  try {
    const exec = params.executor
    const execNome = exec?.nome
      ? `${exec.nome}${exec.login ? ` (${exec.login})` : ''}`
      : 'Sistema'
    await conn.db.insert(auditoriaAcessos).values({
      id: uuidv7(),
      tenantId: params.tenantId,
      targetUserId: params.targetUserId ?? null,
      targetUserNome: params.targetUserNome ?? '',
      acao: params.acao,
      detalhesAntes: params.detalhesAntes ?? null,
      detalhesDepois: params.detalhesDepois ?? null,
      executorId: exec?.id ?? null,
      executorNome: execNome,
    })
  } catch (err) {
    console.warn('[AUDITORIA] Falha ao gravar auditoria:', (err as Error).message)
  }
}

export function createAuthMiddleware(app: FastifyInstance, conn: DbConnection) {
  async function verifySession(req: FastifyRequest): Promise<RequestAuthContext> {
    if (req.authCtx) return req.authCtx

    let payload: JwtPayload
    try {
      payload = await req.jwtVerify<JwtPayload>()
    } catch {
      throw new HttpError(401, 'Sessao nao autenticada ou token invalido.')
    }

    const rows = await conn.db
      .select({
        op: operadores,
        sessaoAtiva: sessoesUsuarios.ativo,
      })
      .from(sessoesUsuarios)
      .innerJoin(operadores, eq(operadores.id, sessoesUsuarios.operadorId))
      .where(
        and(
          eq(sessoesUsuarios.token, payload.sid),
          eq(sessoesUsuarios.operadorId, payload.sub),
          eq(sessoesUsuarios.tenantId, payload.tid)
        )
      )
      .limit(1)

    const match = rows[0]
    if (!match || Number(match.sessaoAtiva) !== 1 || Number(match.op.ativo) !== 1) {
      throw new HttpError(
        401,
        match && Number(match.op.ativo) !== 1
          ? 'Sua conta foi desativada por um administrador. Acesso encerrado.'
          : 'Sessao expirada ou revogada. Faca login novamente.'
      )
    }

    const filiaisPermitidasOp = Array.isArray(match.op.filiaisPermitidasJson)
      ? match.op.filiaisPermitidasJson.map((x) => String(x)).filter(Boolean)
      : []
    const ehMasterOp = isMaster({ nivel: match.op.nivel, perfil: match.op.perfil })

    let filialId = match.op.filialPadraoId || filiaisPermitidasOp[0] || ''
    if (!ehMasterOp && filiaisPermitidasOp.length > 0 && !filiaisPermitidasOp.includes(filialId)) {
      filialId = filiaisPermitidasOp[0]
    }
    const requestedFilial = String(req.headers['x-filial-id'] || '').trim()
    if (requestedFilial) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestedFilial)) {
        throw new HttpError(400, 'Cabecalho x-filial-id invalido.')
      }
      if (!ehMasterOp && filiaisPermitidasOp.length > 0 && !filiaisPermitidasOp.includes(requestedFilial)) {
        throw new HttpError(403, 'Seu usuario nao possui permissao para acessar esta filial.')
      }
      const fValid = await conn.db
        .select({ id: filiais.id })
        .from(filiais)
        .where(
          and(
            eq(filiais.id, requestedFilial),
            eq(filiais.tenantId, match.op.tenantId),
            eq(filiais.ativo, 1)
          )
        )
        .limit(1)
      if (!fValid[0]) {
        throw new HttpError(403, 'Filial selecionada nao pertence a esta empresa ou esta inativa.')
      }
      filialId = fValid[0].id
    }
    if (!filialId) {
      const fRow = await conn.db
        .select({ id: filiais.id })
        .from(filiais)
        .where(eq(filiais.tenantId, match.op.tenantId))
        .limit(1)
      filialId = fRow[0]?.id || ''
    }

    const formatted = formatarOperadorResposta(match.op, filialId)
    const ctx: RequestAuthContext = {
      operador: formatted,
      sessionToken: payload.sid,
      tenantId: match.op.tenantId,
      empresaId: match.op.empresaId,
      filialId,
    }
    req.authCtx = ctx

    // Ping assincrono sem travar a requisicao
    conn.db
      .update(sessoesUsuarios)
      .set({ ultimoPing: sql`NOW()` })
      .where(eq(sessoesUsuarios.token, payload.sid))
      .catch(() => {})

    return ctx
  }

  function requirePermission(
    permissaoRequerida: string | string[] | null = null,
    opcoes: { write?: boolean; bloquearCliente?: boolean; permitirTrocaSenhaPendente?: boolean } = {}
  ) {
    const {
      write = true,
      bloquearCliente = write,
      permitirTrocaSenhaPendente = false,
    } = opcoes

    return async (req: FastifyRequest, _reply: FastifyReply) => {
      const ctx = await verifySession(req)
      const op = ctx.operador

      if (isMaster(op)) return

      if (!permitirTrocaSenhaPendente && op.deve_trocar_senha === 1) {
        throw new HttpError(403, 'Altere sua senha inicial antes de realizar operacoes no sistema.')
      }

      if (isCliente(op)) {
        if (write || bloquearCliente) {
          throw new HttpError(403, 'Acesso negado: o perfil CLIENTE possui acesso estritamente de consulta.')
        }
        if (typeof permissaoRequerida === 'string' && CHAVES_PROIBIDAS_CLIENTE.has(permissaoRequerida)) {
          throw new HttpError(403, 'Acesso negado: modulo operacional indisponivel para o perfil CLIENTE.')
        }
      }

      if (permissaoRequerida) {
        const ok = Array.isArray(permissaoRequerida)
          ? temAlgumaPermissao(op, permissaoRequerida)
          : temPermissao(op, permissaoRequerida)
        if (!ok) {
          throw new HttpError(403, 'Acesso negado: seu usuario nao possui permissao para esta acao.')
        }
      }
    }
  }

  return { verifySession, requirePermission }
}
