import type { FastifyInstance } from 'fastify'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DbConnection } from '../../db/client.js'
import {
  auditoriaAcessos,
  comprasCotacoes,
  comprasCotacoesItens,
  comprasCotacoesPropostas,
  estoqueCaixas,
  etiquetasAcougue,
  fornecedores,
  inventarioAjustesLog,
  pdvCaixas,
  pdvVendas,
  pedidos,
  pedidosCompra,
  pedidosCompraItens,
  perdasRegistro,
  produtos,
  recebimentos,
  tabelasPreco,
  tabelasPrecoItens,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import {
  gerarCodigoDocumento,
  hojeIsoLocal,
  normalizarDataIso,
  parseUuidOrBadRequest,
  recalcularPosicaoEnderecos,
  registrarHistoricoCaixa,
  registrarMovimentacaoLog,
  sugerirCfopOperacao,
  toDec,
  toNum,
} from '../wms/helpers.js'

const PERM_GOV_READ = [
  'compras',
  'fornecedores',
  'recebimento',
  'estoque_enderecos',
  'consulta_estoque',
  'relatorios_estoque',
  'dashboard_executivo',
  'varejo_acougue',
  'financeiro',
]
const PERM_GOV_WRITE = ['compras', 'fornecedores', 'estoque_enderecos', 'varejo_acougue', 'parametros_comerciais']

const MOTIVOS_PERDA_VALIDOS = [
  'VENCIMENTO',
  'AVARIA',
  'QUEBRA_DESOSSA',
  'TEMPERATURA',
  'FURTO_DIVERGENCIA',
  'OUTROS',
]

function diffDiasHoje(dataIso?: string | null): number | null {
  if (!dataIso) return null
  const s = String(dataIso).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const hoje = hojeIsoLocal()
  const alvoMs = new Date(`${s}T12:00:00Z`).getTime()
  const hojeMs = new Date(`${hoje}T12:00:00Z`).getTime()
  return Math.round((alvoMs - hojeMs) / 86_400_000)
}

function somarDiasIso(baseIso: string, dias: number): string {
  const ms = new Date(`${baseIso}T12:00:00Z`).getTime()
  return new Date(ms + dias * 86_400_000).toISOString().slice(0, 10)
}

function temperaturaDentroFaixa(tempC: number, conservacao?: string | null): boolean {
  const cons = String(conservacao || 'RESFRIADO').toUpperCase()
  if (cons === 'SECO') return true
  if (cons === 'CONGELADO') return tempC <= -12
  return tempC >= -3 && tempC <= 7
}

export function registerGovernancaRoutes(app: FastifyInstance, conn: DbConnection): void {
  const { requirePermission } = createAuthMiddleware(app, conn)

  // ═══════════════════════════════════════════════════════════════════════════
  // 1) COTAÇÕES DE COMPRAS (RFQ) & MAPA COMPARATIVO DE FORNECEDORES
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(
    '/api/governanca/cotacoes',
    { preHandler: requirePermission(PERM_GOV_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { status?: string }
      const statusNorm = String(q.status || 'TODAS').toUpperCase()

      const conds = [eq(comprasCotacoes.tenantId, ctx.tenantId), eq(comprasCotacoes.filialId, ctx.filialId)]
      if (statusNorm && statusNorm !== 'TODAS') {
        conds.push(eq(comprasCotacoes.status, statusNorm))
      }

      const rows = await conn.db
        .select({
          id: comprasCotacoes.id,
          codigo: comprasCotacoes.codigo,
          titulo: comprasCotacoes.titulo,
          tipo_compra: comprasCotacoes.tipoCompra,
          data_validade: comprasCotacoes.dataValidade,
          status: comprasCotacoes.status,
          observacoes: comprasCotacoes.observacoes,
          pedidos_gerados: comprasCotacoes.pedidosGeradosJson,
          economia_estimada: comprasCotacoes.economiaEstimada,
          criado_por_nome: comprasCotacoes.criadoPorNome,
          fechada_por_nome: comprasCotacoes.fechadaPorNome,
          fechada_em: comprasCotacoes.fechadaEm,
          created_at: comprasCotacoes.createdAt,
          total_itens: sql<number>`COALESCE((SELECT COUNT(*)::int FROM compras_cotacoes_itens ci WHERE ci.cotacao_id = ${comprasCotacoes.id}), 0)`,
          total_propostas: sql<number>`COALESCE((SELECT COUNT(*)::int FROM compras_cotacoes_propostas cp WHERE cp.cotacao_id = ${comprasCotacoes.id}), 0)`,
          total_fornecedores: sql<number>`COALESCE((SELECT COUNT(DISTINCT cp.fornecedor_id)::int FROM compras_cotacoes_propostas cp WHERE cp.cotacao_id = ${comprasCotacoes.id}), 0)`,
          total_vencedores: sql<number>`COALESCE((SELECT COUNT(*)::int FROM compras_cotacoes_propostas cp WHERE cp.cotacao_id = ${comprasCotacoes.id} AND cp.vencedor = 1), 0)`,
        })
        .from(comprasCotacoes)
        .where(and(...conds))
        .orderBy(desc(comprasCotacoes.createdAt))
        .limit(100)

      return {
        success: true,
        data: rows.map((r) => ({
          ...r,
          economia_estimada: toNum(r.economia_estimada, 0),
          pedidos_gerados: Array.isArray(r.pedidos_gerados) ? r.pedidos_gerados : [],
        })),
      }
    },
  )

  app.get(
    '/api/governanca/cotacoes/:id',
    { preHandler: requirePermission(PERM_GOV_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const cotId = parseUuidOrBadRequest((req.params as { id: string }).id, 'cotacao_id')

      const [cot] = await conn.db
        .select()
        .from(comprasCotacoes)
        .where(and(eq(comprasCotacoes.id, cotId), eq(comprasCotacoes.tenantId, ctx.tenantId)))
        .limit(1)
      if (!cot) throw new HttpError(404, 'Cotação não encontrada.')

      const [itensRows, propRows] = await Promise.all([
        conn.db
          .select({
            id: comprasCotacoesItens.id,
            produto_id: comprasCotacoesItens.produtoId,
            produto_codigo: produtos.codigo,
            produto_descricao: produtos.descricao,
            unidade: produtos.unidade,
            qtd_kg_solicitada: comprasCotacoesItens.qtdKgSolicitada,
            ultimo_preco_ref: comprasCotacoesItens.ultimoPrecoRef,
            custo_medio_kg: produtos.custoMedioKg,
            observacao: comprasCotacoesItens.observacao,
          })
          .from(comprasCotacoesItens)
          .innerJoin(produtos, eq(produtos.id, comprasCotacoesItens.produtoId))
          .where(eq(comprasCotacoesItens.cotacaoId, cotId))
          .orderBy(asc(produtos.descricao)),
        conn.db
          .select({
            id: comprasCotacoesPropostas.id,
            cotacao_item_id: comprasCotacoesPropostas.cotacaoItemId,
            fornecedor_id: comprasCotacoesPropostas.fornecedorId,
            fornecedor_nome: fornecedores.nomeFantasia,
            fornecedor_razao: fornecedores.razaoSocial,
            fornecedor_sif: fornecedores.registroSanitarioSif,
            fornecedor_uf: fornecedores.uf,
            preco_unitario_kg: comprasCotacoesPropostas.precoUnitarioKg,
            frete_kg: comprasCotacoesPropostas.freteKg,
            prazo_entrega_dias: comprasCotacoesPropostas.prazoEntregaDias,
            condicao_pagamento: comprasCotacoesPropostas.condicaoPagamento,
            observacao: comprasCotacoesPropostas.observacao,
            vencedor: comprasCotacoesPropostas.vencedor,
            created_at: comprasCotacoesPropostas.createdAt,
          })
          .from(comprasCotacoesPropostas)
          .innerJoin(fornecedores, eq(fornecedores.id, comprasCotacoesPropostas.fornecedorId))
          .where(eq(comprasCotacoesPropostas.cotacaoId, cotId))
          .orderBy(asc(fornecedores.nomeFantasia)),
      ])

      const propsPorItem = new Map<string, Array<Record<string, unknown>>>()
      for (const p of propRows) {
        const preco = toNum(p.preco_unitario_kg, 0)
        const frete = toNum(p.frete_kg, 0)
        const custoEfetivo = Number((preco + frete).toFixed(4))
        const arr = propsPorItem.get(p.cotacao_item_id) || []
        arr.push({
          ...p,
          fornecedor_nome: p.fornecedor_nome || p.fornecedor_razao,
          preco_unitario_kg: preco,
          frete_kg: frete,
          custo_efetivo_kg: custoEfetivo,
          vencedor: Number(p.vencedor || 0) === 1,
        })
        propsPorItem.set(p.cotacao_item_id, arr)
      }

      let economiaPotencial = 0
      let totalVencedor = 0

      const itens = itensRows.map((it) => {
        const qtd = toNum(it.qtd_kg_solicitada, 0)
        const props = (propsPorItem.get(it.id) || []).sort(
          (a, b) => Number(a.custo_efetivo_kg) - Number(b.custo_efetivo_kg),
        )
        const menorCusto = props.length > 0 ? Number(props[0].custo_efetivo_kg) : null
        const maiorCusto = props.length > 0 ? Number(props[props.length - 1].custo_efetivo_kg) : null
        const propVenc = props.find((p) => p.vencedor) || null
        const custoEscolhido = propVenc ? Number(propVenc.custo_efetivo_kg) : menorCusto

        if (custoEscolhido != null) {
          totalVencedor += qtd * custoEscolhido
          if (maiorCusto != null && maiorCusto > custoEscolhido) {
            economiaPotencial += qtd * (maiorCusto - custoEscolhido)
          }
        }

        return {
          ...it,
          qtd_kg_solicitada: qtd,
          ultimo_preco_ref: toNum(it.ultimo_preco_ref, 0),
          custo_medio_kg: toNum(it.custo_medio_kg, 0),
          menor_custo_efetivo: menorCusto,
          maior_custo_efetivo: maiorCusto,
          propostas: props.map((p) => ({
            ...p,
            melhor_preco: menorCusto != null && Math.abs(Number(p.custo_efetivo_kg) - menorCusto) <= 0.0001,
          })),
        }
      })

      return {
        success: true,
        data: {
          id: cot.id,
          codigo: cot.codigo,
          titulo: cot.titulo,
          tipo_compra: cot.tipoCompra,
          data_validade: cot.dataValidade,
          status: cot.status,
          observacoes: cot.observacoes,
          pedidos_gerados: Array.isArray(cot.pedidosGeradosJson) ? cot.pedidosGeradosJson : [],
          economia_estimada: Number((toNum(cot.economiaEstimada, 0) || economiaPotencial).toFixed(2)),
          total_vencedor_estimado: Number(totalVencedor.toFixed(2)),
          criado_por_nome: cot.criadoPorNome,
          fechada_por_nome: cot.fechadaPorNome,
          fechada_em: cot.fechadaEm,
          created_at: cot.createdAt,
          itens,
        },
      }
    },
  )

  app.post(
    '/api/governanca/cotacoes',
    { preHandler: requirePermission(PERM_GOV_WRITE) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        titulo?: string
        tipo_compra?: string
        data_validade?: string | null
        observacoes?: string
        itens?: Array<{ produto_id: string; qtd_kg_solicitada: number; observacao?: string }>
      }

      if (!Array.isArray(body.itens) || body.itens.length === 0) {
        throw new HttpError(400, 'Adicione ao menos 1 produto para abrir a cotação.')
      }

      const out = await conn.db.transaction(async (tx) => {
        const codigo = await gerarCodigoDocumento(tx, ctx.tenantId, 'COTACAO_COMPRA', 'COT', 4)
        const id = uuidv7()
        const prodIds = Array.from(new Set(body.itens!.map((i) => parseUuidOrBadRequest(i.produto_id, 'produto_id'))))

        const prodRows = await tx
          .select({
            id: produtos.id,
            ultimoPrecoCompra: produtos.ultimoPrecoCompra,
            custoMedioKg: produtos.custoMedioKg,
          })
          .from(produtos)
          .where(and(eq(produtos.tenantId, ctx.tenantId), inArray(produtos.id, prodIds)))
        const prodMap = new Map(prodRows.map((p) => [p.id, p]))

        const titulo = String(body.titulo || '').trim() || `Cotação ${codigo} (${hojeIsoLocal()})`
        const tiposValidos = ['MATERIA_PRIMA', 'REVENDA', 'EMPORIO', 'INSUMO', 'HIGIENE_CONSUMO']
        const tipoCompra = tiposValidos.includes(String(body.tipo_compra || '').toUpperCase())
          ? String(body.tipo_compra).toUpperCase()
          : 'MATERIA_PRIMA'

        await tx.insert(comprasCotacoes).values({
          id,
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          codigo,
          titulo,
          tipoCompra,
          dataValidade: normalizarDataIso(body.data_validade),
          status: 'ABERTA',
          observacoes: String(body.observacoes || '').trim(),
          criadoPorId: ctx.operador.id,
          criadoPorNome: ctx.operador.nome,
        })

        // Consolidar itens duplicados
        const cons = new Map<string, { qtd: number; obs: string }>()
        for (const it of body.itens!) {
          const pid = parseUuidOrBadRequest(it.produto_id, 'produto_id')
          const qtd = toNum(it.qtd_kg_solicitada, 0)
          if (qtd <= 0) throw new HttpError(400, 'Quantidade cotada deve ser maior que zero.')
          const prev = cons.get(pid)
          if (prev) prev.qtd = Number((prev.qtd + qtd).toFixed(3))
          else cons.set(pid, { qtd: Number(qtd.toFixed(3)), obs: String(it.observacao || '').trim() })
        }

        const itemIds: Array<{ item_id: string; produto_id: string }> = []
        for (const [pid, info] of cons.entries()) {
          const p = prodMap.get(pid)
          const ref = p ? toNum(p.ultimoPrecoCompra, 0) || toNum(p.custoMedioKg, 0) : 0
          const itemId = uuidv7()
          await tx.insert(comprasCotacoesItens).values({
            id: itemId,
            tenantId: ctx.tenantId,
            cotacaoId: id,
            produtoId: pid,
            qtdKgSolicitada: toDec(info.qtd, 3),
            ultimoPrecoRef: toDec(ref, 4),
            observacao: info.obs,
          })
          itemIds.push({ item_id: itemId, produto_id: pid })
        }

        return { id, codigo, titulo, itens: itemIds }
      })

      return reply.status(201).send({ success: true, ...out })
    },
  )

  app.post(
    '/api/governanca/cotacoes/:id/propostas',
    { preHandler: requirePermission(PERM_GOV_WRITE) },
    async (req) => {
      const ctx = req.authCtx!
      const cotId = parseUuidOrBadRequest((req.params as { id: string }).id, 'cotacao_id')
      const body = (req.body || {}) as {
        propostas?: Array<{
          cotacao_item_id: string
          fornecedor_id: string
          preco_unitario_kg: number
          frete_kg?: number
          prazo_entrega_dias?: number
          condicao_pagamento?: string
          observacao?: string
        }>
        cotacao_item_id?: string
        fornecedor_id?: string
        preco_unitario_kg?: number
        frete_kg?: number
        prazo_entrega_dias?: number
        condicao_pagamento?: string
        observacao?: string
      }

      const lista = Array.isArray(body.propostas)
        ? body.propostas
        : body.cotacao_item_id && body.fornecedor_id
          ? [
              {
                cotacao_item_id: body.cotacao_item_id,
                fornecedor_id: body.fornecedor_id,
                preco_unitario_kg: body.preco_unitario_kg ?? 0,
                frete_kg: body.frete_kg ?? 0,
                prazo_entrega_dias: body.prazo_entrega_dias ?? 2,
                condicao_pagamento: body.condicao_pagamento ?? '',
                observacao: body.observacao ?? '',
              },
            ]
          : []

      if (lista.length === 0) throw new HttpError(400, 'Informe ao menos uma proposta de fornecedor.')

      await conn.db.transaction(async (tx) => {
        const [cot] = await tx
          .select()
          .from(comprasCotacoes)
          .where(and(eq(comprasCotacoes.id, cotId), eq(comprasCotacoes.tenantId, ctx.tenantId)))
          .limit(1)
        if (!cot) throw new HttpError(404, 'Cotação não encontrada.')
        if (cot.status === 'FECHADA' || cot.status === 'CANCELADA') {
          throw new HttpError(409, `Cotação ${cot.codigo} já está ${cot.status}.`)
        }

        for (const p of lista) {
          const itemId = parseUuidOrBadRequest(p.cotacao_item_id, 'cotacao_item_id')
          const fornId = parseUuidOrBadRequest(p.fornecedor_id, 'fornecedor_id')
          const preco = toNum(p.preco_unitario_kg, 0)
          if (preco <= 0) throw new HttpError(400, 'Preço unitário da proposta deve ser maior que zero.')
          const frete = Math.max(0, toNum(p.frete_kg, 0))
          const prazo = Math.max(0, Math.round(toNum(p.prazo_entrega_dias, 2)))

          const [ex] = await tx
            .select({ id: comprasCotacoesPropostas.id })
            .from(comprasCotacoesPropostas)
            .where(
              and(
                eq(comprasCotacoesPropostas.cotacaoItemId, itemId),
                eq(comprasCotacoesPropostas.fornecedorId, fornId),
              ),
            )
            .limit(1)

          if (ex) {
            await tx
              .update(comprasCotacoesPropostas)
              .set({
                precoUnitarioKg: toDec(preco, 4),
                freteKg: toDec(frete, 4),
                prazoEntregaDias: prazo,
                condicaoPagamento: String(p.condicao_pagamento || '').trim(),
                observacao: String(p.observacao || '').trim(),
              })
              .where(eq(comprasCotacoesPropostas.id, ex.id))
          } else {
            await tx.insert(comprasCotacoesPropostas).values({
              id: uuidv7(),
              tenantId: ctx.tenantId,
              cotacaoId: cotId,
              cotacaoItemId: itemId,
              fornecedorId: fornId,
              precoUnitarioKg: toDec(preco, 4),
              freteKg: toDec(frete, 4),
              prazoEntregaDias: prazo,
              condicaoPagamento: String(p.condicao_pagamento || '').trim(),
              observacao: String(p.observacao || '').trim(),
              vencedor: 0,
            })
          }
        }

        await tx
          .update(comprasCotacoes)
          .set({ status: 'EM_ANALISE', updatedAt: new Date() })
          .where(eq(comprasCotacoes.id, cotId))
      })

      return { success: true }
    },
  )

  app.post(
    '/api/governanca/cotacoes/:id/selecionar-vencedor',
    { preHandler: requirePermission(PERM_GOV_WRITE) },
    async (req) => {
      const ctx = req.authCtx!
      const cotId = parseUuidOrBadRequest((req.params as { id: string }).id, 'cotacao_id')
      const body = (req.body || {}) as { proposta_id?: string; auto_menor_custo?: boolean }

      await conn.db.transaction(async (tx) => {
        const [cot] = await tx
          .select()
          .from(comprasCotacoes)
          .where(and(eq(comprasCotacoes.id, cotId), eq(comprasCotacoes.tenantId, ctx.tenantId)))
          .limit(1)
        if (!cot) throw new HttpError(404, 'Cotação não encontrada.')
        if (cot.status === 'FECHADA') throw new HttpError(409, 'Cotação já está fechada.')

        if (body.auto_menor_custo) {
          const allProps = await tx
            .select()
            .from(comprasCotacoesPropostas)
            .where(eq(comprasCotacoesPropostas.cotacaoId, cotId))

          await tx
            .update(comprasCotacoesPropostas)
            .set({ vencedor: 0 })
            .where(eq(comprasCotacoesPropostas.cotacaoId, cotId))

          const porItem = new Map<string, typeof allProps>()
          for (const p of allProps) {
            const arr = porItem.get(p.cotacaoItemId) || []
            arr.push(p)
            porItem.set(p.cotacaoItemId, arr)
          }

          for (const arr of porItem.values()) {
            arr.sort(
              (a, b) =>
                toNum(a.precoUnitarioKg, 0) +
                toNum(a.freteKg, 0) -
                (toNum(b.precoUnitarioKg, 0) + toNum(b.freteKg, 0)),
            )
            if (arr[0]) {
              await tx
                .update(comprasCotacoesPropostas)
                .set({ vencedor: 1 })
                .where(eq(comprasCotacoesPropostas.id, arr[0].id))
            }
          }
        } else {
          const propId = parseUuidOrBadRequest(body.proposta_id || '', 'proposta_id')
          const [prop] = await tx
            .select()
            .from(comprasCotacoesPropostas)
            .where(and(eq(comprasCotacoesPropostas.id, propId), eq(comprasCotacoesPropostas.cotacaoId, cotId)))
            .limit(1)
          if (!prop) throw new HttpError(404, 'Proposta não encontrada nesta cotação.')

          await tx
            .update(comprasCotacoesPropostas)
            .set({ vencedor: 0 })
            .where(eq(comprasCotacoesPropostas.cotacaoItemId, prop.cotacaoItemId))
          await tx
            .update(comprasCotacoesPropostas)
            .set({ vencedor: 1 })
            .where(eq(comprasCotacoesPropostas.id, propId))
        }
      })

      return { success: true }
    },
  )

  app.post(
    '/api/governanca/cotacoes/:id/gerar-pedidos',
    { preHandler: requirePermission(PERM_GOV_WRITE) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const cotId = parseUuidOrBadRequest((req.params as { id: string }).id, 'cotacao_id')
      const body = (req.body || {}) as { aprovar_automaticamente?: boolean }
      const aprovar = body.aprovar_automaticamente !== false

      const resultado = await conn.db.transaction(async (tx) => {
        const [cot] = await tx
          .select()
          .from(comprasCotacoes)
          .where(and(eq(comprasCotacoes.id, cotId), eq(comprasCotacoes.tenantId, ctx.tenantId)))
          .limit(1)
        if (!cot) throw new HttpError(404, 'Cotação não encontrada.')
        if (cot.status === 'FECHADA') throw new HttpError(409, 'Esta cotação já gerou pedidos de compra.')

        const [itensRows, propsRows] = await Promise.all([
          tx.select().from(comprasCotacoesItens).where(eq(comprasCotacoesItens.cotacaoId, cotId)),
          tx.select().from(comprasCotacoesPropostas).where(eq(comprasCotacoesPropostas.cotacaoId, cotId)),
        ])

        const vencedoras = propsRows.filter((p) => Number(p.vencedor || 0) === 1)
        if (vencedoras.length === 0) {
          throw new HttpError(400, 'Selecione ao menos uma proposta vencedora antes de gerar os Pedidos de Compra.')
        }

        const itemMap = new Map(itensRows.map((i) => [i.id, i]))
        const maxPorItem = new Map<string, number>()
        for (const p of propsRows) {
          const eff = toNum(p.precoUnitarioKg, 0) + toNum(p.freteKg, 0)
          const cur = maxPorItem.get(p.cotacaoItemId) || 0
          if (eff > cur) maxPorItem.set(p.cotacaoItemId, eff)
        }

        // Agrupa itens vencedores por fornecedor
        const porForn = new Map<
          string,
          Array<{ produtoId: string; qtd: number; preco: number; freteKg: number; prazoDias: number }>
        >()
        let economiaTotal = 0

        for (const v of vencedoras) {
          const it = itemMap.get(v.cotacaoItemId)
          if (!it) continue
          const qtd = toNum(it.qtdKgSolicitada, 0)
          const preco = toNum(v.precoUnitarioKg, 0)
          const freteKg = toNum(v.freteKg, 0)
          const eff = preco + freteKg
          const maxEff = maxPorItem.get(v.cotacaoItemId) || eff
          if (maxEff > eff) economiaTotal += qtd * (maxEff - eff)

          const arr = porForn.get(v.fornecedorId) || []
          arr.push({
            produtoId: it.produtoId,
            qtd,
            preco,
            freteKg,
            prazoDias: Number(v.prazoEntregaDias || 2),
          })
          porForn.set(v.fornecedorId, arr)
        }

        const fornIds = Array.from(porForn.keys())
        const fornRows = await tx
          .select({ id: fornecedores.id, uf: fornecedores.uf, nome: fornecedores.nomeFantasia, razao: fornecedores.razaoSocial })
          .from(fornecedores)
          .where(inArray(fornecedores.id, fornIds))
        const fornMap = new Map(fornRows.map((f) => [f.id, f]))

        const pedidosGerados: Array<{ id: string; codigo: string; fornecedor_nome: string; valor_total: number }> = []
        const hoje = hojeIsoLocal()

        for (const [fornId, itensForn] of porForn.entries()) {
          const forn = fornMap.get(fornId)
          const cfopInfo = await sugerirCfopOperacao(tx, {
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            tipoMovimento: 'ENTRADA',
            finalidade: cot.tipoCompra === 'REVENDA' ? 'REVENDA' : 'MATERIA_PRIMA',
            ufParceiro: forn?.uf || 'SP',
          })

          const pcId = uuidv7()
          const pcCod = await gerarCodigoDocumento(tx, ctx.tenantId, 'PEDIDO_COMPRA', 'PC', 4)
          const valorProdutos = itensForn.reduce((s, i) => s + i.qtd * i.preco, 0)
          const freteTotal = itensForn.reduce((s, i) => s + i.qtd * i.freteKg, 0)
          const valorTotal = Number((valorProdutos + freteTotal).toFixed(2))
          const maiorPrazo = Math.max(...itensForn.map((i) => i.prazoDias), 1)

          await tx.insert(pedidosCompra).values({
            id: pcId,
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            codigo: pcCod,
            fornecedorId: fornId,
            tipoCompra: cot.tipoCompra,
            naturezaId: cfopInfo?.natureza_id || null,
            compradorId: ctx.operador.id,
            freteValor: toDec(freteTotal, 2),
            despesasValor: '0.00',
            valorTotal: toDec(valorTotal, 2),
            previsaoEntrega: somarDiasIso(hoje, maiorPrazo),
            observacoes: `Gerado automaticamente da Cotação ${cot.codigo} — ${cot.titulo}`,
            status: aprovar ? 'APROVADO' : 'ABERTO',
          })

          await tx.insert(pedidosCompraItens).values(
            itensForn.map((it) => ({
              id: uuidv7(),
              tenantId: ctx.tenantId,
              pedidoCompraId: pcId,
              produtoId: it.produtoId,
              qtdKgSolicitada: toDec(it.qtd, 3),
              precoUnitarioKg: toDec(it.preco, 4),
              qtdKgRecebida: '0.000',
              cfopAplicado: cfopInfo?.cfop || '',
            })),
          )

          pedidosGerados.push({
            id: pcId,
            codigo: pcCod,
            fornecedor_nome: forn?.nome || forn?.razao || 'Fornecedor',
            valor_total: valorTotal,
          })
        }

        const now = new Date()
        await tx
          .update(comprasCotacoes)
          .set({
            status: 'FECHADA',
            pedidosGeradosJson: pedidosGerados,
            economiaEstimada: toDec(economiaTotal, 2),
            fechadaPorNome: ctx.operador.nome,
            fechadaEm: now,
            updatedAt: now,
          })
          .where(eq(comprasCotacoes.id, cotId))

        await tx.insert(auditoriaAcessos).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          targetUserNome: cot.codigo,
          acao: 'COTACAO_FECHADA_GEROU_PC',
          detalhesDepois: { pedidos_gerados: pedidosGerados, economia_estimada: Number(economiaTotal.toFixed(2)) },
          executorId: ctx.operador.id,
          executorNome: ctx.operador.nome,
        })

        return {
          cotacao_codigo: cot.codigo,
          pedidos_gerados: pedidosGerados,
          economia_estimada: Number(economiaTotal.toFixed(2)),
        }
      })

      return reply.status(201).send({ success: true, ...resultado })
    },
  )

  app.delete(
    '/api/governanca/cotacoes/:id',
    { preHandler: requirePermission(PERM_GOV_WRITE) },
    async (req) => {
      const ctx = req.authCtx!
      const cotId = parseUuidOrBadRequest((req.params as { id: string }).id, 'cotacao_id')
      const [cot] = await conn.db
        .select({ id: comprasCotacoes.id, status: comprasCotacoes.status })
        .from(comprasCotacoes)
        .where(and(eq(comprasCotacoes.id, cotId), eq(comprasCotacoes.tenantId, ctx.tenantId)))
        .limit(1)
      if (!cot) throw new HttpError(404, 'Cotação não encontrada.')
      if (cot.status === 'FECHADA') {
        throw new HttpError(409, 'Cotações já fechadas com Pedido de Compra gerado não podem ser excluídas.')
      }
      await conn.db.delete(comprasCotacoes).where(eq(comprasCotacoes.id, cotId))
      return { success: true }
    },
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // 2) SCORE & RANKING DE CONFIABILIDADE DE FORNECEDORES (FRIGORÍFICOS / SIF)
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(
    '/api/governanca/score-fornecedores',
    { preHandler: requirePermission(PERM_GOV_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { dias?: string }
      const dias = Math.min(365, Math.max(7, Math.round(Number(q.dias || 90))))
      const dataCorte = somarDiasIso(hojeIsoLocal(), -dias)

      const [forns, pcs, pcItens, recs] = await Promise.all([
        conn.db
          .select({
            id: fornecedores.id,
            codigo: fornecedores.codigo,
            nome_fantasia: fornecedores.nomeFantasia,
            razao_social: fornecedores.razaoSocial,
            cidade: fornecedores.cidade,
            uf: fornecedores.uf,
            sif: fornecedores.registroSanitarioSif,
            prazo_entrega_dias: fornecedores.prazoEntregaDias,
          })
          .from(fornecedores)
          .where(and(eq(fornecedores.tenantId, ctx.tenantId), eq(fornecedores.ativo, 1)))
          .orderBy(asc(fornecedores.nomeFantasia)),
        conn.db
          .select({
            id: pedidosCompra.id,
            fornecedor_id: pedidosCompra.fornecedorId,
            previsao_entrega: pedidosCompra.previsaoEntrega,
            valor_total: pedidosCompra.valorTotal,
            status: pedidosCompra.status,
            created_at: pedidosCompra.createdAt,
          })
          .from(pedidosCompra)
          .where(
            and(
              eq(pedidosCompra.tenantId, ctx.tenantId),
              sql`${pedidosCompra.status} != 'CANCELADO'`,
              sql`DATE(${pedidosCompra.createdAt}) >= ${dataCorte}::date`,
            ),
          ),
        conn.db
          .select({
            pedido_compra_id: pedidosCompraItens.pedidoCompraId,
            qtd_solicitada: pedidosCompraItens.qtdKgSolicitada,
            qtd_recebida: pedidosCompraItens.qtdKgRecebida,
            preco_kg: pedidosCompraItens.precoUnitarioKg,
            temperatura_c: pedidosCompraItens.temperaturaC,
            conservacao: produtos.conservacao,
          })
          .from(pedidosCompraItens)
          .innerJoin(produtos, eq(produtos.id, pedidosCompraItens.produtoId))
          .where(eq(pedidosCompraItens.tenantId, ctx.tenantId)),
        conn.db
          .select({
            id: recebimentos.id,
            fornecedor_id: recebimentos.fornecedorId,
            pedido_compra_id: recebimentos.pedidoCompraId,
            status_validacao: recebimentos.statusValidacao,
            valor_total_nf: recebimentos.valorTotalNf,
            created_at: recebimentos.createdAt,
          })
          .from(recebimentos)
          .where(
            and(
              eq(recebimentos.tenantId, ctx.tenantId),
              sql`DATE(${recebimentos.createdAt}) >= ${dataCorte}::date`,
            ),
          ),
      ])

      const pcById = new Map(pcs.map((p) => [p.id, p]))
      const pcIdsSet = new Set(pcs.map((p) => p.id))
      const itensPorForn = new Map<string, typeof pcItens>()

      for (const it of pcItens) {
        if (!pcIdsSet.has(it.pedido_compra_id)) continue
        const pc = pcById.get(it.pedido_compra_id)
        if (!pc?.fornecedor_id) continue
        const arr = itensPorForn.get(pc.fornecedor_id) || []
        arr.push(it)
        itensPorForn.set(pc.fornecedor_id, arr)
      }

      const ranking = forns.map((f) => {
        const fPcs = pcs.filter((p) => p.fornecedor_id === f.id)
        const fRecs = recs.filter((r) => r.fornecedor_id === f.id)
        const fItens = itensPorForn.get(f.id) || []

        const valorComprado = fPcs.reduce((s, p) => s + toNum(p.valor_total, 0), 0)
        const kgSolicitado = fItens.reduce((s, i) => s + toNum(i.qtd_solicitada, 0), 0)
        const kgRecebido = fItens.reduce((s, i) => s + toNum(i.qtd_recebida, 0), 0)

        // 1) Pontualidade (recebimentos no prazo vs previsão do PC)
        let pontuais = 0
        let avaliadosPrazo = 0
        for (const r of fRecs) {
          const pc = r.pedido_compra_id ? pcById.get(r.pedido_compra_id) : null
          if (!pc?.previsao_entrega) continue
          avaliadosPrazo += 1
          const dataRec = new Date(r.created_at).toISOString().slice(0, 10)
          if (dataRec <= String(pc.previsao_entrega).slice(0, 10)) pontuais += 1
        }
        const pontualidadePct = avaliadosPrazo > 0 ? Math.round((pontuais / avaliadosPrazo) * 100) : 100

        // 2) Acuracidade de Peso & 3-Way (penaliza divergências na doca e diferença de peso)
        const divergenciasQtd = fRecs.filter((r) => r.status_validacao === 'DIVERGENTE').length
        let acuracidadePesoPct = 100
        if (kgSolicitado > 0 && kgRecebido > 0) {
          const desvioPct = Math.abs(kgRecebido - kgSolicitado) / kgSolicitado
          acuracidadePesoPct = Math.max(0, Math.round((1 - desvioPct) * 100))
        }
        if (fRecs.length > 0 && divergenciasQtd > 0) {
          const penalidadeDiv = Math.round((divergenciasQtd / fRecs.length) * 35)
          acuracidadePesoPct = Math.max(0, acuracidadePesoPct - penalidadeDiv)
        }

        // 3) Conformidade Térmica (Cadeia de Frio °C)
        const medTemp = fItens.filter((i) => i.temperatura_c != null)
        const tempOk = medTemp.filter((i) => temperaturaDentroFaixa(toNum(i.temperatura_c, 0), i.conservacao)).length
        const conformidadeTempPct = medTemp.length > 0 ? Math.round((tempOk / medTemp.length) * 100) : 100

        const temMovimento = fPcs.length > 0 || fRecs.length > 0
        const notaScore = temMovimento
          ? Math.round(pontualidadePct * 0.3 + acuracidadePesoPct * 0.4 + conformidadeTempPct * 0.3)
          : null

        const classe =
          notaScore === null ? 'SEM_DADOS' : notaScore >= 85 ? 'A' : notaScore >= 65 ? 'B' : 'C'

        const kgBase = kgRecebido > 0 ? kgRecebido : kgSolicitado
        const custoMedioKg = kgBase > 0 ? Number((valorComprado / kgBase).toFixed(2)) : 0

        return {
          fornecedor_id: f.id,
          codigo: f.codigo || '',
          nome: f.nome_fantasia || f.razao_social,
          razao_social: f.razao_social,
          cidade: f.cidade || '',
          uf: f.uf || '',
          sif: f.sif || '',
          total_pedidos: fPcs.length,
          total_recebimentos: fRecs.length,
          divergencias_qtd: divergenciasQtd,
          kg_solicitado: Number(kgSolicitado.toFixed(2)),
          kg_recebido: Number(kgRecebido.toFixed(2)),
          valor_comprado: Number(valorComprado.toFixed(2)),
          custo_medio_kg: custoMedioKg,
          pontualidade_pct: pontualidadePct,
          acuracidade_peso_pct: acuracidadePesoPct,
          conformidade_temp_pct: conformidadeTempPct,
          amostras_temp: medTemp.length,
          nota_score: notaScore,
          classe,
        }
      })

      ranking.sort((a, b) => {
        if (a.nota_score === null && b.nota_score !== null) return 1
        if (a.nota_score !== null && b.nota_score === null) return -1
        if (b.valor_comprado !== a.valor_comprado) return b.valor_comprado - a.valor_comprado
        return (b.nota_score ?? 0) - (a.nota_score ?? 0)
      })

      return {
        success: true,
        periodo_dias: dias,
        data_inicio: dataCorte,
        data: ranking,
      }
    },
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // 3) MONITOR FEFO, VALIDADE CRÍTICA, QUEIMA PROMOCIONAL & CONTROLE DE PERDAS
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(
    '/api/governanca/fefo-perdas',
    { preHandler: requirePermission(PERM_GOV_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { dias_alerta?: string }
      const diasAlerta = Math.min(180, Math.max(1, Math.round(Number(q.dias_alerta || 15))))

      const [caixas, etiquetas] = await Promise.all([
        conn.db
          .select({
            id: estoqueCaixas.id,
            ean_caixa: estoqueCaixas.eanCaixa,
            produto_id: estoqueCaixas.produtoId,
            produto_codigo: produtos.codigo,
            produto_descricao: produtos.descricao,
            especie: produtos.especie,
            conservacao: produtos.conservacao,
            endereco: estoqueCaixas.endereco,
            lote: estoqueCaixas.lote,
            validade: estoqueCaixas.validade,
            peso_kg: estoqueCaixas.pesoKg,
            custo_unitario_kg: estoqueCaixas.custoUnitarioKg,
            custo_medio_prod: produtos.custoMedioKg,
            valor_unitario_prod: produtos.valorUnitario,
          })
          .from(estoqueCaixas)
          .innerJoin(produtos, eq(produtos.id, estoqueCaixas.produtoId))
          .where(
            and(
              eq(estoqueCaixas.tenantId, ctx.tenantId),
              eq(estoqueCaixas.filialId, ctx.filialId),
              eq(estoqueCaixas.status, 'DISPONIVEL'),
              sql`${estoqueCaixas.validade} IS NOT NULL`,
            ),
          ),
        conn.db
          .select({
            id: etiquetasAcougue.id,
            codigo_etiqueta: etiquetasAcougue.codigoEtiqueta,
            produto_id: etiquetasAcougue.produtoId,
            produto_codigo: etiquetasAcougue.produtoCodigo,
            produto_descricao: etiquetasAcougue.produtoDescricao,
            especie: etiquetasAcougue.especie,
            conservacao: etiquetasAcougue.conservacao,
            lote: etiquetasAcougue.lote,
            validade: etiquetasAcougue.validade,
            peso_kg: etiquetasAcougue.pesoLiquidoKg,
            valor_total: etiquetasAcougue.valorTotal,
            custo_medio_prod: produtos.custoMedioKg,
          })
          .from(etiquetasAcougue)
          .innerJoin(produtos, eq(produtos.id, etiquetasAcougue.produtoId))
          .where(
            and(
              eq(etiquetasAcougue.tenantId, ctx.tenantId),
              eq(etiquetasAcougue.filialId, ctx.filialId),
              eq(etiquetasAcougue.status, 'EM_ESTOQUE'),
              sql`${etiquetasAcougue.validade} IS NOT NULL`,
            ),
          ),
      ])

      const itens: Array<{
        id: string
        origem: 'ESTOQUE_CAIXA' | 'ETIQUETA_ACOUGUE'
        codigo_rastreio: string
        produto_id: string
        produto_codigo: string
        produto_descricao: string
        especie: string
        conservacao: string
        endereco: string
        lote: string
        validade: string
        dias_restantes: number
        faixa: 'VENCIDO' | 'CRITICO' | 'ATENCAO' | 'MONITORAR'
        peso_kg: number
        custo_unitario: number
        valor_em_risco: number
      }> = []

      const classificar = (diasRest: number): 'VENCIDO' | 'CRITICO' | 'ATENCAO' | 'MONITORAR' | null => {
        if (diasRest < 0) return 'VENCIDO'
        if (diasRest <= 3) return 'CRITICO'
        if (diasRest <= 7) return 'ATENCAO'
        if (diasRest <= diasAlerta) return 'MONITORAR'
        return null
      }

      for (const c of caixas) {
        const dias = diffDiasHoje(c.validade)
        if (dias === null) continue
        const faixa = classificar(dias)
        if (!faixa) continue
        const peso = toNum(c.peso_kg, 0)
        const custo = toNum(c.custo_unitario_kg, 0) || toNum(c.custo_medio_prod, 0) || toNum(c.valor_unitario_prod, 0)
        itens.push({
          id: c.id,
          origem: 'ESTOQUE_CAIXA',
          codigo_rastreio: c.ean_caixa,
          produto_id: c.produto_id,
          produto_codigo: c.produto_codigo || '',
          produto_descricao: c.produto_descricao,
          especie: c.especie || '',
          conservacao: c.conservacao || 'RESFRIADO',
          endereco: c.endereco || '-',
          lote: c.lote || '-',
          validade: String(c.validade).slice(0, 10),
          dias_restantes: dias,
          faixa,
          peso_kg: Number(peso.toFixed(3)),
          custo_unitario: Number(custo.toFixed(2)),
          valor_em_risco: Number((peso * custo).toFixed(2)),
        })
      }

      for (const e of etiquetas) {
        const dias = diffDiasHoje(e.validade)
        if (dias === null) continue
        const faixa = classificar(dias)
        if (!faixa) continue
        const peso = toNum(e.peso_kg, 0)
        const custo = toNum(e.custo_medio_prod, 0) || (peso > 0 ? toNum(e.valor_total, 0) / peso : 0)
        itens.push({
          id: e.id,
          origem: 'ETIQUETA_ACOUGUE',
          codigo_rastreio: e.codigo_etiqueta,
          produto_id: e.produto_id,
          produto_codigo: e.produto_codigo || '',
          produto_descricao: e.produto_descricao,
          especie: e.especie || '',
          conservacao: e.conservacao || 'RESFRIADO',
          endereco: 'ACOUGUE-LOJA',
          lote: e.lote || '-',
          validade: String(e.validade).slice(0, 10),
          dias_restantes: dias,
          faixa,
          peso_kg: Number(peso.toFixed(3)),
          custo_unitario: Number(custo.toFixed(2)),
          valor_em_risco: Number((peso * custo).toFixed(2)),
        })
      }

      itens.sort((a, b) => a.dias_restantes - b.dias_restantes || b.valor_em_risco - a.valor_em_risco)

      const resumoFaixa = (faixa: 'VENCIDO' | 'CRITICO' | 'ATENCAO' | 'MONITORAR') => {
        const sub = itens.filter((i) => i.faixa === faixa)
        return {
          qtd: sub.length,
          kg: Number(sub.reduce((s, i) => s + i.peso_kg, 0).toFixed(2)),
          valor: Number(sub.reduce((s, i) => s + i.valor_em_risco, 0).toFixed(2)),
        }
      }

      return {
        success: true,
        dias_alerta: diasAlerta,
        resumo: {
          total_itens: itens.length,
          total_kg: Number(itens.reduce((s, i) => s + i.peso_kg, 0).toFixed(2)),
          capital_em_risco: Number(itens.reduce((s, i) => s + i.valor_em_risco, 0).toFixed(2)),
          vencido: resumoFaixa('VENCIDO'),
          critico: resumoFaixa('CRITICO'),
          atencao: resumoFaixa('ATENCAO'),
          monitorar: resumoFaixa('MONITORAR'),
        },
        data: itens,
      }
    },
  )

  // Ação rápida FEFO #1: Criar Tabela Promocional de Liquidação para SKUs próximos do vencimento
  app.post(
    '/api/governanca/fefo/aplicar-promocao',
    { preHandler: requirePermission(PERM_GOV_WRITE) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        titulo?: string
        desconto_pct?: number
        dias_validade?: number
        produto_ids?: string[]
      }

      const prodIds = Array.isArray(body.produto_ids)
        ? Array.from(new Set(body.produto_ids.map((id) => parseUuidOrBadRequest(id, 'produto_id'))))
        : []
      if (prodIds.length === 0) throw new HttpError(400, 'Selecione ao menos um produto para a campanha FEFO.')

      const descPct = Math.min(80, Math.max(1, Number(body.desconto_pct || 20)))
      const diasVal = Math.min(30, Math.max(1, Math.round(Number(body.dias_validade || 3))))
      const hoje = hojeIsoLocal()
      const dataFim = somarDiasIso(hoje, diasVal)

      const out = await conn.db.transaction(async (tx) => {
        const codigo = await gerarCodigoDocumento(tx, ctx.tenantId, 'TABELA_PRECO', 'TAB', 3)
        const tabId = uuidv7()
        const nome = String(body.titulo || '').trim() || `Liquidação FEFO (-${descPct}%) • ${hoje}`

        await tx.insert(tabelasPreco).values({
          id: tabId,
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          codigo,
          nome,
          finalidade: 'PROMOCIONAL',
          padrao: 0,
          descontoPadraoPct: toDec(descPct, 2),
          dataInicio: hoje,
          dataFim,
          observacoes: `Gerada automaticamente pelo Monitor FEFO de Prevenção de Perdas por ${ctx.operador.nome}.`,
          ativo: 1,
        })

        const prods = await tx
          .select({ id: produtos.id, valorUnitario: produtos.valorUnitario, custoMedioKg: produtos.custoMedioKg })
          .from(produtos)
          .where(and(eq(produtos.tenantId, ctx.tenantId), inArray(produtos.id, prodIds)))

        const itensInseridos: Array<{ produto_id: string; preco_base: number; preco_promocional: number }> = []
        for (const p of prods) {
          const base = toNum(p.valorUnitario, 0) || toNum(p.custoMedioKg, 0) * 1.25 || 10
          const promo = Number(Math.max(0.01, base * (1 - descPct / 100)).toFixed(2))
          await tx.insert(tabelasPrecoItens).values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            tabelaPrecoId: tabId,
            produtoId: p.id,
            precoVenda: toDec(base, 4),
            precoPromocional: toDec(promo, 4),
            descontoPct: toDec(descPct, 2),
          })
          itensInseridos.push({ produto_id: p.id, preco_base: Number(base.toFixed(2)), preco_promocional: promo })
        }

        await tx.insert(auditoriaAcessos).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          targetUserNome: codigo,
          acao: 'PROMOCAO_FEFO_CRIADA',
          detalhesDepois: { tabela_id: tabId, nome, desconto_pct: descPct, qtd_produtos: itensInseridos.length, data_fim: dataFim },
          executorId: ctx.operador.id,
          executorNome: ctx.operador.nome,
        })

        return { id: tabId, codigo, nome, data_inicio: hoje, data_fim: dataFim, desconto_pct: descPct, itens: itensInseridos }
      })

      return reply.status(201).send({ success: true, data: out })
    },
  )

  // Ação rápida FEFO #2: Baixar Perda / Descarte Controlado (Caixa Estoque, Etiqueta Açougue ou Manual)
  app.post(
    '/api/governanca/fefo/baixar-perda',
    { preHandler: requirePermission(PERM_GOV_WRITE) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        origem?: 'ESTOQUE_CAIXA' | 'ETIQUETA_ACOUGUE' | 'MANUAL'
        caixa_id?: string
        etiqueta_id?: string
        produto_id?: string
        qtd_kg?: number
        motivo?: string
        observacoes?: string
      }

      const motivoRaw = String(body.motivo || 'VENCIMENTO').toUpperCase()
      const motivo = MOTIVOS_PERDA_VALIDOS.includes(motivoRaw) ? motivoRaw : 'OUTROS'
      const obs = String(body.observacoes || '').trim()

      const resPerda = await conn.db.transaction(async (tx) => {
        const codigo = await gerarCodigoDocumento(tx, ctx.tenantId, 'PERDA_ESTOQUE', 'PRD', 4)
        const id = uuidv7()
        const origem = body.caixa_id
          ? 'ESTOQUE_CAIXA'
          : body.etiqueta_id
            ? 'ETIQUETA_ACOUGUE'
            : body.origem || 'MANUAL'

        if (origem === 'ESTOQUE_CAIXA' && body.caixa_id) {
          const caixaId = parseUuidOrBadRequest(body.caixa_id, 'caixa_id')
          const [cx] = await tx
            .select({
              id: estoqueCaixas.id,
              eanCaixa: estoqueCaixas.eanCaixa,
              produtoId: estoqueCaixas.produtoId,
              endereco: estoqueCaixas.endereco,
              lote: estoqueCaixas.lote,
              validade: estoqueCaixas.validade,
              pesoKg: estoqueCaixas.pesoKg,
              custoUnitarioKg: estoqueCaixas.custoUnitarioKg,
              status: estoqueCaixas.status,
              prodCod: produtos.codigo,
              prodDesc: produtos.descricao,
              prodCusto: produtos.custoMedioKg,
            })
            .from(estoqueCaixas)
            .innerJoin(produtos, eq(produtos.id, estoqueCaixas.produtoId))
            .where(and(eq(estoqueCaixas.id, caixaId), eq(estoqueCaixas.tenantId, ctx.tenantId)))
            .limit(1)
          if (!cx) throw new HttpError(404, 'Caixa não encontrada no estoque.')
          if (cx.status !== 'DISPONIVEL') {
            throw new HttpError(409, `Caixa ${cx.eanCaixa} não está disponível (status: ${cx.status}).`)
          }

          const peso = toNum(cx.pesoKg, 0)
          const custoUnit = toNum(cx.custoUnitarioKg, 0) || toNum(cx.prodCusto, 0)
          const custoTotal = Number((peso * custoUnit).toFixed(2))

          await tx
            .update(estoqueCaixas)
            .set({ status: 'DESCARTADO', updatedAt: new Date() })
            .where(eq(estoqueCaixas.id, caixaId))

          if (cx.endereco) {
            await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, [cx.endereco])
          }

          await registrarHistoricoCaixa(tx, {
            tenantId: ctx.tenantId,
            caixaId,
            eanCaixa: cx.eanCaixa,
            operacao: 'DESCARTE_PERDA',
            detalhes: `Perda ${codigo} (${motivo}) — Origem: ${cx.endereco || 'N/A'} -> DESCARTE${obs ? ` · ${obs}` : ''}`,
            operadorNome: ctx.operador.nome,
          })

          await registrarMovimentacaoLog(tx, {
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            produtoId: cx.produtoId,
            enderecoOrigem: cx.endereco || '',
            enderecoDestino: 'DESCARTE',
            lote: cx.lote || '',
            qtdCaixas: 1,
            qtdKg: peso,
            operadorId: ctx.operador.id,
            operadorNome: ctx.operador.nome,
            tipo: 'BAIXA_PERDA',
            numPedido: codigo,
          })

          await tx.insert(perdasRegistro).values({
            id,
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            codigo,
            origem: 'ESTOQUE_CAIXA',
            caixaId,
            eanCaixa: cx.eanCaixa,
            produtoId: cx.produtoId,
            produtoCodigo: cx.prodCod || '',
            produtoDescricao: cx.prodDesc,
            lote: cx.lote || '',
            validade: cx.validade,
            endereco: cx.endereco || '',
            motivo,
            qtdKg: toDec(peso, 3),
            custoUnitario: toDec(custoUnit, 4),
            custoTotalPerda: toDec(custoTotal, 2),
            observacoes: obs,
            operadorId: ctx.operador.id,
            operadorNome: ctx.operador.nome,
          })

          await tx.insert(auditoriaAcessos).values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            targetUserNome: cx.eanCaixa,
            acao: 'BAIXA_PERDA_ESTOQUE',
            detalhesDepois: { codigo, motivo, qtd_kg: peso, custo_total_perda: custoTotal, observacoes: obs },
            executorId: ctx.operador.id,
            executorNome: ctx.operador.nome,
          })

          return { id, codigo, qtd_kg: peso, custo_total_perda: custoTotal }
        }

        if (origem === 'ETIQUETA_ACOUGUE' && body.etiqueta_id) {
          const etqId = parseUuidOrBadRequest(body.etiqueta_id, 'etiqueta_id')
          const [etq] = await tx
            .select({
              id: etiquetasAcougue.id,
              codigoEtiqueta: etiquetasAcougue.codigoEtiqueta,
              produtoId: etiquetasAcougue.produtoId,
              produtoCodigo: etiquetasAcougue.produtoCodigo,
              produtoDescricao: etiquetasAcougue.produtoDescricao,
              lote: etiquetasAcougue.lote,
              validade: etiquetasAcougue.validade,
              pesoLiquidoKg: etiquetasAcougue.pesoLiquidoKg,
              status: etiquetasAcougue.status,
              prodCusto: produtos.custoMedioKg,
            })
            .from(etiquetasAcougue)
            .innerJoin(produtos, eq(produtos.id, etiquetasAcougue.produtoId))
            .where(and(eq(etiquetasAcougue.id, etqId), eq(etiquetasAcougue.tenantId, ctx.tenantId)))
            .limit(1)
          if (!etq) throw new HttpError(404, 'Etiqueta do açougue não encontrada.')
          if (etq.status !== 'EM_ESTOQUE') {
            throw new HttpError(409, `Etiqueta ${etq.codigoEtiqueta} não está em estoque (status: ${etq.status}).`)
          }

          const peso = toNum(etq.pesoLiquidoKg, 0)
          const custoUnit = toNum(etq.prodCusto, 0)
          const custoTotal = Number((peso * custoUnit).toFixed(2))

          await tx
            .update(etiquetasAcougue)
            .set({ status: 'PERDA_DESCARTE' })
            .where(eq(etiquetasAcougue.id, etqId))

          await tx.insert(perdasRegistro).values({
            id,
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            codigo,
            origem: 'ETIQUETA_ACOUGUE',
            caixaId: etqId,
            eanCaixa: etq.codigoEtiqueta,
            produtoId: etq.produtoId,
            produtoCodigo: etq.produtoCodigo,
            produtoDescricao: etq.produtoDescricao,
            lote: etq.lote,
            validade: etq.validade,
            endereco: 'ACOUGUE-LOJA',
            motivo,
            qtdKg: toDec(peso, 3),
            custoUnitario: toDec(custoUnit, 4),
            custoTotalPerda: toDec(custoTotal, 2),
            observacoes: obs,
            operadorId: ctx.operador.id,
            operadorNome: ctx.operador.nome,
          })

          await tx.insert(auditoriaAcessos).values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            targetUserNome: etq.codigoEtiqueta,
            acao: 'BAIXA_PERDA_ESTOQUE',
            detalhesDepois: { codigo, motivo, qtd_kg: peso, custo_total_perda: custoTotal },
            executorId: ctx.operador.id,
            executorNome: ctx.operador.nome,
          })

          return { id, codigo, qtd_kg: peso, custo_total_perda: custoTotal }
        }

        // Perda manual (ex.: quebra de desossa / apara descartada)
        const prodId = parseUuidOrBadRequest(body.produto_id || '', 'produto_id')
        const peso = toNum(body.qtd_kg, 0)
        if (peso <= 0) throw new HttpError(400, 'Informe o peso da perda maior que zero.')
        const [prod] = await tx
          .select({ codigo: produtos.codigo, descricao: produtos.descricao, custoMedioKg: produtos.custoMedioKg })
          .from(produtos)
          .where(and(eq(produtos.id, prodId), eq(produtos.tenantId, ctx.tenantId)))
          .limit(1)
        if (!prod) throw new HttpError(404, 'Produto não encontrado.')

        const custoUnit = toNum(prod.custoMedioKg, 0)
        const custoTotal = Number((peso * custoUnit).toFixed(2))
        await tx.insert(perdasRegistro).values({
          id,
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          codigo,
          origem: 'MANUAL',
          produtoId: prodId,
          produtoCodigo: prod.codigo || '',
          produtoDescricao: prod.descricao,
          motivo,
          qtdKg: toDec(peso, 3),
          custoUnitario: toDec(custoUnit, 4),
          custoTotalPerda: toDec(custoTotal, 2),
          observacoes: obs,
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
        })
        return { id, codigo, qtd_kg: peso, custo_total_perda: custoTotal }
      })

      return reply.status(201).send({ success: true, ...resPerda })
    },
  )

  app.get(
    '/api/governanca/perdas',
    { preHandler: requirePermission(PERM_GOV_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { mes?: string }
      const mesRef = q.mes && /^\d{4}-\d{2}$/.test(q.mes) ? q.mes : hojeIsoLocal().slice(0, 7)
      const dataIni = `${mesRef}-01`
      const [anoNum, mesNum] = mesRef.split('-').map(Number)
      const dataFim = `${mesRef}-${String(new Date(Date.UTC(anoNum, mesNum, 0)).getUTCDate()).padStart(2, '0')}`

      const rows = await conn.db
        .select()
        .from(perdasRegistro)
        .where(
          and(
            eq(perdasRegistro.tenantId, ctx.tenantId),
            eq(perdasRegistro.filialId, ctx.filialId),
            sql`DATE(${perdasRegistro.createdAt} AT TIME ZONE 'America/Sao_Paulo') >= ${dataIni}::date`,
            sql`DATE(${perdasRegistro.createdAt} AT TIME ZONE 'America/Sao_Paulo') <= ${dataFim}::date`,
          ),
        )
        .orderBy(desc(perdasRegistro.createdAt))
        .limit(200)

      const porMotivo = new Map<string, { motivo: string; qtd: number; kg: number; valor: number }>()
      let totalKg = 0
      let totalValor = 0
      for (const r of rows) {
        const kg = toNum(r.qtdKg, 0)
        const val = toNum(r.custoTotalPerda, 0)
        totalKg += kg
        totalValor += val
        const cur = porMotivo.get(r.motivo) || { motivo: r.motivo, qtd: 0, kg: 0, valor: 0 }
        cur.qtd += 1
        cur.kg = Number((cur.kg + kg).toFixed(3))
        cur.valor = Number((cur.valor + val).toFixed(2))
        porMotivo.set(r.motivo, cur)
      }

      return {
        success: true,
        mes: mesRef,
        resumo: {
          total_registros: rows.length,
          total_kg: Number(totalKg.toFixed(2)),
          total_custo: Number(totalValor.toFixed(2)),
          por_motivo: Array.from(porMotivo.values()).sort((a, b) => b.valor - a.valor),
        },
        data: rows.map((r) => ({
          id: r.id,
          codigo: r.codigo,
          origem: r.origem,
          ean_caixa: r.eanCaixa,
          produto_codigo: r.produtoCodigo,
          produto_descricao: r.produtoDescricao,
          lote: r.lote,
          validade: r.validade,
          endereco: r.endereco,
          motivo: r.motivo,
          qtd_kg: toNum(r.qtdKg, 0),
          custo_unitario: toNum(r.custoUnitario, 0),
          custo_total_perda: toNum(r.custoTotalPerda, 0),
          observacoes: r.observacoes,
          operador_nome: r.operadorNome,
          created_at: r.createdAt,
        })),
      }
    },
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // 4) RADAR ANTIFRAUDE & AUDITORIA DE EVENTOS SENSÍVEIS
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(
    '/api/governanca/antifraude',
    { preHandler: requirePermission(PERM_GOV_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { dias?: string }
      const dias = Math.min(365, Math.max(1, Math.round(Number(q.dias || 30))))
      const dataCorte = somarDiasIso(hojeIsoLocal(), -dias)

      const [cancelPdv, descPdv, caixasQuebra, pedsComerciais, perdasRows, invAjustes, audRows] = await Promise.all([
        conn.db
          .select({
            id: pdvVendas.id,
            codigo: pdvVendas.codigo,
            valor_total: pdvVendas.valorTotal,
            operador_nome: pdvVendas.operadorNome,
            motivo: pdvVendas.motivoCancelamento,
            data: pdvVendas.canceladaEm,
            created_at: pdvVendas.createdAt,
          })
          .from(pdvVendas)
          .where(
            and(
              eq(pdvVendas.tenantId, ctx.tenantId),
              eq(pdvVendas.status, 'CANCELADA'),
              sql`DATE(${pdvVendas.createdAt}) >= ${dataCorte}::date`,
            ),
          )
          .orderBy(desc(pdvVendas.createdAt))
          .limit(100),
        conn.db
          .select({
            id: pdvVendas.id,
            codigo: pdvVendas.codigo,
            desconto_pct: pdvVendas.descontoPct,
            desconto_valor: pdvVendas.descontoValor,
            valor_total: pdvVendas.valorTotal,
            operador_nome: pdvVendas.operadorNome,
            created_at: pdvVendas.createdAt,
          })
          .from(pdvVendas)
          .where(
            and(
              eq(pdvVendas.tenantId, ctx.tenantId),
              eq(pdvVendas.status, 'CONCLUIDA'),
              sql`(${pdvVendas.descontoPct} >= 10 OR ${pdvVendas.descontoValor} >= 50)`,
              sql`DATE(${pdvVendas.createdAt}) >= ${dataCorte}::date`,
            ),
          )
          .orderBy(desc(pdvVendas.createdAt))
          .limit(100),
        conn.db
          .select({
            id: pdvCaixas.id,
            codigo: pdvCaixas.codigo,
            operador_nome: pdvCaixas.operadorNome,
            diferenca_quebra: pdvCaixas.diferencaQuebra,
            fechado_em: pdvCaixas.fechadoEm,
          })
          .from(pdvCaixas)
          .where(
            and(
              eq(pdvCaixas.tenantId, ctx.tenantId),
              sql`${pdvCaixas.diferencaQuebra} IS NOT NULL AND ABS(${pdvCaixas.diferencaQuebra}) >= 1`,
              sql`DATE(${pdvCaixas.abertoEm}) >= ${dataCorte}::date`,
            ),
          )
          .orderBy(desc(pdvCaixas.fechadoEm))
          .limit(50),
        conn.db
          .select({
            id: pedidos.id,
            codigo: pedidos.codigo,
            cliente: pedidos.cliente,
            status: pedidos.status,
            valor_total: pedidos.valorTotal,
            margem_bruta_pct: pedidos.margemBrutaPct,
            aprovado_por: pedidos.aprovadoComercialPorNome,
            aprovado_obs: pedidos.aprovadoComercialObs,
            criado_por: pedidos.criadoPorNome,
            created_at: pedidos.createdAt,
          })
          .from(pedidos)
          .where(
            and(
              eq(pedidos.tenantId, ctx.tenantId),
              sql`(${pedidos.status} = 'BLOQUEADO_COMERCIAL' OR ${pedidos.aprovadoComercialEm} IS NOT NULL)`,
              sql`DATE(${pedidos.createdAt}) >= ${dataCorte}::date`,
            ),
          )
          .orderBy(desc(pedidos.createdAt))
          .limit(80),
        conn.db
          .select()
          .from(perdasRegistro)
          .where(
            and(
              eq(perdasRegistro.tenantId, ctx.tenantId),
              sql`DATE(${perdasRegistro.createdAt}) >= ${dataCorte}::date`,
            ),
          )
          .orderBy(desc(perdasRegistro.createdAt))
          .limit(80),
        conn.db
          .select({
            id: inventarioAjustesLog.id,
            endereco: inventarioAjustesLog.endereco,
            tipo_ajuste: inventarioAjustesLog.tipoAjuste,
            qtd_kg: inventarioAjustesLog.qtdAjustadaKg,
            custo_unit: inventarioAjustesLog.custoUnitarioData,
            aprovou: inventarioAjustesLog.usuarioAprovouNome,
            data_ajuste: inventarioAjustesLog.dataAjuste,
          })
          .from(inventarioAjustesLog)
          .where(
            and(
              eq(inventarioAjustesLog.tenantId, ctx.tenantId),
              sql`DATE(${inventarioAjustesLog.dataAjuste}) >= ${dataCorte}::date`,
            ),
          )
          .orderBy(desc(inventarioAjustesLog.dataAjuste))
          .limit(80),
        conn.db
          .select()
          .from(auditoriaAcessos)
          .where(
            and(
              eq(auditoriaAcessos.tenantId, ctx.tenantId),
              sql`DATE(${auditoriaAcessos.createdAt}) >= ${dataCorte}::date`,
            ),
          )
          .orderBy(desc(auditoriaAcessos.createdAt))
          .limit(120),
      ])

      type EventoRisco = {
        id: string
        categoria: 'CANCELAMENTO_PDV' | 'DESCONTO_ALTO' | 'QUEBRA_CAIXA' | 'TRAVA_COMERCIAL' | 'PERDA_ESTOQUE' | 'AJUSTE_INVENTARIO' | 'AUDITORIA_GOVERNANCA'
        severidade: 'ALTA' | 'MEDIA' | 'INFO'
        titulo: string
        detalhe: string
        operador: string
        valor_impacto: number
        data_hora: string
      }

      const eventos: EventoRisco[] = []
      const porOperador = new Map<string, { operador: string; qtd_alertas: number; valor_impacto: number }>()
      const acumOp = (nome: string, val: number) => {
        const key = (nome || 'Sistema').trim()
        const cur = porOperador.get(key) || { operador: key, qtd_alertas: 0, valor_impacto: 0 }
        cur.qtd_alertas += 1
        cur.valor_impacto = Number((cur.valor_impacto + Math.abs(val)).toFixed(2))
        porOperador.set(key, cur)
      }

      for (const c of cancelPdv) {
        const v = toNum(c.valor_total, 0)
        acumOp(c.operador_nome, v)
        eventos.push({
          id: `cp-${c.id}`,
          categoria: 'CANCELAMENTO_PDV',
          severidade: v >= 150 ? 'ALTA' : 'MEDIA',
          titulo: `Cancelamento PDV ${c.codigo}`,
          detalhe: c.motivo || 'Venda cancelada no caixa',
          operador: c.operador_nome || 'Operador',
          valor_impacto: v,
          data_hora: new Date(c.data || c.created_at).toISOString(),
        })
      }

      for (const d of descPdv) {
        const v = toNum(d.desconto_valor, 0)
        acumOp(d.operador_nome, v)
        eventos.push({
          id: `dp-${d.id}`,
          categoria: 'DESCONTO_ALTO',
          severidade: toNum(d.desconto_pct, 0) >= 20 || v >= 100 ? 'ALTA' : 'MEDIA',
          titulo: `Desconto Alto PDV ${d.codigo} (${toNum(d.desconto_pct, 0).toFixed(1)}%)`,
          detalhe: `Desconto de R$ ${v.toFixed(2)} sobre venda de R$ ${toNum(d.valor_total, 0).toFixed(2)}`,
          operador: d.operador_nome || 'Operador',
          valor_impacto: v,
          data_hora: new Date(d.created_at).toISOString(),
        })
      }

      for (const qx of caixasQuebra) {
        const dif = toNum(qx.diferenca_quebra, 0)
        acumOp(qx.operador_nome, Math.abs(dif))
        eventos.push({
          id: `qx-${qx.id}`,
          categoria: 'QUEBRA_CAIXA',
          severidade: Math.abs(dif) >= 20 ? 'ALTA' : 'MEDIA',
          titulo: `Divergência Fechamento Caixa ${qx.codigo}`,
          detalhe: dif < 0 ? `Falta de R$ ${Math.abs(dif).toFixed(2)} no fechamento` : `Sobra de R$ ${dif.toFixed(2)} no fechamento`,
          operador: qx.operador_nome || 'Operador',
          valor_impacto: Math.abs(dif),
          data_hora: new Date(qx.fechado_em || Date.now()).toISOString(),
        })
      }

      for (const p of pedsComerciais) {
        const v = toNum(p.valor_total, 0)
        acumOp(p.criado_por || p.aprovado_por || 'Comercial', 0)
        eventos.push({
          id: `pc-${p.id}`,
          categoria: 'TRAVA_COMERCIAL',
          severidade: p.margem_bruta_pct != null && toNum(p.margem_bruta_pct, 0) < 0 ? 'ALTA' : 'MEDIA',
          titulo: `Trava Comercial ${p.codigo} — ${p.cliente}`,
          detalhe: p.aprovado_por
            ? `Aprovado por ${p.aprovado_por}${p.aprovado_obs ? ` (${p.aprovado_obs})` : ''}`
            : `Aguardando aprovação • Margem ${p.margem_bruta_pct ?? '—'}%`,
          operador: p.criado_por || 'Vendedor',
          valor_impacto: v,
          data_hora: new Date(p.created_at).toISOString(),
        })
      }

      for (const pr of perdasRows) {
        const v = toNum(pr.custoTotalPerda, 0)
        acumOp(pr.operadorNome, v)
        eventos.push({
          id: `pr-${pr.id}`,
          categoria: 'PERDA_ESTOQUE',
          severidade: v >= 200 || pr.motivo === 'FURTO_DIVERGENCIA' ? 'ALTA' : 'MEDIA',
          titulo: `Perda ${pr.codigo} (${pr.motivo}) — ${pr.produtoDescricao}`,
          detalhe: `${toNum(pr.qtdKg, 0).toFixed(2)} kg • ${pr.observacoes || pr.eanCaixa || pr.origem}`,
          operador: pr.operadorNome || 'Operador',
          valor_impacto: v,
          data_hora: new Date(pr.createdAt).toISOString(),
        })
      }

      for (const aj of invAjustes) {
        const val = Number(Math.abs(toNum(aj.qtd_kg, 0) * toNum(aj.custo_unit, 0)).toFixed(2))
        if (val > 0 || Math.abs(toNum(aj.qtd_kg, 0)) > 0) {
          acumOp(aj.aprovou || 'Inventário', val)
          eventos.push({
            id: `aj-${aj.id}`,
            categoria: 'AJUSTE_INVENTARIO',
            severidade: val >= 200 ? 'ALTA' : 'INFO',
            titulo: `Ajuste Inventário (${aj.tipo_ajuste || 'DIVERGÊNCIA'}) • ${aj.endereco || '-'}`,
            detalhe: `Delta: ${toNum(aj.qtd_kg, 0).toFixed(2)} kg`,
            operador: aj.aprovou || 'Sistema',
            valor_impacto: val,
            data_hora: new Date(aj.data_ajuste).toISOString(),
          })
        }
      }

      const acoesSens = new Set([
        'APROVACAO_TRAVA_COMERCIAL',
        'CARGA_INICIAL_EMPORIO',
        'AJUSTE_MANUAL_EMPORIO',
        'TROCA_TABELA_ACOUGUE',
        'PROMOCAO_FEFO_CRIADA',
        'COTACAO_FECHADA_GEROU_PC',
      ])
      for (const au of audRows) {
        if (!acoesSens.has(au.acao)) continue
        eventos.push({
          id: `au-${au.id}`,
          categoria: 'AUDITORIA_GOVERNANCA',
          severidade: au.acao === 'AJUSTE_MANUAL_EMPORIO' ? 'MEDIA' : 'INFO',
          titulo: `${au.acao.replace(/_/g, ' ')} • ${au.targetUserNome || ''}`.trim(),
          detalhe: JSON.stringify(au.detalhesDepois || {}).slice(0, 140),
          operador: au.executorNome || 'Sistema',
          valor_impacto: 0,
          data_hora: new Date(au.createdAt).toISOString(),
        })
      }

      eventos.sort((a, b) => new Date(b.data_hora).getTime() - new Date(a.data_hora).getTime())

      const totalCancelPdv = Number(cancelPdv.reduce((s, c) => s + toNum(c.valor_total, 0), 0).toFixed(2))
      const totalQuebraCaixa = Number(caixasQuebra.reduce((s, c) => s + Math.abs(toNum(c.diferenca_quebra, 0)), 0).toFixed(2))
      const totalPerdas = Number(perdasRows.reduce((s, p) => s + toNum(p.custoTotalPerda, 0), 0).toFixed(2))
      const totalDescPdv = Number(descPdv.reduce((s, d) => s + toNum(d.desconto_valor, 0), 0).toFixed(2))
      const alertasAltos = eventos.filter((e) => e.severidade === 'ALTA').length
      const nivelRisco = alertasAltos >= 5 || totalPerdas + totalCancelPdv + totalQuebraCaixa >= 2000 ? 'ALTO' : alertasAltos >= 1 ? 'MODERADO' : 'BAIXO'

      return {
        success: true,
        periodo_dias: dias,
        resumo: {
          nivel_risco: nivelRisco,
          total_eventos: eventos.length,
          alertas_alta_severidade: alertasAltos,
          cancelamentos_pdv_qtd: cancelPdv.length,
          cancelamentos_pdv_valor: totalCancelPdv,
          descontos_altos_qtd: descPdv.length,
          descontos_altos_valor: totalDescPdv,
          quebras_caixa_qtd: caixasQuebra.length,
          quebras_caixa_valor: totalQuebraCaixa,
          travas_comerciais_qtd: pedsComerciais.length,
          perdas_estoque_qtd: perdasRows.length,
          perdas_estoque_valor: totalPerdas,
        },
        ranking_operadores: Array.from(porOperador.values())
          .sort((a, b) => b.valor_impacto - a.valor_impacto || b.qtd_alertas - a.qtd_alertas)
          .slice(0, 10),
        eventos: eventos.slice(0, 150),
      }
    },
  )
}
