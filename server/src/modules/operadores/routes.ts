import type { FastifyInstance } from 'fastify'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { DbConnection } from '../../db/client.js'
import { auditoriaAcessos, operadores, perfisAcesso, sessoesUsuarios } from '../../db/schema/index.js'
import { gerarSenhaInicial, hashSenha } from '../../utils/crypto.js'
import { isMaster, sanitizarPermissoes } from '../../utils/permissoes.js'
import { uuidv7 } from '../../utils/uuid.js'
import {
  HttpError,
  createAuthMiddleware,
  formatarOperadorResposta,
  registrarAuditoria,
} from '../../middlewares/auth.js'

const CreateOperadorSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome completo.'),
  login: z.string().trim().min(2, 'O login deve ter pelo menos 2 caracteres.'),
  senha: z.string().optional(),
  setor: z.string().trim().optional().default('Produção'),
  perfil: z.string().trim().optional().default('OPERADOR'),
  nivel: z.string().trim().optional().default('OPERACIONAL'),
  deve_trocar_senha: z.union([z.boolean(), z.number()]).optional().default(true),
  ativo: z.union([z.boolean(), z.number()]).optional().default(1),
  permissoes: z.record(z.boolean()).optional(),
  filial_id: z.string().uuid().optional(),
  filial_padrao_id: z.string().uuid().optional(),
  filiais_permitidas: z.array(z.string().uuid()).optional(),
  pin_gerencial: z.string().trim().optional(),
})

const UpdateOperadorSchema = z.object({
  nome: z.string().trim().min(1).optional(),
  login: z.string().trim().min(2).optional(),
  senha: z.string().optional(),
  setor: z.string().trim().optional(),
  perfil: z.string().trim().optional(),
  nivel: z.string().trim().optional(),
  deve_trocar_senha: z.union([z.boolean(), z.number()]).optional(),
  ativo: z.union([z.boolean(), z.number()]).optional(),
  permissoes: z.record(z.boolean()).optional(),
  filial_id: z.string().uuid().nullable().optional(),
  filial_padrao_id: z.string().uuid().nullable().optional(),
  filiais_permitidas: z.array(z.string().uuid()).optional(),
  pin_gerencial: z.string().trim().optional(),
})

const SavePerfilSchema = z.object({
  codigo: z.string().trim().min(2, 'Informe o codigo do perfil.').optional(),
  nome: z.string().trim().min(2, 'Informe o nome do perfil.'),
  nivel: z.string().trim().optional().default('OPERACIONAL'),
  setor_padrao: z.string().trim().optional().default('Produção'),
  descricao: z.string().trim().optional().default(''),
  permissoes: z.record(z.boolean()).optional().default({}),
})

