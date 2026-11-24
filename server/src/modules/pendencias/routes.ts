import type { FastifyInstance } from 'fastify'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { DbConnection } from '../../db/client.js'
import { pendenciasSetor } from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import { parseUuidOrBadRequest } from '../wms/helpers.js'

const SETORES_VALIDOS = [
  'SUPPLY_CHAIN',
  'PCP',
  'CAMARA_FRIA',
  'LOGISTICA',
  'FATURAMENTO',
  'FINANCEIRO',
] as const

const CreatePendenciaSchema = z.object({
  setor_destino: z.enum(SETORES_VALIDOS),
  tipo_pendencia: z.string().trim().min(1),
  referencia_tabela: z.string().trim().min(1).default('manual'),
  referencia_id: z.string().uuid().optional(),
  titulo: z.string().trim().min(1, 'Informe o título da pendência.'),
  prioridade: z.coerce.number().int().min(1).max(5).default(2),
})

export function registerPendenciasRoutes(app: FastifyInstance, conn: DbConnection): void {
  const { requirePermission } = createAuthMiddleware(app, conn)

  app.get(
    '/api/pendencias',
    { preHandler: requirePermission(null, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = req.query as { setor?: string; status?: string }
      const setor = String(q.setor || 'TODOS').trim().toUpperCase()
      const statusFiltro = String(q.status || 'ATIVAS').trim().toUpperCase()

      const [todas, aoVivoRes] = await Promise.all([
        conn.db
          .select()
          .from(pendenciasSetor)
          .where(and(eq(pendenciasSetor.tenantId, ctx.tenantId), eq(pendenciasSetor.filialId, ctx.filialId)))
          .orderBy(desc(pendenciasSetor.prioridade), desc(pendenciasSetor.createdAt))
          .limit(300),
        conn.db.execute(sql`
          SELECT
            (SELECT COUNT(*)::int FROM whatsapp_inbox wi WHERE wi.tenant_id = ${ctx.tenantId} AND wi.status = 'PENDENTE') AS whatsapp_pendentes,
            (SELECT COUNT(*)::int FROM pedidos p WHERE p.tenant_id = ${ctx.tenantId} AND p.filial_id = ${ctx.filialId} AND p.origem_pedido = 'FINANCEIRO' AND p.status = 'RASCUNHO') AS pedidos_financeiro,
            (SELECT COUNT(*)::int FROM pedidos p WHERE p.tenant_id = ${ctx.tenantId} AND p.filial_id = ${ctx.filialId} AND p.status = 'BLOQUEADO_ESTOQUE') AS pedidos_trava_estoque,
            (SELECT COUNT(*)::int FROM pedidos p WHERE p.tenant_id = ${ctx.tenantId} AND p.filial_id = ${ctx.filialId} AND p.status = 'BLOQUEADO_COMERCIAL') AS pedidos_trava_comercial,
            (SELECT COUNT(*)::int FROM pedidos p WHERE p.tenant_id = ${ctx.tenantId} AND p.filial_id = ${ctx.filialId} AND p.status IN ('LIBERADO', 'EM_SEPARACAO')) AS pedidos_separacao,
            (SELECT COUNT(*)::int FROM romaneios r WHERE r.tenant_id = ${ctx.tenantId} AND r.filial_id = ${ctx.filialId} AND r.status IN ('AGUARDANDO_CONFERENCIA', 'EM_CONFERENCIA')) AS romaneios_conferencia,
            (SELECT COUNT(*)::int FROM ordens_producao op WHERE op.tenant_id = ${ctx.tenantId} AND op.filial_id = ${ctx.filialId} AND op.status IN ('RASCUNHO', 'LIBERADA', 'ABERTA')) AS ops_pendentes,
            (SELECT COUNT(*)::int FROM pedidos p WHERE p.tenant_id = ${ctx.tenantId} AND p.filial_id = ${ctx.filialId} AND p.pagamento_na_entrega = 1 AND p.status NOT IN ('CANCELADO')) AS pedidos_pgto_entrega,
            (SELECT COUNT(*)::int FROM recebimentos rec WHERE rec.tenant_id = ${ctx.tenantId} AND rec.filial_id = ${ctx.filialId} AND rec.status_validacao IN ('AGUARDANDO_VALIDACAO_SISTEMICA', 'DIVERGENTE')) AS recebimentos_validacao,
            (SELECT COUNT(*)::int FROM produto_arvore pa WHERE pa.tenant_id = ${ctx.tenantId} AND pa.confirmado = 0) AS arvore_pendentes
        `),
      ])

      const live = (aoVivoRes.rows[0] || {}) as Record<string, unknown>

      const contadores: Record<string, number> = {
        SUPPLY_CHAIN: 0,
        PCP: 0,
        CAMARA_FRIA: 0,
        LOGISTICA: 0,
        FATURAMENTO: 0,
        FINANCEIRO: 0,
        TOTAL_ATIVAS: 0,
      }

      for (const p of todas) {
        if (p.status !== 'CONCLUIDA') {
          contadores[p.setorDestino] = (contadores[p.setorDestino] || 0) + 1
          contadores.TOTAL_ATIVAS += 1
        }
      }

      const filtradas = todas.filter((p) => {
        if (setor !== 'TODOS' && p.setorDestino !== setor) return false
        if (statusFiltro === 'ATIVAS') return p.status !== 'CONCLUIDA'
        if (statusFiltro !== 'TODOS') return p.status === statusFiltro
        return true
      })

      return {
        success: true,
        contadores,
        filaAoVivo: {
          whatsapp_pendentes: Number(live.whatsapp_pendentes || 0),
          pedidos_financeiro: Number(live.pedidos_financeiro || 0),
          pedidos_trava_estoque: Number(live.pedidos_trava_estoque || 0),
          pedidos_trava_comercial: Number(live.pedidos_trava_comercial || 0),
          pedidos_separacao: Number(live.pedidos_separacao || 0),
          romaneios_conferencia: Number(live.romaneios_conferencia || 0),
          ops_pendentes: Number(live.ops_pendentes || 0),
          pedidos_pgto_entrega: Number(live.pedidos_pgto_entrega || 0),
          recebimentos_validacao: Number(live.recebimentos_validacao || 0),
          arvore_pendentes: Number(live.arvore_pendentes || 0),
        },
        data: filtradas.map((p) => ({
          id: p.id,
          filial_id: p.filialId,
          setor_destino: p.setorDestino,
          tipo_pendencia: p.tipoPendencia,
          referencia_tabela: p.referenciaTabela,
          referencia_id: p.referenciaId,
          titulo: p.titulo,
          prioridade: p.prioridade,
          status: p.status,
          concluida_por_id: p.concluidaPorId,
          concluida_at: p.concluidaAt,
          created_at: p.createdAt,
        })),
      }
    }
  )

  app.post(
    '/api/pendencias',
    { preHandler: requirePermission(['pedidos', 'financeiro_pedidos', 'recebimento', 'compras', 'producao_criar_op', 'mapa_producao', 'saida', 'expedicao']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const parsed = CreatePendenciaSchema.safeParse(req.body)
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
      const d = parsed.data
      const id = uuidv7()
      await conn.db.insert(pendenciasSetor).values({
        id,
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        setorDestino: d.setor_destino,
        tipoPendencia: d.tipo_pendencia,
        referenciaTabela: d.referencia_tabela,
        referenciaId: d.referencia_id || id,
        titulo: d.titulo,
        prioridade: d.prioridade,
        status: 'PENDENTE',
      })
      return reply.status(201).send({ success: true, id })
    }
  )

  app.patch(
    '/api/pendencias/:id/status',
    { preHandler: requirePermission(null, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'pendencia_id')
      const status = String((req.body as { status?: string })?.status || '').trim().toUpperCase()
      if (!['PENDENTE', 'EM_ATENDIMENTO', 'CONCLUIDA'].includes(status)) {
        throw new HttpError(400, 'Status de pendência inválido.')
      }

      const [atual] = await conn.db
        .select()
        .from(pendenciasSetor)
        .where(and(eq(pendenciasSetor.id, id), eq(pendenciasSetor.tenantId, ctx.tenantId)))
        .limit(1)
      if (!atual) throw new HttpError(404, 'Pendência não encontrada.')

      await conn.db
        .update(pendenciasSetor)
        .set({
          status,
          concluidaPorId: status === 'CONCLUIDA' ? ctx.operador.id : null,
          concluidaAt: status === 'CONCLUIDA' ? new Date() : null,
        })
        .where(eq(pendenciasSetor.id, id))

      return { success: true, status }
    }
  )
}
