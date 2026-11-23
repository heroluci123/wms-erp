import type { FastifyInstance } from 'fastify'
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
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
import { gerarTitulosCompraOuXml } from '../financeiro/integracaoHelper.js'
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

  // Configurações de trava/módulos do tenant (consumida por Compras, Recebimento, Expedição e Roteirização)
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
          exigir_temperatura_recebimento: Boolean(raw.exigir_temperatura_recebimento),
          exigir_nf_para_expedir: Boolean(raw.exigir_nf_para_expedir),
          controlar_estoque_insumos: Boolean(raw.controlar_estoque_insumos),
          permitir_carga_inicial_emporio: raw.permitir_carga_inicial_emporio !== false,
          padrao_balanca_loja: String(raw.padrao_balanca_loja || 'AUTO').toUpperCase(),
          tolerancia_recebimento_pct:
            raw.tolerancia_recebimento_pct != null && Number.isFinite(Number(raw.tolerancia_recebimento_pct))
              ? Number(raw.tolerancia_recebimento_pct)
              : 3,
        },
      }
    },
  )

  app.patch(
    '/api/configuracoes/modulos',
    {
      preHandler: requirePermission([
        'compras',
        'roteirizacao',
        'configurar_sistema',
        'parametros_comerciais',
        'fiscal',
        'varejo_acougue',
        'insumos_coleta',
      ]),
    },
    async (req) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        trava_recebimento_sem_pc?: boolean
        rastreio_motorista_ativo?: boolean
        impressao_romaneio_padrao?: string
        exigir_temperatura_recebimento?: boolean
        exigir_nf_para_expedir?: boolean
        controlar_estoque_insumos?: boolean
        permitir_carga_inicial_emporio?: boolean
        padrao_balanca_loja?: string
        tolerancia_recebimento_pct?: number
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
      if (body.exigir_temperatura_recebimento !== undefined) {
        next.exigir_temperatura_recebimento = Boolean(body.exigir_temperatura_recebimento)
      }
      if (body.exigir_nf_para_expedir !== undefined) {
        next.exigir_nf_para_expedir = Boolean(body.exigir_nf_para_expedir)
      }
      if (body.controlar_estoque_insumos !== undefined) {
        next.controlar_estoque_insumos = Boolean(body.controlar_estoque_insumos)
      }
      if (body.permitir_carga_inicial_emporio !== undefined) {
        next.permitir_carga_inicial_emporio = Boolean(body.permitir_carga_inicial_emporio)
      }
      if (body.padrao_balanca_loja !== undefined) {
        const permitidos = ['AUTO', 'TOLEDO_PRECO_4', 'TOLEDO_PRECO_5', 'TOLEDO_PESO_4', 'TOLEDO_PESO_5']
        const cand = String(body.padrao_balanca_loja || 'AUTO').toUpperCase()
        next.padrao_balanca_loja = permitidos.includes(cand) ? cand : 'AUTO'
      }
      if (body.tolerancia_recebimento_pct !== undefined) {
        const tol = Math.min(25, Math.max(0, Number(body.tolerancia_recebimento_pct)))
        if (Number.isFinite(tol)) next.tolerancia_recebimento_pct = tol
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
        .leftJoin(fornecedores, eq(fornecedores.id, pedidosCompra.fornecedorId))
        .where(
          and(
            eq(pedidosCompra.tenantId, ctx.tenantId),
            eq(pedidosCompra.filialId, ctx.filialId),
            inArray(pedidosCompra.status, ['APROVADO', 'PARCIAL']),
          ),
        )
        .orderBy(desc(pedidosCompra.createdAt))

      const pcIds = pcs.map((p) => p.id)
      const fornIds = Array.from(new Set(pcs.map((p) => p.fornecedor_id).filter((id): id is string => Boolean(id))))
      const [itensRes, recRes, prePoolRes] = await Promise.all([
        pcIds.length > 0
          ? conn.db
              .select({
                id: pedidosCompraItens.id,
                pedido_compra_id: pedidosCompraItens.pedidoCompraId,
                produto_id: pedidosCompraItens.produtoId,
                produto_codigo: produtos.codigo,
                produto_descricao: produtos.descricao,
                qtd_kg_solicitada: pedidosCompraItens.qtdKgSolicitada,
                qtd_kg_recebida: pedidosCompraItens.qtdKgRecebida,
                preco_unitario_kg: pedidosCompraItens.precoUnitarioKg,
                temperatura_c: pedidosCompraItens.temperaturaC,
                temperatura_registrada_em: pedidosCompraItens.temperaturaRegistradaEm,
                temperatura_registrada_por: pedidosCompraItens.temperaturaRegistradaPor,
              })
              .from(pedidosCompraItens)
              .innerJoin(produtos, eq(produtos.id, pedidosCompraItens.produtoId))
              .where(inArray(pedidosCompraItens.pedidoCompraId, pcIds))
          : Promise.resolve([]),
        pcIds.length > 0
          ? conn.db
              .select({
                id: recebimentos.id,
                codigo: recebimentos.codigo,
                pedido_compra_id: recebimentos.pedidoCompraId,
                status_validacao: recebimentos.statusValidacao,
                numero_nf: recebimentos.numeroNf,
              })
              .from(recebimentos)
              .where(inArray(recebimentos.pedidoCompraId, pcIds))
          : Promise.resolve([]),
        fornIds.length > 0
          ? conn.db
              .select({
                fornecedor_id: recebimentoPreCaixas.fornecedorId,
                pedido_compra_id: recebimentoPreCaixas.pedidoCompraId,
              })
              .from(recebimentoPreCaixas)
              .where(
                and(
                  eq(recebimentoPreCaixas.tenantId, ctx.tenantId),
                  eq(recebimentoPreCaixas.status, 'PENDENTE'),
                  or(
                    inArray(recebimentoPreCaixas.fornecedorId, fornIds),
                    pcIds.length > 0 ? inArray(recebimentoPreCaixas.pedidoCompraId, pcIds) : sql`false`,
                  ),
                ),
              )
          : Promise.resolve([]),
      ])

      const recIds = recRes.map((r) => r.id)
      const cxContagens =
        recIds.length > 0
          ? await conn.db
              .select({
                recebimento_id: estoqueCaixas.recebimentoId,
                produto_id: estoqueCaixas.produtoId,
                qtd: sql<number>`COUNT(*)::int`,
              })
              .from(estoqueCaixas)
              .where(inArray(estoqueCaixas.recebimentoId, recIds))
              .groupBy(estoqueCaixas.recebimentoId, estoqueCaixas.produtoId)
          : []

      const tolPadrao =
        features.tolerancia_recebimento_pct != null && Number.isFinite(Number(features.tolerancia_recebimento_pct))
          ? Number(features.tolerancia_recebimento_pct)
          : 3

      return {
        success: true,
        trava_recebimento_sem_pc: Boolean(features.trava_recebimento_sem_pc),
        exigir_temperatura_recebimento: Boolean(features.exigir_temperatura_recebimento),
        tolerancia_recebimento_pct: tolPadrao,
        data: pcs.map((pc) => {
          const rec = recRes.find((r) => r.pedido_compra_id === pc.id) || null
          const its = itensRes
            .filter((i) => i.pedido_compra_id === pc.id)
            .map((i) => {
              const cxRow = rec
                ? cxContagens.find((c) => c.recebimento_id === rec.id && c.produto_id === i.produto_id)
                : null
              return {
                ...i,
                qtd_kg_solicitada: toNum(i.qtd_kg_solicitada, 0),
                qtd_kg_recebida: toNum(i.qtd_kg_recebida, 0),
                preco_unitario_kg: toNum(i.preco_unitario_kg, 0),
                temperatura_c: i.temperatura_c != null ? toNum(i.temperatura_c, 0) : null,
                qtd_caixas_recebidas: cxRow ? Number(cxRow.qtd) : 0,
              }
            })
          const txtDisp = prePoolRes.filter(
            (p) => p.pedido_compra_id === pc.id || (!p.pedido_compra_id && p.fornecedor_id === pc.fornecedor_id),
          ).length
          return {
            ...pc,
            valor_total: toNum(pc.valor_total, 0),
            recebimento: rec,
            txt_disponiveis_fornecedor: txtDisp,
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
      const q = req.query as { status?: string; tipo_compra?: string; busca?: string }
      const conds = [eq(pedidosCompra.tenantId, ctx.tenantId), eq(pedidosCompra.filialId, ctx.filialId)]
      if (q.status && q.status !== 'TODOS') {
        conds.push(eq(pedidosCompra.status, String(q.status).toUpperCase()))
      }
      if (q.tipo_compra && q.tipo_compra !== 'TODOS') {
        conds.push(eq(pedidosCompra.tipoCompra, String(q.tipo_compra).toUpperCase()))
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
            tipo_compra: pedidosCompra.tipoCompra,
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
          .leftJoin(fornecedores, eq(fornecedores.id, pedidosCompra.fornecedorId))
          .leftJoin(naturezasOperacao, eq(naturezasOperacao.id, pedidosCompra.naturezaId))
          .leftJoin(centrosCusto, eq(centrosCusto.id, pedidosCompra.centroCustoId))
          .leftJoin(formasPagamento, eq(formasPagamento.id, pedidosCompra.formaPagamentoId))
          .where(and(...conds))
          .orderBy(desc(pedidosCompra.createdAt)),
      ])

      return {
        success: true,
        trava_recebimento_sem_pc: Boolean(features.trava_recebimento_sem_pc),
        controlar_estoque_insumos: Boolean(features.controlar_estoque_insumos),
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
          tipo_compra: pedidosCompra.tipoCompra,
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
        .leftJoin(fornecedores, eq(fornecedores.id, pedidosCompra.fornecedorId))
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
            temperatura_c: pedidosCompraItens.temperaturaC,
            temperatura_registrada_em: pedidosCompraItens.temperaturaRegistradaEm,
            temperatura_registrada_por: pedidosCompraItens.temperaturaRegistradaPor,
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
                produto_codigo: produtos.codigo,
                produto_descricao: produtos.descricao,
                peso_bruto_kg: estoqueCaixas.pesoBrutoKg,
                tara_kg: estoqueCaixas.taraKg,
                peso_kg: estoqueCaixas.pesoKg,
                qtd_pecas: estoqueCaixas.qtdPecas,
                data_producao: estoqueCaixas.dataProducao,
                validade: estoqueCaixas.validade,
                lote: estoqueCaixas.lote,
                endereco: estoqueCaixas.endereco,
                custo_unitario_kg: estoqueCaixas.custoUnitarioKg,
                operador_cadastro_nome: estoqueCaixas.operadorCadastroNome,
              })
              .from(estoqueCaixas)
              .innerJoin(produtos, eq(produtos.id, estoqueCaixas.produtoId))
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
            temperatura_c: it.temperatura_c != null ? toNum(it.temperatura_c, 0) : null,
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
            peso_bruto_kg: c.peso_bruto_kg != null ? toNum(c.peso_bruto_kg, 0) : null,
            tara_kg: c.tara_kg != null ? toNum(c.tara_kg, 0) : 0,
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
      tipo_compra?: string
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

      const tiposValidos = ['MATERIA_PRIMA', 'REVENDA', 'EMPORIO', 'INSUMO', 'HIGIENE_CONSUMO']
      const tipoCompraRaw = String(body.tipo_compra || body.finalidade || 'MATERIA_PRIMA').toUpperCase()
      const tipoCompraFinal = tiposValidos.includes(tipoCompraRaw)
        ? tipoCompraRaw
        : tipoCompraRaw === 'CONSUMO'
          ? 'HIGIENE_CONSUMO'
          : 'MATERIA_PRIMA'

      await tx.insert(pedidosCompra).values({
        id,
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        codigo,
        fornecedorId,
        tipoCompra: tipoCompraFinal,
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

      await gerarTitulosCompraOuXml(tx, {
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        pedidoCompraId: id,
        operadorId: ctx.operador.id,
        operadorNome: ctx.operador.nome,
      })

      return { status: novoStatusPc, total_recebida_kg: Number(totalRec.toFixed(3)) }
    })

    return { success: true, ...result }
  })

  // Registrar temperatura de amostragem por item do Pedido de Compra (sai apenas no Relatório de Recebimento)
  app.patch(
    '/api/recebimento/pedidos/:pcId/itens/:itemId/temperatura',
    { preHandler: requirePermission(['recebimento', 'compras']) },
    async (req) => {
      const ctx = req.authCtx!
      const pcId = parseUuidOrBadRequest((req.params as { pcId: string }).pcId, 'pedido_compra_id')
      const itemId = parseUuidOrBadRequest((req.params as { itemId: string }).itemId, 'item_id')
      const body = (req.body || {}) as { temperatura_c?: number | null }

      const tempNum =
        body.temperatura_c === null || body.temperatura_c === undefined || String(body.temperatura_c).trim() === ''
          ? null
          : Number(String(body.temperatura_c).replace(',', '.'))

      if (tempNum !== null && (!Number.isFinite(tempNum) || tempNum < -50 || tempNum > 60)) {
        throw new HttpError(400, 'Informe uma temperatura válida entre -50 °C e +60 °C.')
      }

      const [it] = await conn.db
        .select({ id: pedidosCompraItens.id })
        .from(pedidosCompraItens)
        .where(
          and(
            eq(pedidosCompraItens.id, itemId),
            eq(pedidosCompraItens.pedidoCompraId, pcId),
            eq(pedidosCompraItens.tenantId, ctx.tenantId),
          ),
        )
        .limit(1)
      if (!it) throw new HttpError(404, 'Item do Pedido de Compra não encontrado.')

      const now = new Date()
      await conn.db
        .update(pedidosCompraItens)
        .set({
          temperaturaC: tempNum !== null ? toDec(tempNum, 2) : null,
          temperaturaRegistradaEm: tempNum !== null ? now : null,
          temperaturaRegistradaPor: tempNum !== null ? ctx.operador.nome : '',
        })
        .where(eq(pedidosCompraItens.id, itemId))

      return {
        success: true,
        temperatura_c: tempNum,
        temperatura_registrada_por: tempNum !== null ? ctx.operador.nome : '',
        temperatura_registrada_em: tempNum !== null ? now : null,
      }
    },
  )

  // Operador finaliza recebimento na doca (fecha direto se dentro de +-tol%, senão bloqueia ou envia p/ analista)
  app.post(
    '/api/recebimento/pedidos/:pcId/finalizar-doca',
    { preHandler: requirePermission(['recebimento', 'compras']) },
    async (req) => {
      const ctx = req.authCtx!
      const pcId = parseUuidOrBadRequest((req.params as { pcId: string }).pcId, 'pedido_compra_id')
      const body = (req.body || {}) as {
        numero_nf?: string
        chave_nfe?: string
        enviar_para_analista?: boolean
        observacao_divergencia?: string
      }

      const out = await conn.db.transaction(async (tx) => {
        const [pc] = await tx
          .select()
          .from(pedidosCompra)
          .where(and(eq(pedidosCompra.id, pcId), eq(pedidosCompra.tenantId, ctx.tenantId)))
          .limit(1)
        if (!pc) throw new HttpError(404, 'Pedido de Compra não encontrado.')
        if (!['APROVADO', 'PARCIAL'].includes(pc.status)) {
          throw new HttpError(400, `Pedido ${pc.codigo} está com status "${pc.status}".`)
        }

        const features = await lerTenantFeatures(tx, ctx.tenantId)
        const exigirTemp = Boolean(features.exigir_temperatura_recebimento)
        const tolPct =
          features.tolerancia_recebimento_pct != null && Number.isFinite(Number(features.tolerancia_recebimento_pct))
            ? Number(features.tolerancia_recebimento_pct)
            : 3

        const itens = await tx
          .select({
            id: pedidosCompraItens.id,
            produto_id: pedidosCompraItens.produtoId,
            produto_descricao: produtos.descricao,
            qtd_sol: pedidosCompraItens.qtdKgSolicitada,
            qtd_rec: pedidosCompraItens.qtdKgRecebida,
            preco: pedidosCompraItens.precoUnitarioKg,
            temperatura_c: pedidosCompraItens.temperaturaC,
          })
          .from(pedidosCompraItens)
          .innerJoin(produtos, eq(produtos.id, pedidosCompraItens.produtoId))
          .where(eq(pedidosCompraItens.pedidoCompraId, pcId))

        if (exigirTemp && !body.enviar_para_analista) {
          const semTemp = itens.filter((i) => toNum(i.qtd_rec, 0) > 0 && i.temperatura_c == null)
          if (semTemp.length > 0) {
            throw new HttpError(
              400,
              `Temperatura obrigatória ativa nos parâmetros! Informe a temperatura de amostragem para: ${semTemp.map((s) => s.produto_descricao).join(', ')}.`,
            )
          }
        }

        const divergentes: string[] = []
        let totalSol = 0
        let totalRec = 0
        for (const it of itens) {
          const sol = toNum(it.qtd_sol, 0)
          const rec = toNum(it.qtd_rec, 0)
          totalSol += sol
          totalRec += rec
          const difPct = sol > 0 ? Math.abs(rec - sol) / sol : 0
          if (rec <= 0 || difPct > tolPct / 100) {
            const falta = Number((sol - rec).toFixed(2))
            divergentes.push(`${it.produto_descricao}: recebido ${rec.toFixed(2)} / pedido ${sol.toFixed(2)} kg`)
            void falta
          }
        }

        const temDivergencia = divergentes.length > 0 || totalRec <= 0
        if (temDivergencia && !body.enviar_para_analista) {
          throw new HttpError(
            409,
            `Ainda existem itens fora da tolerância de ±${tolPct}% (${divergentes.slice(0, 3).join('; ')}). Complete a pesagem/bipagem ou envie para aprovação do Analista.`,
          )
        }

        const [recExist] = await tx
          .select()
          .from(recebimentos)
          .where(and(eq(recebimentos.pedidoCompraId, pcId), eq(recebimentos.tenantId, ctx.tenantId)))
          .limit(1)

        const novoStatusVal = temDivergencia ? 'DIVERGENTE' : 'VALIDADO'
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
            pedidoCompraId: pcId,
            fornecedorId: pc.fornecedorId,
            numeroNf: String(body.numero_nf || '').trim(),
            chaveNfe: String(body.chave_nfe || '').trim(),
            statusValidacao: novoStatusVal,
            validadoPorId: temDivergencia ? null : ctx.operador.id,
            validadoAt: temDivergencia ? null : new Date(),
          })
        } else {
          await tx
            .update(recebimentos)
            .set({
              statusValidacao: novoStatusVal,
              numeroNf: body.numero_nf ? String(body.numero_nf).trim() : recExist.numeroNf,
              chaveNfe: body.chave_nfe ? String(body.chave_nfe).trim() : recExist.chaveNfe,
              validadoPorId: temDivergencia ? recExist.validadoPorId : ctx.operador.id,
              validadoAt: temDivergencia ? recExist.validadoAt : new Date(),
            })
            .where(eq(recebimentos.id, recExist.id))
        }

        if (!temDivergencia) {
          const extrasTotal = toNum(pc.freteValor, 0) + toNum(pc.despesasValor, 0)
          const rateioExtra = totalRec > 0 ? extrasTotal / totalRec : 0
          for (const it of itens) {
            const p = toNum(it.preco, 0)
            if (p > 0) {
              await tx
                .update(produtos)
                .set({ custoMedioKg: toDec(Number((p + rateioExtra).toFixed(4)), 4), updatedAt: new Date() })
                .where(and(eq(produtos.id, it.produto_id), eq(produtos.tenantId, ctx.tenantId)))
            }
          }
          await tx
            .update(pedidosCompra)
            .set({ status: 'RECEBIDO', updatedAt: new Date() })
            .where(eq(pedidosCompra.id, pcId))

          await gerarTitulosCompraOuXml(tx, {
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            pedidoCompraId: pcId,
            recebimentoId: recId || null,
            operadorId: ctx.operador.id,
            operadorNome: ctx.operador.nome,
          })

          return {
            status: 'RECEBIDO',
            status_validacao: 'VALIDADO',
            recebimento_codigo: recCod,
            validado_direto: true,
            total_recebida_kg: Number(totalRec.toFixed(3)),
          }
        }

        // Divergente: mantém pedido em aberto para o Analista aprovar na Central/Compras
        await tx.insert(pendenciasSetor).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          setorDestino: 'SUPPLY_CHAIN',
          tipoPendencia: 'VALIDACAO_RECEBIMENTO',
          referenciaTabela: 'pedidos_compra',
          referenciaId: pcId,
          titulo: `${pc.codigo} (${recCod}) — Divergência Doca (±${tolPct}%): ${divergentes.slice(0, 2).join('; ')}${body.observacao_divergencia ? ` • Obs: ${body.observacao_divergencia}` : ''}`,
          prioridade: 4,
          status: 'PENDENTE',
        })

        return {
          status: pc.status,
          status_validacao: 'DIVERGENTE',
          recebimento_codigo: recCod,
          enviado_analista: true,
          divergencias: divergentes,
          total_recebida_kg: Number(totalRec.toFixed(3)),
        }
      })

      return { success: true, ...out }
    },
  )
}
