import type { FastifyInstance } from 'fastify'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DbConnection } from '../../db/client.js'
import {
  centrosCusto,
  estoqueCaixas,
  formasPagamento,
  fornecedores,
  marchantes,
  naturezasOperacao,
  pedidosCompra,
  pedidosCompraItens,
  pendenciasSetor,
  produtos,
  recebimentoPreCaixas,
  recebimentos,
  tenants,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import {
  gerarCodigoDocumento,
  lerTenantFeatures,
  normalizarDataIso,
  parseUuidOrBadRequest,
  sugerirCfopOperacao,
  toDec,
  toNum,
} from '../wms/helpers.js'

const PERM_COMPRA_READ = ['compras', 'fornecedores', 'recebimento', 'recebimento_consultar', 'pedidos']

interface CompraItemInput {
  produto_id: string
  qtd_kg_solicitada: number
  preco_unitario_kg?: number
  cfop_aplicado?: string
}

async function prepararItensCompra(
  tx: Parameters<Parameters<DbConnection['db']['transaction']>[0]>[0],
  params: {
    tenantId: string
    filialId: string
    fornecedorUf: string
    naturezaId?: string | null
    finalidade?: string
    itens: CompraItemInput[]
  },
) {
  if (!Array.isArray(params.itens) || params.itens.length === 0) {
    throw new HttpError(400, 'Informe ao menos um item no Pedido de Compra.')
  }
  const cfopInfo = await sugerirCfopOperacao(tx, {
    tenantId: params.tenantId,
    filialId: params.filialId,
    tipoMovimento: 'ENTRADA',
    finalidade: params.finalidade || 'MATERIA_PRIMA',
    ufParceiro: params.fornecedorUf,
    naturezaId: params.naturezaId,
  })

  const consolidado = new Map<string, { produtoId: string; qtd: number; preco: number; cfop: string }>()
  for (const it of params.itens) {
    const pid = parseUuidOrBadRequest(it.produto_id, 'produto_id')
    const qtd = toNum(it.qtd_kg_solicitada, 0)
    if (!Number.isFinite(qtd) || qtd <= 0) {
      throw new HttpError(400, 'Quantidade solicitada (kg) deve ser maior que zero.')
    }
    const preco = Math.max(0, toNum(it.preco_unitario_kg, 0))
    const cfop = String(it.cfop_aplicado || cfopInfo?.cfop || '').trim()
    const prev = consolidado.get(pid)
    if (prev) {
      prev.qtd = Number((prev.qtd + qtd).toFixed(3))
      if (preco > 0) prev.preco = preco
    } else {
      consolidado.set(pid, { produtoId: pid, qtd: Number(qtd.toFixed(3)), preco, cfop })
    }
  }

  return {
    naturezaIdResolvida: cfopInfo?.natureza_id || params.naturezaId || null,
    cfopSugerido: cfopInfo?.cfop || '',
    itens: Array.from(consolidado.values()),
  }
}

export function registerComprasRoutes(app: FastifyInstance, conn: DbConnection): void {
  const { requirePermission } = createAuthMiddleware(app, conn)

  // Configurações de trava/módulos do tenant (consumida por Compras, Recebimento e Roteirização)
  app.get(
    '/api/configuracoes/modulos',
    { preHandler: requirePermission(null, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const raw = await lerTenantFeatures(conn.db, ctx.tenantId)
      return {
        success: true,
        data: {
          trava_recebimento_sem_pc: Boolean(raw.trava_recebimento_sem_pc),
          rastreio_motorista_ativo: raw.rastreio_motorista_ativo !== false,
          impressao_romaneio_padrao:
            String(raw.impressao_romaneio_padrao || 'OPCAO_B') === 'OPCAO_A' ? 'OPCAO_A' : 'OPCAO_B',
        },
      }
    },
  )

  app.patch(
    '/api/configuracoes/modulos',
    { preHandler: requirePermission(['compras', 'roteirizacao', 'configurar_sistema', 'parametros_comerciais']) },
    async (req) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        trava_recebimento_sem_pc?: boolean
        rastreio_motorista_ativo?: boolean
        impressao_romaneio_padrao?: string
      }
      const atual = await lerTenantFeatures(conn.db, ctx.tenantId)
      const next: Record<string, unknown> = { ...atual }
      if (body.trava_recebimento_sem_pc !== undefined) {
        next.trava_recebimento_sem_pc = Boolean(body.trava_recebimento_sem_pc)
      }
      if (body.rastreio_motorista_ativo !== undefined) {
        next.rastreio_motorista_ativo = Boolean(body.rastreio_motorista_ativo)
      }
      if (body.impressao_romaneio_padrao !== undefined) {
        next.impressao_romaneio_padrao = body.impressao_romaneio_padrao === 'OPCAO_A' ? 'OPCAO_A' : 'OPCAO_B'
      }

      await conn.db
        .update(tenants)
        .set({ featuresJson: next as Record<string, boolean>, updatedAt: new Date() })
        .where(eq(tenants.id, ctx.tenantId))

      return { success: true, data: next }
    },
  )

  // Pedidos de Compra liberados para o operador selecionar na doca (Recebimento)
  app.get(
    '/api/recebimento/pedidos-liberados',
    { preHandler: requirePermission(['recebimento', 'recebimento_consultar', 'compras'], { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const features = await lerTenantFeatures(conn.db, ctx.tenantId)
      const pcs = await conn.db
        .select({
          id: pedidosCompra.id,
          codigo: pedidosCompra.codigo,
          status: pedidosCompra.status,
          previsao_entrega: pedidosCompra.previsaoEntrega,
          fornecedor_id: pedidosCompra.fornecedorId,
          fornecedor_nome: fornecedores.nomeFantasia,
          fornecedor_sif: fornecedores.registroSanitarioSif,
          valor_total: pedidosCompra.valorTotal,
        })
        .from(pedidosCompra)
        .innerJoin(fornecedores, eq(fornecedores.id, pedidosCompra.fornecedorId))
        .where(
          and(
            eq(pedidosCompra.tenantId, ctx.tenantId),
            eq(pedidosCompra.filialId, ctx.filialId),
            inArray(pedidosCompra.status, ['APROVADO', 'PARCIAL']),
          ),
        )
        .orderBy(desc(pedidosCompra.createdAt))

      const pcIds = pcs.map((p) => p.id)
      const itensRes =
        pcIds.length > 0
          ? await conn.db
              .select({
                id: pedidosCompraItens.id,
                pedido_compra_id: pedidosCompraItens.pedidoCompraId,
                produto_id: pedidosCompraItens.produtoId,
                produto_codigo: produtos.codigo,
                produto_descricao: produtos.descricao,
                qtd_kg_solicitada: pedidosCompraItens.qtdKgSolicitada,
                qtd_kg_recebida: pedidosCompraItens.qtdKgRecebida,
                preco_unitario_kg: pedidosCompraItens.precoUnitarioKg,
              })
              .from(pedidosCompraItens)
              .innerJoin(produtos, eq(produtos.id, pedidosCompraItens.produtoId))
              .where(inArray(pedidosCompraItens.pedidoCompraId, pcIds))
          : []

      const recRes =
        pcIds.length > 0
          ? await conn.db
              .select({
                id: recebimentos.id,
                codigo: recebimentos.codigo,
                pedido_compra_id: recebimentos.pedidoCompraId,
                status_validacao: recebimentos.statusValidacao,
                numero_nf: recebimentos.numeroNf,
              })
              .from(recebimentos)
              .where(inArray(recebimentos.pedidoCompraId, pcIds))
          : []

      return {
        success: true,
        trava_recebimento_sem_pc: Boolean(features.trava_recebimento_sem_pc),
        data: pcs.map((pc) => {
          const its = itensRes
            .filter((i) => i.pedido_compra_id === pc.id)
            .map((i) => ({
              ...i,
              qtd_kg_solicitada: toNum(i.qtd_kg_solicitada, 0),
              qtd_kg_recebida: toNum(i.qtd_kg_recebida, 0),
              preco_unitario_kg: toNum(i.preco_unitario_kg, 0),
            }))
          const rec = recRes.find((r) => r.pedido_compra_id === pc.id) || null
          return {
            ...pc,
            valor_total: toNum(pc.valor_total, 0),
            recebimento: rec,
            itens: its,
          }
        }),
      }
    },
  )

  app.get(
    '/api/compras',
    { preHandler: requirePermission(PERM_COMPRA_READ, { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = req.query as { status?: string; busca?: string }
      const conds = [eq(pedidosCompra.tenantId, ctx.tenantId), eq(pedidosCompra.filialId, ctx.filialId)]
      if (q.status && q.status !== 'TODOS') {
        conds.push(eq(pedidosCompra.status, String(q.status).toUpperCase()))
      }
      if (q.busca && q.busca.trim()) {
        const pat = `%${q.busca.trim().toUpperCase()}%`
        conds.push(
          sql`(UPPER(${pedidosCompra.codigo}) LIKE ${pat} OR UPPER(${fornecedores.nomeFantasia}) LIKE ${pat} OR UPPER(${pedidosCompra.marchante}) LIKE ${pat})`,
        )
      }

      const [features, rows] = await Promise.all([
        lerTenantFeatures(conn.db, ctx.tenantId),
        conn.db
          .select({
            id: pedidosCompra.id,
            codigo: pedidosCompra.codigo,
            status: pedidosCompra.status,
            fornecedor_id: pedidosCompra.fornecedorId,
            fornecedor_nome: fornecedores.nomeFantasia,
            fornecedor_razao: fornecedores.razaoSocial,
            fornecedor_uf: fornecedores.uf,
            fornecedor_sif: fornecedores.registroSanitarioSif,
            natureza_id: pedidosCompra.naturezaId,
            natureza_descricao: naturezasOperacao.descricao,
            centro_custo_id: pedidosCompra.centroCustoId,
            centro_custo_descricao: centrosCusto.descricao,
            forma_pagamento_id: pedidosCompra.formaPagamentoId,
            forma_pagamento_descricao: formasPagamento.descricao,
            marchante: pedidosCompra.marchante,
            frete_valor: pedidosCompra.freteValor,
            despesas_valor: pedidosCompra.despesasValor,
            valor_total: pedidosCompra.valorTotal,
            previsao_entrega: pedidosCompra.previsaoEntrega,
            observacoes: pedidosCompra.observacoes,
            created_at: pedidosCompra.createdAt,
            qtd_itens: sql<number>`(SELECT COUNT(*)::int FROM pedidos_compra_itens pci WHERE pci.pedido_compra_id = "pedidos_compra"."id")`,
            total_kg_solicitada: sql<string>`COALESCE((SELECT ROUND(SUM(pci.qtd_kg_solicitada), 3) FROM pedidos_compra_itens pci WHERE pci.pedido_compra_id = "pedidos_compra"."id"), 0)`,
            total_kg_recebida: sql<string>`COALESCE((SELECT ROUND(SUM(pci.qtd_kg_recebida), 3) FROM pedidos_compra_itens pci WHERE pci.pedido_compra_id = "pedidos_compra"."id"), 0)`,
            recebimento_id: sql<string | null>`(SELECT r.id FROM recebimentos r WHERE r.pedido_compra_id = "pedidos_compra"."id" ORDER BY r.created_at DESC LIMIT 1)`,
            recebimento_codigo: sql<string | null>`(SELECT r.codigo FROM recebimentos r WHERE r.pedido_compra_id = "pedidos_compra"."id" ORDER BY r.created_at DESC LIMIT 1)`,
            status_validacao: sql<string | null>`(SELECT r.status_validacao FROM recebimentos r WHERE r.pedido_compra_id = "pedidos_compra"."id" ORDER BY r.created_at DESC LIMIT 1)`,
          })
          .from(pedidosCompra)
          .innerJoin(fornecedores, eq(fornecedores.id, pedidosCompra.fornecedorId))
          .leftJoin(naturezasOperacao, eq(naturezasOperacao.id, pedidosCompra.naturezaId))
          .leftJoin(centrosCusto, eq(centrosCusto.id, pedidosCompra.centroCustoId))
          .leftJoin(formasPagamento, eq(formasPagamento.id, pedidosCompra.formaPagamentoId))
          .where(and(...conds))
          .orderBy(desc(pedidosCompra.createdAt)),
      ])

      return {
        success: true,
        trava_recebimento_sem_pc: Boolean(features.trava_recebimento_sem_pc),
        data: rows.map((r) => ({
          ...r,
          frete_valor: toNum(r.frete_valor, 0),
          despesas_valor: toNum(r.despesas_valor, 0),
          valor_total: toNum(r.valor_total, 0),
          total_kg_solicitada: toNum(r.total_kg_solicitada, 0),
          total_kg_recebida: toNum(r.total_kg_recebida, 0),
        })),
      }
    },
  )

  app.get(
    '/api/compras/:id',
    { preHandler: requirePermission(PERM_COMPRA_READ, { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'pedido_compra_id')

      const [pc] = await conn.db
        .select({
          id: pedidosCompra.id,
          codigo: pedidosCompra.codigo,
          status: pedidosCompra.status,
          fornecedor_id: pedidosCompra.fornecedorId,
          fornecedor_nome: fornecedores.nomeFantasia,
          fornecedor_uf: fornecedores.uf,
          fornecedor_sif: fornecedores.registroSanitarioSif,
          natureza_id: pedidosCompra.naturezaId,
          natureza_descricao: naturezasOperacao.descricao,
          centro_custo_id: pedidosCompra.centroCustoId,
          centro_custo_descricao: centrosCusto.descricao,
          forma_pagamento_id: pedidosCompra.formaPagamentoId,
          forma_pagamento_descricao: formasPagamento.descricao,
          marchante: pedidosCompra.marchante,
          frete_valor: pedidosCompra.freteValor,
          despesas_valor: pedidosCompra.despesasValor,
          valor_total: pedidosCompra.valorTotal,
          previsao_entrega: pedidosCompra.previsaoEntrega,
          observacoes: pedidosCompra.observacoes,
          created_at: pedidosCompra.createdAt,
        })
        .from(pedidosCompra)
        .innerJoin(fornecedores, eq(fornecedores.id, pedidosCompra.fornecedorId))
        .leftJoin(naturezasOperacao, eq(naturezasOperacao.id, pedidosCompra.naturezaId))
        .leftJoin(centrosCusto, eq(centrosCusto.id, pedidosCompra.centroCustoId))
        .leftJoin(formasPagamento, eq(formasPagamento.id, pedidosCompra.formaPagamentoId))
        .where(and(eq(pedidosCompra.id, id), eq(pedidosCompra.tenantId, ctx.tenantId)))
        .limit(1)
      if (!pc) throw new HttpError(404, 'Pedido de Compra não encontrado.')

      const [itens, recs] = await Promise.all([
        conn.db
          .select({
            id: pedidosCompraItens.id,
            produto_id: pedidosCompraItens.produtoId,
            produto_codigo: produtos.codigo,
            produto_descricao: produtos.descricao,
            unidade: produtos.unidade,
            qtd_kg_solicitada: pedidosCompraItens.qtdKgSolicitada,
            preco_unitario_kg: pedidosCompraItens.precoUnitarioKg,
            qtd_kg_recebida: pedidosCompraItens.qtdKgRecebida,
            cfop_aplicado: pedidosCompraItens.cfopAplicado,
          })
          .from(pedidosCompraItens)
          .innerJoin(produtos, eq(produtos.id, pedidosCompraItens.produtoId))
          .where(eq(pedidosCompraItens.pedidoCompraId, id)),
        conn.db
          .select()
          .from(recebimentos)
          .where(and(eq(recebimentos.pedidoCompraId, id), eq(recebimentos.tenantId, ctx.tenantId)))
          .orderBy(desc(recebimentos.createdAt)),
      ])

      const recPrincipal = recs[0] || null
      const [caixasBipadas, preCaixasRows] = await Promise.all([
        recPrincipal
          ? conn.db
              .select({
                id: estoqueCaixas.id,
                ean_caixa: estoqueCaixas.eanCaixa,
                produto_id: estoqueCaixas.produtoId,
                peso_kg: estoqueCaixas.pesoKg,
                lote: estoqueCaixas.lote,
                custo_unitario_kg: estoqueCaixas.custoUnitarioKg,
              })
              .from(estoqueCaixas)
              .where(eq(estoqueCaixas.recebimentoId, recPrincipal.id))
          : Promise.resolve([]),
        conn.db
          .select({ status: recebimentoPreCaixas.status, peso: recebimentoPreCaixas.pesoLiquidoKg })
          .from(recebimentoPreCaixas)
          .where(and(eq(recebimentoPreCaixas.pedidoCompraId, id), eq(recebimentoPreCaixas.tenantId, ctx.tenantId))),
      ])

      return {
        success: true,
        data: {
          ...pc,
          frete_valor: toNum(pc.frete_valor, 0),
          despesas_valor: toNum(pc.despesas_valor, 0),
          valor_total: toNum(pc.valor_total, 0),
          itens: itens.map((it) => ({
            ...it,
            qtd_kg_solicitada: toNum(it.qtd_kg_solicitada, 0),
            preco_unitario_kg: toNum(it.preco_unitario_kg, 0),
            qtd_kg_recebida: toNum(it.qtd_kg_recebida, 0),
          })),
          recebimento: recPrincipal,
          pre_caixas_resumo: {
            total: preCaixasRows.length,
            pendentes: preCaixasRows.filter((p) => p.status === 'PENDENTE').length,
            bipadas: preCaixasRows.filter((p) => p.status === 'BIPADA').length,
            peso_total_kg: Number(preCaixasRows.reduce((s, p) => s + toNum(p.peso, 0), 0).toFixed(3)),
          },
          caixas_bipadas: caixasBipadas.map((c) => ({
            ...c,
            peso_kg: toNum(c.peso_kg, 0),
            custo_unitario_kg: toNum(c.custo_unitario_kg, 0),
          })),
        },
      }
    },
  )

  app.post('/api/compras', { preHandler: requirePermission('compras') }, async (req, reply) => {
    const ctx = req.authCtx!
    const body = (req.body || {}) as {
      fornecedor_id: string
      natureza_id?: string | null
      finalidade?: string
      centro_custo_id?: string | null
      forma_pagamento_id?: string | null
      marchante?: string
      frete_valor?: number
      despesas_valor?: number
      previsao_entrega?: string | null
      observacoes?: string
      aprovar?: boolean
      itens: CompraItemInput[]
    }

    const fornecedorId = parseUuidOrBadRequest(body.fornecedor_id, 'fornecedor_id')
    const frete = Math.max(0, toNum(body.frete_valor, 0))
    const despesas = Math.max(0, toNum(body.despesas_valor, 0))

    const created = await conn.db.transaction(async (tx) => {
      const [forn] = await tx
        .select()
        .from(fornecedores)
        .where(and(eq(fornecedores.id, fornecedorId), eq(fornecedores.tenantId, ctx.tenantId)))
        .limit(1)
      if (!forn) throw new HttpError(404, 'Fornecedor não encontrado.')

      let centroCustoIdFinal = body.centro_custo_id
        ? parseUuidOrBadRequest(body.centro_custo_id, 'centro_custo_id')
        : null
      if (!centroCustoIdFinal) {
        const [ccPadrao] = await tx
          .select({ id: centrosCusto.id })
          .from(centrosCusto)
          .where(and(eq(centrosCusto.tenantId, ctx.tenantId), eq(centrosCusto.ativo, 1)))
          .limit(1)
        centroCustoIdFinal = ccPadrao?.id || null
      }

      const prep = await prepararItensCompra(tx, {
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        fornecedorUf: forn.uf,
        naturezaId: body.natureza_id ? parseUuidOrBadRequest(body.natureza_id, 'natureza_id') : null,
        finalidade: body.finalidade,
        itens: body.itens,
      })

      const totalItens = prep.itens.reduce((s, it) => s + it.qtd * it.preco, 0)
      const valorTotal = Number((totalItens + frete + despesas).toFixed(2))
      const codigo = await gerarCodigoDocumento(tx, ctx.tenantId, 'PEDIDO_COMPRA', 'PC', 4)
      const id = uuidv7()
      const status = body.aprovar === false ? 'ABERTO' : 'APROVADO'

      let marchanteFinal = String(body.marchante || '').trim()
      if (!marchanteFinal) {
        const [defMarc] = await tx
          .select({ nome: marchantes.nome })
          .from(marchantes)
          .where(and(eq(marchantes.tenantId, ctx.tenantId), eq(marchantes.ativo, 1)))
          .orderBy(desc(marchantes.isPadrao))
          .limit(1)
        marchanteFinal = defMarc?.nome || 'FRIGODIL'
      }

      await tx.insert(pedidosCompra).values({
        id,
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        codigo,
        fornecedorId,
        naturezaId: prep.naturezaIdResolvida,
        centroCustoId: centroCustoIdFinal,
        formaPagamentoId: body.forma_pagamento_id ? parseUuidOrBadRequest(body.forma_pagamento_id, 'forma_pagamento_id') : null,
        compradorId: ctx.operador.id,
        marchante: marchanteFinal,
        freteValor: toDec(frete, 2),
        despesasValor: toDec(despesas, 2),
        valorTotal: toDec(valorTotal, 2),
        previsaoEntrega: normalizarDataIso(body.previsao_entrega),
        observacoes: String(body.observacoes || '').trim(),
        status,
      })

      await tx.insert(pedidosCompraItens).values(
        prep.itens.map((it) => ({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          pedidoCompraId: id,
          produtoId: it.produtoId,
          qtdKgSolicitada: toDec(it.qtd, 3),
          precoUnitarioKg: toDec(it.preco, 4),
          qtdKgRecebida: '0.000',
          cfopAplicado: it.cfop,
        })),
      )

      return { id, codigo, status, cfop_sugerido: prep.cfopSugerido, valor_total: valorTotal }
    })

    return reply.status(201).send({ success: true, ...created })
  })

  app.post('/api/compras/:id/aprovar', { preHandler: requirePermission('compras') }, async (req) => {
    const ctx = req.authCtx!
    const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'pedido_compra_id')
    const [pc] = await conn.db
      .select({ status: pedidosCompra.status })
      .from(pedidosCompra)
      .where(and(eq(pedidosCompra.id, id), eq(pedidosCompra.tenantId, ctx.tenantId)))
      .limit(1)
    if (!pc) throw new HttpError(404, 'Pedido de Compra não encontrado.')
    if (pc.status === 'CANCELADO' || pc.status === 'RECEBIDO') {
      throw new HttpError(400, `Não é possível aprovar pedido com status ${pc.status}.`)
    }
    await conn.db
      .update(pedidosCompra)
      .set({ status: 'APROVADO', updatedAt: new Date() })
      .where(eq(pedidosCompra.id, id))
    return { success: true, status: 'APROVADO' }
  })

  app.post('/api/compras/:id/cancelar', { preHandler: requirePermission('compras') }, async (req) => {
    const ctx = req.authCtx!
    const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'pedido_compra_id')
    await conn.db.transaction(async (tx) => {
      const [pc] = await tx
        .select()
        .from(pedidosCompra)
        .where(and(eq(pedidosCompra.id, id), eq(pedidosCompra.tenantId, ctx.tenantId)))
        .limit(1)
      if (!pc) throw new HttpError(404, 'Pedido de Compra não encontrado.')
      const itens = await tx.select().from(pedidosCompraItens).where(eq(pedidosCompraItens.pedidoCompraId, id))
      if (itens.some((i) => toNum(i.qtdKgRecebida, 0) > 0)) {
        throw new HttpError(400, 'Já existem caixas recebidas neste Pedido de Compra.')
      }
      await tx.update(pedidosCompra).set({ status: 'CANCELADO', updatedAt: new Date() }).where(eq(pedidosCompra.id, id))
    })
    return { success: true }
  })

  // Doca finaliza bipagem do recebimento e envia para validação sistêmica do Supply Chain (3-Way match)
  app.post(
    '/api/compras/:id/enviar-validacao',
    { preHandler: requirePermission(['recebimento', 'compras']) },
    async (req) => {
      const ctx = req.authCtx!
      const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'pedido_compra_id')
      const body = (req.body || {}) as { numero_nf?: string; chave_nfe?: string }

      const out = await conn.db.transaction(async (tx) => {
        const [pc] = await tx
          .select()
          .from(pedidosCompra)
          .where(and(eq(pedidosCompra.id, id), eq(pedidosCompra.tenantId, ctx.tenantId)))
          .limit(1)
        if (!pc) throw new HttpError(404, 'Pedido de Compra não encontrado.')

        const itens = await tx.select().from(pedidosCompraItens).where(eq(pedidosCompraItens.pedidoCompraId, id))
        const totalSolic = itens.reduce((s, i) => s + toNum(i.qtdKgSolicitada, 0), 0)
        const totalRec = itens.reduce((s, i) => s + toNum(i.qtdKgRecebida, 0), 0)
        const difPct = totalSolic > 0 ? Math.abs(totalRec - totalSolic) / totalSolic : 0
        const divergente = totalRec <= 0 || difPct > 0.03
        const statusValidacao = divergente ? 'DIVERGENTE' : 'AGUARDANDO_VALIDACAO_SISTEMICA'

        const [recExist] = await tx
          .select()
          .from(recebimentos)
          .where(and(eq(recebimentos.pedidoCompraId, id), eq(recebimentos.tenantId, ctx.tenantId)))
          .limit(1)

        let recId = recExist?.id
        let recCod = recExist?.codigo
        if (!recExist) {
          recId = uuidv7()
          recCod = await gerarCodigoDocumento(tx, ctx.tenantId, 'RECEBIMENTO', 'REC', 4)
          await tx.insert(recebimentos).values({
            id: recId,
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            codigo: recCod,
            pedidoCompraId: id,
            fornecedorId: pc.fornecedorId,
            numeroNf: String(body.numero_nf || '').trim(),
            chaveNfe: String(body.chave_nfe || '').trim(),
            statusValidacao,
          })
        } else {
          await tx
            .update(recebimentos)
            .set({
              statusValidacao,
              numeroNf: body.numero_nf ? String(body.numero_nf).trim() : recExist.numeroNf,
              chaveNfe: body.chave_nfe ? String(body.chave_nfe).trim() : recExist.chaveNfe,
            })
            .where(eq(recebimentos.id, recExist.id))
        }

        await tx.insert(pendenciasSetor).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          setorDestino: 'SUPPLY_CHAIN',
          tipoPendencia: 'VALIDACAO_RECEBIMENTO',
          referenciaTabela: 'pedidos_compra',
          referenciaId: id,
          titulo: `${pc.codigo} (${recCod}) — ${divergente ? 'Divergência Peso/Pedido ⚠️' : 'Aguardando Validação 3-Way'}`,
          prioridade: divergente ? 4 : 2,
          status: 'PENDENTE',
        })

        return {
          recebimento_id: recId,
          recebimento_codigo: recCod,
          status_validacao: statusValidacao,
          total_solicitada_kg: Number(totalSolic.toFixed(3)),
          total_recebida_kg: Number(totalRec.toFixed(3)),
        }
      })

      return { success: true, ...out }
    },
  )

  // Supply Chain aprova validação sistêmica 3-Way (Pedido × NF/Frete × Pesagem) e atualiza custo médio
  app.post('/api/compras/:id/validar-sistemica', { preHandler: requirePermission('compras') }, async (req) => {
    const ctx = req.authCtx!
    const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'pedido_compra_id')
    const body = (req.body || {}) as { encerrar_pc?: boolean }

    const result = await conn.db.transaction(async (tx) => {
      const [pc] = await tx
        .select()
        .from(pedidosCompra)
        .where(and(eq(pedidosCompra.id, id), eq(pedidosCompra.tenantId, ctx.tenantId)))
        .limit(1)
      if (!pc) throw new HttpError(404, 'Pedido de Compra não encontrado.')

      const itens = await tx.select().from(pedidosCompraItens).where(eq(pedidosCompraItens.pedidoCompraId, id))
      const totalRec = itens.reduce((s, i) => s + toNum(i.qtdKgRecebida, 0), 0)
      const extrasTotal = toNum(pc.freteValor, 0) + toNum(pc.despesasValor, 0)
      const rateioKgExtra = totalRec > 0 ? extrasTotal / totalRec : 0

      // Atualiza custo efetivo (preço unitário + rateio de frete/despesas) no produto
      for (const it of itens) {
        const preco = toNum(it.precoUnitarioKg, 0)
        if (preco > 0) {
          const custoComFrete = Number((preco + rateioKgExtra).toFixed(4))
          await tx
            .update(produtos)
            .set({ custoMedioKg: toDec(custoComFrete, 4), updatedAt: new Date() })
            .where(and(eq(produtos.id, it.produtoId), eq(produtos.tenantId, ctx.tenantId)))
        }
      }

      await tx
        .update(recebimentos)
        .set({
          statusValidacao: 'VALIDADO',
          validadoPorId: ctx.operador.id,
          validadoAt: new Date(),
        })
        .where(and(eq(recebimentos.pedidoCompraId, id), eq(recebimentos.tenantId, ctx.tenantId)))

      const novoStatusPc = body.encerrar_pc === false ? 'PARCIAL' : 'RECEBIDO'
      await tx
        .update(pedidosCompra)
        .set({ status: novoStatusPc, updatedAt: new Date() })
        .where(eq(pedidosCompra.id, id))

      await tx
        .update(pendenciasSetor)
        .set({ status: 'CONCLUIDA', concluidaPorId: ctx.operador.id, concluidaAt: new Date() })
        .where(
          and(
            eq(pendenciasSetor.tenantId, ctx.tenantId),
            eq(pendenciasSetor.referenciaId, id),
            sql`${pendenciasSetor.status} != 'CONCLUIDA'`,
          ),
        )

      return { status: novoStatusPc, total_recebida_kg: Number(totalRec.toFixed(3)) }
    })

    return { success: true, ...result }
  })
}
