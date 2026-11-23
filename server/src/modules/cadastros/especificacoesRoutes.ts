import type { FastifyInstance } from 'fastify'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DbConnection } from '../../db/client.js'
import {
  estoqueCaixas,
  produtoEspecificacoes,
  produtos,
  tabelasPreco,
  tabelasPrecoItens,
  varejoEstoque,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import { parseUuidOrBadRequest, toDec, toNum } from '../wms/helpers.js'

const PERM_PROD_READ = [
  'produtos',
  'consulta_estoque',
  'recebimento',
  'compras',
  'retorno_producao',
  'producao_criar_op',
  'mapa_producao',
  'desmembramento',
  'reimpressao',
  'varejo_acougue',
  'pdv_caixa',
]

/**
 * Calcula em lote (2 queries leves) o Preço Médio de Venda em tempo real (últimos 90 dias)
 * e o Estoque Mínimo Dinâmico (baseado no consumo real dos últimos 30 dias em OPs + Pedidos + PDV).
 */
export async function calcularMetricasProdutosEmLote(db: any, tenantId: string, diasCobertura = 7) {
  const [vendasPedidosRes, vendasPdvRes, consumoOpRes, consumoSaidaRes, consumoPdvRes] = await Promise.all([
    db.execute(sql`
      SELECT pi.produto_id,
             COALESCE(SUM(pi.preco_unitario * (1 - COALESCE(pi.desconto_pct, 0) / 100.0) * COALESCE(NULLIF(pi.qtd_kg_solicitada, 0), 1)), 0) AS soma_val,
             COALESCE(SUM(COALESCE(NULLIF(pi.qtd_kg_solicitada, 0), 1)), 0) AS soma_qtd
      FROM pedidos_itens pi
      JOIN pedidos p ON p.id = pi.pedido_id
      WHERE pi.tenant_id = ${tenantId}
        AND p.status NOT IN ('CANCELADO')
        AND pi.preco_unitario > 0
        AND p.created_at >= NOW() - INTERVAL '90 days'
      GROUP BY pi.produto_id
    `),
    db.execute(sql`
      SELECT itens_json
      FROM pdv_vendas
      WHERE tenant_id = ${tenantId}
        AND status = 'CONCLUIDA'
        AND created_at >= NOW() - INTERVAL '90 days'
      ORDER BY created_at DESC
      LIMIT 1000
    `),
    db.execute(sql`
      SELECT produto_id, COALESCE(SUM(peso_kg), 0) AS total_kg
      FROM op_insumos
      WHERE tenant_id = ${tenantId}
        AND produto_id IS NOT NULL
        AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY produto_id
    `),
    db.execute(sql`
      SELECT ri.produto_id, COALESCE(SUM(ri.peso_kg), 0) AS total_kg
      FROM romaneios_itens ri
      JOIN romaneios r ON r.id = ri.romaneio_id
      WHERE ri.tenant_id = ${tenantId}
        AND r.created_at >= NOW() - INTERVAL '30 days'
      GROUP BY ri.produto_id
    `),
    db.execute(sql`
      SELECT produto_id, COALESCE(SUM(ABS(qtd)), 0) AS total_qtd
      FROM varejo_movimentacoes
      WHERE tenant_id = ${tenantId}
        AND tipo = 'VENDA_PDV'
        AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY produto_id
    `),
  ])

  // Agrega Preço Médio de Venda (Pedidos + PDV)
  const vendaAgg = new Map<string, { val: number; qtd: number }>()
  for (const r of vendasPedidosRes.rows as Array<{ produto_id: string; soma_val: string; soma_qtd: string }>) {
    const val = toNum(r.soma_val, 0)
    const qtd = toNum(r.soma_qtd, 0)
    if (qtd > 0 && val > 0) vendaAgg.set(r.produto_id, { val, qtd })
  }
  for (const r of vendasPdvRes.rows as Array<{ itens_json: Array<Record<string, unknown>> }>) {
    for (const it of Array.isArray(r.itens_json) ? r.itens_json : []) {
      const pid = String(it.produto_id || '')
      const qtd = Number(it.qtd || 0)
      const val = Number(it.valor_total || 0)
      if (!pid || qtd <= 0 || val <= 0) continue
      const cur = vendaAgg.get(pid) || { val: 0, qtd: 0 }
      vendaAgg.set(pid, { val: cur.val + val, qtd: cur.qtd + qtd })
    }
  }

  // Agrega Consumo 30d (OPs + Pedidos/Romaneios + PDV)
  const consOpMap = new Map<string, number>()
  const consPedMap = new Map<string, number>()
  const consPdvMap = new Map<string, number>()
  for (const r of consumoOpRes.rows as Array<{ produto_id: string; total_kg: string }>) {
    consOpMap.set(r.produto_id, toNum(r.total_kg, 0))
  }
  for (const r of consumoSaidaRes.rows as Array<{ produto_id: string; total_kg: string }>) {
    consPedMap.set(r.produto_id, toNum(r.total_kg, 0))
  }
  for (const r of consumoPdvRes.rows as Array<{ produto_id: string; total_qtd: string }>) {
    consPdvMap.set(r.produto_id, toNum(r.total_qtd, 0))
  }

  const getMetricas = (produtoId: string) => {
    const v = vendaAgg.get(produtoId)
    const precoMedioVenda = v && v.qtd > 0 ? Number((v.val / v.qtd).toFixed(2)) : 0
    const consOp30 = consOpMap.get(produtoId) || 0
    const consPed30 = consPedMap.get(produtoId) || 0
    const consPdv30 = consPdvMap.get(produtoId) || 0
    const consTotal30 = consOp30 + consPed30 + consPdv30
    const mediaDiaOp = Number((consOp30 / 30).toFixed(3))
    const mediaDiaPed = Number((consPed30 / 30).toFixed(3))
    const mediaDiaPdv = Number((consPdv30 / 30).toFixed(3))
    const mediaDiaTotal = Number((consTotal30 / 30).toFixed(3))
    const estoqueMinimoDinamico = Number((mediaDiaTotal * diasCobertura).toFixed(2))
    return {
      preco_medio_venda: precoMedioVenda,
      consumo_30d_op_kg: Number(consOp30.toFixed(3)),
      consumo_30d_pedidos_kg: Number(consPed30.toFixed(3)),
      consumo_30d_pdv_kg: Number(consPdv30.toFixed(3)),
      consumo_medio_dia_op_kg: mediaDiaOp,
      consumo_medio_dia_pedidos_kg: mediaDiaPed,
      consumo_medio_dia_pdv_kg: mediaDiaPdv,
      consumo_medio_dia_total_kg: mediaDiaTotal,
      estoque_minimo_dinamico_kg: estoqueMinimoDinamico,
    }
  }

  return { getMetricas }
}

export function registerEspecificacoesRoutes(app: FastifyInstance, conn: DbConnection): void {
  const { requirePermission } = createAuthMiddleware(app, conn)

  // ── 1) CRUD ESPECIFICAÇÕES DE PRODUTO (DENOMINAÇÃO DE VENDA / RÓTULO) ──────
  app.get(
    '/api/cadastros/especificacoes',
    { preHandler: requirePermission(PERM_PROD_READ, { write: false, bloquearCliente: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const [rows, countsRes] = await Promise.all([
        conn.db
          .select()
          .from(produtoEspecificacoes)
          .where(and(eq(produtoEspecificacoes.tenantId, ctx.tenantId), eq(produtoEspecificacoes.ativo, 1)))
          .orderBy(asc(produtoEspecificacoes.especie), asc(produtoEspecificacoes.nome)),
        conn.db.execute(sql`
          SELECT especificacao_id, COUNT(*)::int AS qtd
          FROM produtos
          WHERE tenant_id = ${ctx.tenantId} AND especificacao_id IS NOT NULL
          GROUP BY especificacao_id
        `),
      ])
      const countMap = new Map<string, number>()
      for (const c of countsRes.rows as Array<{ especificacao_id: string; qtd: number }>) {
        countMap.set(c.especificacao_id, Number(c.qtd || 0))
      }

      return {
        success: true,
        data: rows.map((r) => ({
          id: r.id,
          codigo: r.codigo,
          nome: r.nome,
          especie: r.especie,
          conservacao: r.conservacao,
          com_osso: /\bCOM OSSO\b/i.test(r.nome) ? 1 : 0,
          temperatura_rotulo: r.temperaturaRotulo || '',
          validade_dias_padrao: r.validadeDiasPadrao,
          qtd_produtos: countMap.get(r.id) || 0,
          ativo: r.ativo,
        })),
      }
    },
  )

  app.post(
    '/api/cadastros/especificacoes',
    { preHandler: requirePermission(['produtos']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        codigo?: string
        nome?: string
        especie?: string
        conservacao?: string
        temperatura_rotulo?: string
        validade_dias_padrao?: number | null
      }
      const nome = String(body.nome || '').trim().toUpperCase()
      if (!nome) throw new HttpError(400, 'Informe o nome da especificação (ex: CARNE RESFRIADA DE BOVINO SEM OSSO).')

      const especie = String(body.especie || 'BOVINO').trim().toUpperCase()
      const conservacao = String(body.conservacao || 'RESFRIADO').trim().toUpperCase()
      const codigo =
        String(body.codigo || '')
          .trim()
          .toUpperCase() || `ESP-${Date.now().toString().slice(-6)}`
      const tempDefault =
        conservacao === 'CONGELADO'
          ? 'MANTER CONGELADO A -18°C OU MAIS FRIO'
          : conservacao === 'SECO'
            ? 'CONSERVAR EM LOCAL SECO E FRESCO'
            : 'MANTER RESFRIADO DE 0°C A 4°C'

      const id = uuidv7()
      await conn.db.insert(produtoEspecificacoes).values({
        id,
        tenantId: ctx.tenantId,
        codigo,
        nome,
        especie,
        conservacao,
        temperaturaRotulo: String(body.temperatura_rotulo || '').trim().toUpperCase() || tempDefault,
        validadeDiasPadrao:
          body.validade_dias_padrao != null && Number.isFinite(Number(body.validade_dias_padrao))
            ? Math.max(0, Math.trunc(Number(body.validade_dias_padrao)))
            : null,
        ativo: 1,
      })

      return reply.code(201).send({ success: true, data: { id, codigo, nome, especie, conservacao } })
    },
  )

  app.put(
    '/api/cadastros/especificacoes/:id',
    { preHandler: requirePermission(['produtos']) },
    async (req) => {
      const ctx = req.authCtx!
      const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'especificacao_id')
      const body = (req.body || {}) as {
        codigo?: string
        nome?: string
        especie?: string
        conservacao?: string
        temperatura_rotulo?: string
        validade_dias_padrao?: number | null
      }

      const [atual] = await conn.db
        .select()
        .from(produtoEspecificacoes)
        .where(and(eq(produtoEspecificacoes.id, id), eq(produtoEspecificacoes.tenantId, ctx.tenantId)))
        .limit(1)
      if (!atual) throw new HttpError(404, 'Especificação não encontrada.')

      await conn.db
        .update(produtoEspecificacoes)
        .set({
          codigo: body.codigo ? String(body.codigo).trim().toUpperCase() : atual.codigo,
          nome: body.nome ? String(body.nome).trim().toUpperCase() : atual.nome,
          especie: body.especie ? String(body.especie).trim().toUpperCase() : atual.especie,
          conservacao: body.conservacao ? String(body.conservacao).trim().toUpperCase() : atual.conservacao,
          temperaturaRotulo:
            body.temperatura_rotulo !== undefined
              ? String(body.temperatura_rotulo).trim().toUpperCase()
              : atual.temperaturaRotulo,
          validadeDiasPadrao:
            body.validade_dias_padrao !== undefined
              ? body.validade_dias_padrao === null || body.validade_dias_padrao === ('' as any)
                ? null
                : Math.max(0, Math.trunc(Number(body.validade_dias_padrao)))
              : atual.validadeDiasPadrao,
          updatedAt: new Date(),
        })
        .where(eq(produtoEspecificacoes.id, id))

      return { success: true }
    },
  )

  app.delete(
    '/api/cadastros/especificacoes/:id',
    { preHandler: requirePermission(['produtos']) },
    async (req) => {
      const ctx = req.authCtx!
      const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'especificacao_id')
      await conn.db
        .update(produtoEspecificacoes)
        .set({ ativo: 0, updatedAt: new Date() })
        .where(and(eq(produtoEspecificacoes.id, id), eq(produtoEspecificacoes.tenantId, ctx.tenantId)))
      return { success: true }
    },
  )

  // ── 2) EDIÇÃO EM LOTE DE PRODUTOS (ESPECIFICAÇÃO, CONSERVAÇÃO, VALIDADE, TARA) ──
  app.patch(
    '/api/cadastros/produtos/lote',
    { preHandler: requirePermission(['produtos']) },
    async (req) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        produto_ids?: string[]
        ids?: string[]
        especificacao_id?: string | null
        especie?: string
        conservacao?: string
        validade_dias?: number
        tara_embalagem_kg?: number
      }

      const rawIds = Array.isArray(body.produto_ids)
        ? body.produto_ids
        : Array.isArray(body.ids)
          ? body.ids
          : []
      const ids = rawIds.map((id) => parseUuidOrBadRequest(id, 'produto_id'))
      if (ids.length === 0) throw new HttpError(400, 'Selecione ao menos um produto para editar em lote.')

      const patch: Partial<typeof produtos.$inferInsert> = { updatedAt: new Date() }
      if (body.especificacao_id !== undefined) {
        patch.especificacaoId = body.especificacao_id
          ? parseUuidOrBadRequest(body.especificacao_id, 'especificacao_id')
          : null
      }
      if (body.especie !== undefined && body.especie !== '') {
        patch.especie = String(body.especie).trim().toUpperCase()
      }
      if (body.conservacao !== undefined && body.conservacao !== '') {
        patch.conservacao = String(body.conservacao).trim().toUpperCase()
      }
      if (body.validade_dias !== undefined && body.validade_dias !== ('' as any)) {
        patch.validadeDias = Math.max(0, Math.trunc(Number(body.validade_dias)))
      }
      if (body.tara_embalagem_kg !== undefined && body.tara_embalagem_kg !== ('' as any)) {
        patch.taraEmbalagemKg = toDec(Math.max(0, Number(body.tara_embalagem_kg)), 4)
      }

      await conn.db
        .update(produtos)
        .set(patch)
        .where(and(eq(produtos.tenantId, ctx.tenantId), inArray(produtos.id, ids)))

      return { success: true, atualizados: ids.length }
    },
  )

  // ── 3) RESUMO GERENCIAL EM TEMPO REAL DO PRODUTO (PARA O MODAL DO PRODUTO) ─
  app.get(
    '/api/cadastros/produtos/:id/resumo-gerencial',
    { preHandler: requirePermission(PERM_PROD_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const prodId = parseUuidOrBadRequest((req.params as { id: string }).id, 'produto_id')

      const [prod] = await conn.db
        .select()
        .from(produtos)
        .where(and(eq(produtos.id, prodId), eq(produtos.tenantId, ctx.tenantId)))
        .limit(1)
      if (!prod) throw new HttpError(404, 'Produto não encontrado.')

      const [metricasBatch, saldoCaixasRes, saldoVarejoRes, tabelasProd] = await Promise.all([
        calcularMetricasProdutosEmLote(conn.db, ctx.tenantId, 7),
        conn.db.execute(sql`
          SELECT COALESCE(SUM(peso_kg), 0) AS kg, COUNT(*)::int AS cx
          FROM estoque_caixas
          WHERE tenant_id = ${ctx.tenantId}
            AND produto_id = ${prodId}
            AND status IN ('DISPONIVEL', 'RESERVADA', 'ABERTA_ACOUGUE')
        `),
        conn.db
          .select({ saldoQtd: varejoEstoque.saldoQtd })
          .from(varejoEstoque)
          .where(and(eq(varejoEstoque.tenantId, ctx.tenantId), eq(varejoEstoque.produtoId, prodId))),
        conn.db
          .select({
            tabela_id: tabelasPreco.id,
            tabela_codigo: tabelasPreco.codigo,
            tabela_nome: tabelasPreco.nome,
            finalidade: tabelasPreco.finalidade,
            preco_venda: tabelasPrecoItens.precoVenda,
            desconto_pct: tabelasPrecoItens.descontoPct,
          })
          .from(tabelasPrecoItens)
          .innerJoin(tabelasPreco, eq(tabelasPreco.id, tabelasPrecoItens.tabelaPrecoId))
          .where(
            and(
              eq(tabelasPrecoItens.tenantId, ctx.tenantId),
              eq(tabelasPrecoItens.produtoId, prodId),
              eq(tabelasPreco.ativo, 1),
            ),
          )
          .orderBy(desc(tabelasPreco.padrao), asc(tabelasPreco.codigo)),
      ])

      const m = metricasBatch.getMetricas(prodId)
      const cxRow = (saldoCaixasRes.rows as Array<{ kg: string; cx: number }>)[0]
      const saldoCaixasKg = toNum(cxRow?.kg, 0)
      const saldoVarejoKg = saldoVarejoRes.reduce((s, r) => s + toNum(r.saldoQtd, 0), 0)
      const saldoTotal = Number(Math.max(saldoCaixasKg, saldoVarejoKg).toFixed(3))
      const coberturaDias =
        m.consumo_medio_dia_total_kg > 0 ? Number((saldoTotal / m.consumo_medio_dia_total_kg).toFixed(1)) : null

      const custo = toNum(prod.custoMedioKg, 0) || toNum(prod.ultimoPrecoCompra, 0)
      const margemRealPct =
        m.preco_medio_venda > 0 && custo > 0
          ? Number((((m.preco_medio_venda - custo) / m.preco_medio_venda) * 100).toFixed(1))
          : null

      return {
        success: true,
        data: {
          produto_id: prodId,
          ultimo_preco_compra: toNum(prod.ultimoPrecoCompra, 0),
          custo_medio_kg: toNum(prod.custoMedioKg, 0),
          preco_medio_venda: m.preco_medio_venda,
          margem_real_pct: margemRealPct,
          saldo_total_kg: saldoTotal,
          qtd_caixas_ativas: Number(cxRow?.cx || 0),
          consumo_30d_op_kg: m.consumo_30d_op_kg,
          consumo_30d_pedidos_kg: m.consumo_30d_pedidos_kg,
          consumo_30d_pdv_kg: m.consumo_30d_pdv_kg,
          consumo_medio_dia_op_kg: m.consumo_medio_dia_op_kg,
          consumo_medio_dia_pedidos_kg: m.consumo_medio_dia_pedidos_kg,
          consumo_medio_dia_pdv_kg: m.consumo_medio_dia_pdv_kg,
          consumo_medio_dia_total_kg: m.consumo_medio_dia_total_kg,
          estoque_minimo_dinamico_kg: m.estoque_minimo_dinamico_kg,
          cobertura_dias: coberturaDias,
          abaixo_minimo: m.estoque_minimo_dinamico_kg > 0 && saldoTotal < m.estoque_minimo_dinamico_kg,
          tabelas_preco: tabelasProd.map((t) => ({
            ...t,
            preco_venda: toNum(t.preco_venda, 0),
            desconto_pct: toNum(t.desconto_pct, 0),
          })),
        },
      }
    },
  )
}