export function registerOperadoresRoutes(app: FastifyInstance, conn: DbConnection) {
  const { requirePermission } = createAuthMiddleware(app, conn)

  app.get(
    '/api/operadores',
    { preHandler: requirePermission('operadores', { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select()
        .from(operadores)
        .where(eq(operadores.tenantId, ctx.tenantId))
      const formatted = rows
        .map((r) => formatarOperadorResposta(r, ctx.filialId))
        .sort((a, b) => {
          const peso = (u: { nivel: string }) =>
            u.nivel === 'MASTER' ? 0 : u.nivel === 'ADMINISTRADOR' ? 1 : u.nivel === 'CLIENTE' ? 3 : 2
          return peso(a) - peso(b) || a.nome.localeCompare(b.nome)
        })
      return { success: true, data: formatted }
    }
  )

  app.post(
    '/api/operadores',
    { preHandler: requirePermission('operadores') },
    async (req, reply) => {
      const ctx = req.authCtx!
      const executor = ctx.operador
      const parsed = CreateOperadorSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
      }

      const d = parsed.data
      const nivel = d.nivel.toUpperCase()
      const perfil = d.perfil.toUpperCase()
      if ((nivel === 'MASTER' || perfil === 'MASTER') && !isMaster(executor)) {
        throw new HttpError(403, 'Apenas o usuario MASTER pode criar outra conta MASTER.')
      }

      const dup = await conn.db
        .select({ id: operadores.id })
        .from(operadores)
        .where(and(eq(operadores.tenantId, ctx.tenantId), sql`LOWER(${operadores.login}) = LOWER(${d.login})`))
        .limit(1)
      if (dup.length > 0) {
        throw new HttpError(409, `Ja existe um usuario com o login "${d.login}".`)
      }

      const senhaInicial = d.senha && d.senha.trim().length > 0 ? d.senha.trim() : gerarSenhaInicial()
      if (senhaInicial.length < 4) {
        throw new HttpError(400, 'A senha inicial deve ter pelo menos 4 caracteres.')
      }

      const permsLimpas = sanitizarPermissoes(d.permissoes || {}, nivel, perfil)
      const isAdm = nivel === 'MASTER' || nivel === 'ADMINISTRADOR' ? 1 : 0
      const ativo = d.ativo === false || Number(d.ativo) === 0 ? 0 : 1
      const deveTrocar = d.deve_trocar_senha === false || Number(d.deve_trocar_senha) === 0 ? 0 : 1
      const senhaHash = await hashSenha(senhaInicial)
      let pinGerencialHash = ''
      if (d.pin_gerencial && d.pin_gerencial.trim().length > 0) {
        if (!/^\d{4,6}$/.test(d.pin_gerencial.trim())) {
          throw new HttpError(400, 'O PIN gerencial deve conter de 4 a 6 dígitos numéricos.')
        }
        pinGerencialHash = await hashSenha(d.pin_gerencial.trim())
      }

      const newId = uuidv7()
      const filiaisPerm = Array.isArray(d.filiais_permitidas)
        ? Array.from(new Set(d.filiais_permitidas.filter(Boolean)))
        : []
      const filialPadrao =
        d.filial_padrao_id || d.filial_id || filiaisPerm[0] || ctx.filialId || null
      if (filialPadrao && filiaisPerm.length > 0 && !filiaisPerm.includes(filialPadrao)) {
        filiaisPerm.unshift(filialPadrao)
      }

      await conn.db.insert(operadores).values({
        id: newId,
        tenantId: ctx.tenantId,
        empresaId: ctx.empresaId,
        filialPadraoId: filialPadrao,
        filiaisPermitidasJson: filiaisPerm,
        nome: d.nome,
        login: d.login,
        pin: '****',
        pinGerencialHash,
        senhaHash,
        perfil,
        nivel,
        setor: d.setor,
        isAdm,
        ativo,
        deveTrocarSenha: deveTrocar,
        permissoesJson: permsLimpas,
        criadoPorNome: executor.nome,
        atualizadoPorNome: executor.nome,
      })

      await registrarAuditoria(conn, {
        tenantId: ctx.tenantId,
        targetUserId: newId,
        targetUserNome: d.nome,
        acao: 'CRIACAO_USUARIO',
        detalhesDepois: { login: d.login, nivel, perfil, setor: d.setor, permissoes: permsLimpas },
        executor,
      })

      return reply.status(201).send({
        success: true,
        id: newId,
        senhaGerada: senhaInicial,
      })
    }
  )

  app.put(
    '/api/operadores/:id',
    { preHandler: requirePermission('operadores') },
    async (req) => {
      const ctx = req.authCtx!
      const executor = ctx.operador
      const { id } = req.params as { id: string }

      const parsed = UpdateOperadorSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
      }

      const existingRows = await conn.db
        .select()
        .from(operadores)
        .where(and(eq(operadores.id, id), eq(operadores.tenantId, ctx.tenantId)))
        .limit(1)
      const atual = existingRows[0]
      if (!atual) throw new HttpError(404, 'Usuario nao encontrado.')

      const atualFmt = formatarOperadorResposta(atual, ctx.filialId)
      if (isMaster(atualFmt) && !isMaster(executor)) {
        throw new HttpError(403, 'Apenas o usuario MASTER pode editar a conta MASTER.')
      }

      const d = parsed.data
      const novoNivel = (d.nivel ?? atualFmt.nivel).toUpperCase()
      const novoPerfil = (d.perfil ?? atualFmt.perfil).toUpperCase()
      if ((novoNivel === 'MASTER' || novoPerfil === 'MASTER') && !isMaster(executor) && !isMaster(atualFmt)) {
        throw new HttpError(403, 'Apenas o usuario MASTER pode promover uma conta ao nivel MASTER.')
      }

      const novoLogin = d.login ?? atualFmt.login
      if (novoLogin.toLowerCase() !== atualFmt.login.toLowerCase()) {
        const dup = await conn.db
          .select({ id: operadores.id })
          .from(operadores)
          .where(and(eq(operadores.tenantId, ctx.tenantId), sql`LOWER(${operadores.login}) = LOWER(${novoLogin})`))
          .limit(1)
        if (dup.length > 0 && dup[0].id !== id) {
          throw new HttpError(409, `O login "${novoLogin}" ja esta em uso por outro usuario.`)
        }
      }

      const permsLimpas = sanitizarPermissoes(d.permissoes ?? atualFmt.permissoes, novoNivel, novoPerfil)
      const isAdm = novoNivel === 'MASTER' || novoNivel === 'ADMINISTRADOR' ? 1 : 0
      const novoAtivo =
        isMaster(atualFmt)
          ? 1
          : d.ativo !== undefined
            ? d.ativo === false || Number(d.ativo) === 0
              ? 0
              : 1
            : atualFmt.ativo

      const updateValues: Partial<typeof operadores.$inferInsert> = {
        nome: d.nome ?? atualFmt.nome,
        login: novoLogin,
        setor: d.setor ?? atualFmt.setor,
        perfil: novoPerfil,
        nivel: novoNivel,
        isAdm,
        ativo: novoAtivo,
        deveTrocarSenha:
          d.deve_trocar_senha !== undefined
            ? d.deve_trocar_senha === true || Number(d.deve_trocar_senha) === 1
              ? 1
              : 0
            : atualFmt.deve_trocar_senha,
        permissoesJson: permsLimpas,
        atualizadoPorNome: executor.nome,
        updatedAt: new Date(),
      }
      if (d.filial_id !== undefined || d.filial_padrao_id !== undefined) {
        updateValues.filialPadraoId = d.filial_padrao_id !== undefined ? d.filial_padrao_id : d.filial_id
      }
      if (d.filiais_permitidas !== undefined) {
        const permList = Array.from(new Set(d.filiais_permitidas.filter(Boolean)))
        updateValues.filiaisPermitidasJson = permList
        if (permList.length > 0) {
          const padraoAtual = (updateValues.filialPadraoId as string | null | undefined) ?? atual.filialPadraoId
          if (!padraoAtual || !permList.includes(padraoAtual)) {
            updateValues.filialPadraoId = permList[0]
          }
        }
      }
      if (d.senha && d.senha.trim().length > 0) {
        if (d.senha.trim().length < 4) {
          throw new HttpError(400, 'A nova senha deve ter pelo menos 4 caracteres.')
        }
        updateValues.senhaHash = await hashSenha(d.senha.trim())
      }
      if (d.pin_gerencial !== undefined && d.pin_gerencial.trim().length > 0) {
        if (!/^\d{4,6}$/.test(d.pin_gerencial.trim())) {
          throw new HttpError(400, 'O PIN gerencial deve conter de 4 a 6 dígitos numéricos.')
        }
        updateValues.pinGerencialHash = await hashSenha(d.pin_gerencial.trim())
      }

      await conn.db
        .update(operadores)
        .set(updateValues)
        .where(and(eq(operadores.id, id), eq(operadores.tenantId, ctx.tenantId)))

      if (novoAtivo === 0) {
        await conn.db
          .update(sessoesUsuarios)
          .set({ ativo: 0, encerradaEm: sql`NOW()` })
          .where(and(eq(sessoesUsuarios.operadorId, id), eq(sessoesUsuarios.tenantId, ctx.tenantId)))
      }

      await registrarAuditoria(conn, {
        tenantId: ctx.tenantId,
        targetUserId: id,
        targetUserNome: updateValues.nome || atualFmt.nome,
        acao: 'EDICAO_USUARIO',
        detalhesAntes: {
          login: atualFmt.login,
          nivel: atualFmt.nivel,
          perfil: atualFmt.perfil,
          ativo: atualFmt.ativo,
        },
        detalhesDepois: {
          login: novoLogin,
          nivel: novoNivel,
          perfil: novoPerfil,
          ativo: novoAtivo,
        },
        executor,
      })

      return { success: true }
    }
  )

  app.patch(
    '/api/operadores/:id/status',
    { preHandler: requirePermission('operadores') },
    async (req) => {
      const ctx = req.authCtx!
      const executor = ctx.operador
      const { id } = req.params as { id: string }
      const body = z.object({ ativo: z.union([z.boolean(), z.number()]) }).parse(req.body)
      const novoAtivo = body.ativo === true || Number(body.ativo) === 1 ? 1 : 0

      const rows = await conn.db
        .select()
        .from(operadores)
        .where(and(eq(operadores.id, id), eq(operadores.tenantId, ctx.tenantId)))
        .limit(1)
      const target = rows[0]
      if (!target) throw new HttpError(404, 'Usuario nao encontrado.')

      const targetFmt = formatarOperadorResposta(target, ctx.filialId)
      if (isMaster(targetFmt) && novoAtivo === 0) {
        throw new HttpError(403, 'A conta MASTER nao pode ser desativada.')
      }
      if (targetFmt.id === executor.id && novoAtivo === 0) {
        throw new HttpError(400, 'Voce nao pode desativar a sua propria conta.')
      }

      await conn.db
        .update(operadores)
        .set({ ativo: novoAtivo, atualizadoPorNome: executor.nome, updatedAt: sql`NOW()` })
        .where(and(eq(operadores.id, id), eq(operadores.tenantId, ctx.tenantId)))

      if (novoAtivo === 0) {
        await conn.db
          .update(sessoesUsuarios)
          .set({ ativo: 0, encerradaEm: sql`NOW()` })
          .where(and(eq(sessoesUsuarios.operadorId, id), eq(sessoesUsuarios.tenantId, ctx.tenantId)))
      }

      await registrarAuditoria(conn, {
        tenantId: ctx.tenantId,
        targetUserId: id,
        targetUserNome: targetFmt.nome,
        acao: novoAtivo === 1 ? 'REATIVACAO_USUARIO' : 'DESATIVACAO_USUARIO',
        detalhesAntes: { ativo: targetFmt.ativo },
        detalhesDepois: { ativo: novoAtivo },
        executor,
      })

      return { success: true }
    }
  )

  app.post(
    '/api/operadores/:id/reset-password',
    { preHandler: requirePermission(['redefinir_senhas', 'operadores']) },
    async (req) => {
      const ctx = req.authCtx!
      const executor = ctx.operador
      const { id } = req.params as { id: string }
      const body = z
        .object({
          novaSenha: z.string().optional(),
          exigirTroca: z.union([z.boolean(), z.number()]).optional().default(true),
        })
        .parse(req.body || {})

      const rows = await conn.db
        .select()
        .from(operadores)
        .where(and(eq(operadores.id, id), eq(operadores.tenantId, ctx.tenantId)))
        .limit(1)
      const target = rows[0]
      if (!target) throw new HttpError(404, 'Usuario nao encontrado.')
      const targetFmt = formatarOperadorResposta(target, ctx.filialId)

      if (isMaster(targetFmt) && !isMaster(executor)) {
        throw new HttpError(403, 'Apenas o usuario MASTER pode redefinir a senha da conta MASTER.')
      }

      const senhaFinal = body.novaSenha && body.novaSenha.trim().length > 0 ? body.novaSenha.trim() : gerarSenhaInicial()
      if (senhaFinal.length < 4) {
        throw new HttpError(400, 'A senha deve possuir pelo menos 4 caracteres.')
      }

      const novoHash = await hashSenha(senhaFinal)
      const exigir = body.exigirTroca === false || Number(body.exigirTroca) === 0 ? 0 : 1

      await conn.db
        .update(operadores)
        .set({
          senhaHash: novoHash,
          deveTrocarSenha: exigir,
          atualizadoPorNome: executor.nome,
          updatedAt: sql`NOW()`,
        })
        .where(and(eq(operadores.id, id), eq(operadores.tenantId, ctx.tenantId)))

      await registrarAuditoria(conn, {
        tenantId: ctx.tenantId,
        targetUserId: id,
        targetUserNome: targetFmt.nome,
        acao: 'REDEFINICAO_SENHA',
        detalhesDepois: { exigirTroca: Boolean(exigir) },
        executor,
      })

      return { success: true, senhaTemporaria: senhaFinal }
    }
  )

  app.delete(
    '/api/operadores/:id',
    { preHandler: requirePermission('operadores') },
    async (req) => {
      const ctx = req.authCtx!
      const executor = ctx.operador
      const { id } = req.params as { id: string }

      const rows = await conn.db
        .select()
        .from(operadores)
        .where(and(eq(operadores.id, id), eq(operadores.tenantId, ctx.tenantId)))
        .limit(1)
      const target = rows[0]
      if (!target) throw new HttpError(404, 'Usuario nao encontrado.')
      const targetFmt = formatarOperadorResposta(target, ctx.filialId)

      if (isMaster(targetFmt)) {
        throw new HttpError(403, 'A conta MASTER nao pode ser excluida.')
      }
      if (targetFmt.id === executor.id) {
        throw new HttpError(400, 'Voce nao pode excluir a sua propria conta.')
      }

      await conn.db
        .delete(sessoesUsuarios)
        .where(and(eq(sessoesUsuarios.operadorId, id), eq(sessoesUsuarios.tenantId, ctx.tenantId)))
      await conn.db
        .delete(operadores)
        .where(and(eq(operadores.id, id), eq(operadores.tenantId, ctx.tenantId)))

      await registrarAuditoria(conn, {
        tenantId: ctx.tenantId,
        targetUserId: id,
        targetUserNome: targetFmt.nome,
        acao: 'EXCLUSAO_USUARIO',
        detalhesAntes: { login: targetFmt.login, nivel: targetFmt.nivel },
        executor,
      })

      return { success: true }
    }
  )

  app.get(
    '/api/perfis',
    { preHandler: requirePermission(['operadores', 'perfis_gerenciar'], { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select()
        .from(perfisAcesso)
        .where(eq(perfisAcesso.tenantId, ctx.tenantId))
      return {
        success: true,
        data: rows.map((r) => ({
          id: r.id,
          codigo: r.codigo,
          nome: r.nome,
          nivel: r.nivel,
          setor_padrao: r.setorPadrao,
          descricao: r.descricao,
          permissoes: sanitizarPermissoes(r.permissoesJson, r.nivel, r.codigo),
          sistema_fixo: Number(r.sistemaFixo || 0),
        })),
      }
    }
  )

  app.post(
    '/api/perfis',
    { preHandler: requirePermission('perfis_gerenciar') },
    async (req) => {
      const ctx = req.authCtx!
      const executor = ctx.operador
      const d = SavePerfilSchema.parse(req.body)
      const codigo = (d.codigo || d.nome)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_]+/g, '_')

      if (codigo === 'MASTER' && !isMaster(executor)) {
        throw new HttpError(403, 'Apenas o usuario MASTER pode alterar o perfil MASTER.')
      }

      const nivel = d.nivel.toUpperCase()
      const permsLimpas = sanitizarPermissoes(d.permissoes, nivel, codigo)

      const existing = await conn.db
        .select()
        .from(perfisAcesso)
        .where(and(eq(perfisAcesso.tenantId, ctx.tenantId), eq(perfisAcesso.codigo, codigo)))
        .limit(1)

      if (existing[0]) {
        await conn.db
          .update(perfisAcesso)
          .set({
            nome: d.nome,
            nivel,
            setorPadrao: d.setor_padrao,
            descricao: d.descricao,
            permissoesJson: permsLimpas,
            updatedAt: sql`NOW()`,
          })
          .where(eq(perfisAcesso.id, existing[0].id))
      } else {
        await conn.db.insert(perfisAcesso).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          codigo,
          nome: d.nome,
          nivel,
          setorPadrao: d.setor_padrao,
          descricao: d.descricao,
          permissoesJson: permsLimpas,
          sistemaFixo: 0,
        })
      }

      await registrarAuditoria(conn, {
        tenantId: ctx.tenantId,
        targetUserNome: d.nome,
        acao: existing[0] ? 'EDICAO_PERFIL' : 'CRIACAO_PERFIL',
        detalhesDepois: { codigo, nome: d.nome, nivel },
        executor,
      })

      return { success: true, codigo }
    }
  )

  app.delete(
    '/api/perfis/:codigo',
    { preHandler: requirePermission('perfis_gerenciar') },
    async (req) => {
      const ctx = req.authCtx!
      const { codigo } = req.params as { codigo: string }

      const rows = await conn.db
        .select()
        .from(perfisAcesso)
        .where(and(eq(perfisAcesso.tenantId, ctx.tenantId), eq(perfisAcesso.codigo, codigo)))
        .limit(1)
      if (!rows[0]) throw new HttpError(404, 'Perfil nao encontrado.')
      if (Number(rows[0].sistemaFixo) === 1) {
        throw new HttpError(403, 'Perfis padrao do sistema nao podem ser excluidos.')
      }

      await conn.db.delete(perfisAcesso).where(eq(perfisAcesso.id, rows[0].id))
      return { success: true }
    }
  )

  app.get(
    '/api/auditoria-acessos',
    { preHandler: requirePermission('operadores', { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const query = req.query as { limite?: string }
      const lim = Math.min(Math.max(Number(query.limite) || 120, 1), 500)
      const rows = await conn.db
        .select()
        .from(auditoriaAcessos)
        .where(eq(auditoriaAcessos.tenantId, ctx.tenantId))
        .orderBy(desc(auditoriaAcessos.createdAt))
        .limit(lim)
      return { success: true, data: rows }
    }
  )
}
