import type { FastifyInstance } from 'fastify'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DbConnection } from '../../db/client.js'
import {
  camarasTemperaturaLog,
  clientes,
  devolucoes,
  embarques,
  entregasTracking,
  estoqueCaixas,
  etiquetasAcougue,
  filiais,
  fornecedores,
  insumosEstoque,
  interunidadesMovimentacoes,
  inventarioAjustesLog,
  inventarioItens,
  inventarios,
  movimentacoesLog,
  pdvCaixas,
  pdvVendas,
  pedidos,
  pedidosCompra,
  pedidosCompraItens,
  pedidosItens,
  perdasRegistro,
  produtos,
  varejoEstoque,
  varejoInventarios,
  vendedores,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { hojeIsoLocal, parseUuidOrBadRequest, toNum } from '../wms/helpers.js'

const PERM_BI_READ = [
  'relatorios_estoque',
  'relatorios_producao',
  'dashboard_executivo',
  'produtos',
  'financeiro',
  'compras',
  'pedidos',
  'varejo_acougue',
  'roteirizacao',
]

function somarDiasIso(baseIso: string, delta: number): string {
  const ms = new Date(`${baseIso}T12:00:00Z`).getTime()
  return new Date(ms + delta * 86_400_000).toISOString().slice(0, 10)
}

function resolverPeriodo(q: { dataInicio?: string; dataFim?: string; dias?: string }) {
  const hoje = hojeIsoLocal()
  const diasFallback = Math.min(365, Math.max(1, Math.round(Number(q.dias || 30))))
  const dataFim = q.dataFim && /^\d{4}-\d{2}-\d{2}$/.test(q.dataFim) ? q.dataFim : hoje
  const dataInicio =
    q.dataInicio && /^\d{4}-\d{2}-\d{2}$/.test(q.dataInicio)
      ? q.dataInicio
      : somarDiasIso(dataFim, -(diasFallback - 1))
  const dias = Math.max(
    1,
    Math.round((Date.parse(`${dataFim}T00:00:00Z`) - Date.parse(`${dataInicio}T00:00:00Z`)) / 86_400_000) + 1,
  )
  return { dataInicio, dataFim, dias, hoje }
}

function classificarAbc(pctAcumulado: number): 'A' | 'B' | 'C' {
  if (pctAcumulado <= 80.01) return 'A'
  if (pctAcumulado <= 95.01) return 'B'
  return 'C'
}

export function registerRelatoriosBiRoutes(app: FastifyInstance, conn: DbConnection) {
  const { requirePermission } = createAuthMiddleware(app, conn)

  // ═══════════════════════════════════════════════════════════════════════════
  // 1) CURVA ABC DE ESTOQUE (CAPITAL & PESO)
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(
    '/api/relatorios/bi/curva-abc-estoque',
    { preHandler: requirePermission(PERM_BI_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select({
          produto_id: estoqueCaixas.produtoId,
          codigo: produtos.codigo,
          descricao: produtos.descricao,
          especie: produtos.especie,
          conservacao: produtos.conservacao,
          grupo: produtos.grupo,
          peso_kg: estoqueCaixas.pesoKg,
          custo_cx: estoqueCaixas.custoUnitarioKg,
          custo_prod: produtos.custoMedioKg,
          venda_prod: produtos.valorUnitario,
          status: estoqueCaixas.status,
        })
        .from(estoqueCaixas)
        .innerJoin(produtos, eq(produtos.id, estoqueCaixas.produtoId))
        .where(
          and(
            eq(estoqueCaixas.tenantId, ctx.tenantId),
            eq(estoqueCaixas.filialId, ctx.filialId),
            inArray(estoqueCaixas.status, ['DISPONIVEL', 'RESERVADA']),
          ),
        )

      const mapa = new Map<
        string,
        {
          produto_id: string
          codigo: string
          descricao: string
          especie: string
          conservacao: string
          grupo: string
          caixas: number
          peso_kg: number
          valor_custo: number
          valor_venda: number
        }
      >()

      for (const r of rows) {
        const peso = toNum(r.peso_kg, 0)
        const custoU = toNum(r.custo_cx, 0) || toNum(r.custo_prod, 0) || toNum(r.venda_prod, 0) * 0.7
        const vendaU = toNum(r.venda_prod, 0) || custoU * 1.25
        const cur = mapa.get(r.produto_id) || {
          produto_id: r.produto_id,
          codigo: r.codigo || '',
          descricao: r.descricao,
          especie: r.especie || 'OUTROS',
          conservacao: r.conservacao || 'RESFRIADO',
          grupo: r.grupo || '-',
          caixas: 0,
          peso_kg: 0,
          valor_custo: 0,
          valor_venda: 0,
        }
        cur.caixas += 1
        cur.peso_kg += peso
        cur.valor_custo += peso * custoU
        cur.valor_venda += peso * vendaU
        mapa.set(r.produto_id, cur)
      }

      const lista = Array.from(mapa.values()).sort((a, b) => b.valor_custo - a.valor_custo)
      const totalCusto = lista.reduce((s, i) => s + i.valor_custo, 0)
      const totalVenda = lista.reduce((s, i) => s + i.valor_venda, 0)
      const totalKg = lista.reduce((s, i) => s + i.peso_kg, 0)
      const totalCaixas = lista.reduce((s, i) => s + i.caixas, 0)

      let acum = 0
      const itens = lista.map((i) => {
        const share = totalCusto > 0 ? (i.valor_custo / totalCusto) * 100 : 0
        const classe = classificarAbc(acum === 0 ? 0 : acum)
        acum += share
        return {
          ...i,
          peso_kg: Number(i.peso_kg.toFixed(2)),
          valor_custo: Number(i.valor_custo.toFixed(2)),
          valor_venda: Number(i.valor_venda.toFixed(2)),
          custo_medio_kg: i.peso_kg > 0 ? Number((i.valor_custo / i.peso_kg).toFixed(2)) : 0,
          participacao_pct: Number(share.toFixed(2)),
          acumulado_pct: Number(Math.min(100, acum).toFixed(2)),
          classe_abc: classe,
        }
      })

      const resumoClasse = (c: 'A' | 'B' | 'C') => {
        const sub = itens.filter((x) => x.classe_abc === c)
        return {
          skus: sub.length,
          kg: Number(sub.reduce((s, x) => s + x.peso_kg, 0).toFixed(2)),
          valor_custo: Number(sub.reduce((s, x) => s + x.valor_custo, 0).toFixed(2)),
        }
      }

      return {
        success: true,
        resumo: {
          total_skus: itens.length,
          total_caixas: totalCaixas,
          total_kg: Number(totalKg.toFixed(2)),
          valor_custo_total: Number(totalCusto.toFixed(2)),
          valor_venda_potencial: Number(totalVenda.toFixed(2)),
          classe_a: resumoClasse('A'),
          classe_b: resumoClasse('B'),
          classe_c: resumoClasse('C'),
        },
        data: itens,
      }
    },
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // 2) VALUATION / CAPITAL IMOBILIZADO POR CÂMARA, ESPÉCIE, EMPÓRIO E INSUMOS
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(
    '/api/relatorios/bi/valuation-estoque',
    { preHandler: requirePermission(PERM_BI_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const [caixas, empRows, insRows] = await Promise.all([
        conn.db
          .select({
            endereco: estoqueCaixas.endereco,
            peso_kg: estoqueCaixas.pesoKg,
            custo_cx: estoqueCaixas.custoUnitarioKg,
            custo_prod: produtos.custoMedioKg,
            venda_prod: produtos.valorUnitario,
            especie: produtos.especie,
            conservacao: produtos.conservacao,
          })
          .from(estoqueCaixas)
          .innerJoin(produtos, eq(produtos.id, estoqueCaixas.produtoId))
          .where(
            and(
              eq(estoqueCaixas.tenantId, ctx.tenantId),
              eq(estoqueCaixas.filialId, ctx.filialId),
              inArray(estoqueCaixas.status, ['DISPONIVEL', 'RESERVADA', 'BLOQUEADO']),
            ),
          ),
        conn.db
          .select({
            setor_loja: varejoEstoque.setorLoja,
            saldo_qtd: varejoEstoque.saldoQtd,
            preco_venda: varejoEstoque.precoVendaVarejo,
            custo_prod: produtos.custoMedioKg,
            descricao: produtos.descricao,
          })
          .from(varejoEstoque)
          .innerJoin(produtos, eq(produtos.id, varejoEstoque.produtoId))
          .where(and(eq(varejoEstoque.tenantId, ctx.tenantId), eq(varejoEstoque.filialId, ctx.filialId))),
        conn.db
          .select({
            saldo_atual: insumosEstoque.saldoAtual,
            custo_unit: insumosEstoque.custoUnitario,
            endereco_codigo: insumosEstoque.enderecoCodigo,
            descricao: produtos.descricao,
          })
          .from(insumosEstoque)
          .innerJoin(produtos, eq(produtos.id, insumosEstoque.produtoId))
          .where(and(eq(insumosEstoque.tenantId, ctx.tenantId), eq(insumosEstoque.filialId, ctx.filialId))),
      ])

      const porEndereco = new Map<string, { endereco: string; caixas: number; kg: number; valor_custo: number; valor_venda: number }>()
      const porEspecie = new Map<string, { especie: string; caixas: number; kg: number; valor_custo: number; valor_venda: number }>()
      const porConservacao = new Map<string, { conservacao: string; caixas: number; kg: number; valor_custo: number }>()

      let totalWmsCusto = 0
      let totalWmsVenda = 0
      let totalWmsKg = 0

      for (const c of caixas) {
        const kg = toNum(c.peso_kg, 0)
        const custoU = toNum(c.custo_cx, 0) || toNum(c.custo_prod, 0) || toNum(c.venda_prod, 0) * 0.7
        const vendaU = toNum(c.venda_prod, 0) || custoU * 1.25
        const vc = kg * custoU
        const vv = kg * vendaU
        totalWmsCusto += vc
        totalWmsVenda += vv
        totalWmsKg += kg

        const end = (c.endereco || 'SEM_ENDERECO').toUpperCase()
        const eRow = porEndereco.get(end) || { endereco: end, caixas: 0, kg: 0, valor_custo: 0, valor_venda: 0 }
        eRow.caixas += 1
        eRow.kg += kg
        eRow.valor_custo += vc
        eRow.valor_venda += vv
        porEndereco.set(end, eRow)

        const esp = (c.especie || 'OUTROS').toUpperCase()
        const spRow = porEspecie.get(esp) || { especie: esp, caixas: 0, kg: 0, valor_custo: 0, valor_venda: 0 }
        spRow.caixas += 1
        spRow.kg += kg
        spRow.valor_custo += vc
        spRow.valor_venda += vv
        porEspecie.set(esp, spRow)

        const cons = (c.conservacao || 'RESFRIADO').toUpperCase()
        const cRow = porConservacao.get(cons) || { conservacao: cons, caixas: 0, kg: 0, valor_custo: 0 }
        cRow.caixas += 1
        cRow.kg += kg
        cRow.valor_custo += vc
        porConservacao.set(cons, cRow)
      }

      let valorEmporioCusto = 0
      let valorEmporioVenda = 0
      for (const e of empRows) {
        const qtd = Math.max(0, toNum(e.saldo_qtd, 0))
        const pv = toNum(e.preco_venda, 0)
        const cu = toNum(e.custo_prod, 0) || pv * 0.68
        valorEmporioCusto += qtd * cu
        valorEmporioVenda += qtd * pv
      }

      let valorInsumos = 0
      for (const i of insRows) {
        valorInsumos += Math.max(0, toNum(i.saldo_atual, 0)) * toNum(i.custo_unit, 0)
      }

      const capitalTotal = totalWmsCusto + valorEmporioCusto + valorInsumos

      return {
        success: true,
        resumo: {
          capital_total_custo: Number(capitalTotal.toFixed(2)),
          wms_camaras_custo: Number(totalWmsCusto.toFixed(2)),
          wms_camaras_venda: Number(totalWmsVenda.toFixed(2)),
          wms_camaras_kg: Number(totalWmsKg.toFixed(2)),
          emporio_loja_custo: Number(valorEmporioCusto.toFixed(2)),
          emporio_loja_venda: Number(valorEmporioVenda.toFixed(2)),
          insumos_almox_custo: Number(valorInsumos.toFixed(2)),
          margem_potencial_wms_pct:
            totalWmsVenda > 0 ? Number((((totalWmsVenda - totalWmsCusto) / totalWmsVenda) * 100).toFixed(1)) : 0,
        },
        por_endereco: Array.from(porEndereco.values())
          .map((x) => ({
            ...x,
            kg: Number(x.kg.toFixed(2)),
            valor_custo: Number(x.valor_custo.toFixed(2)),
            valor_venda: Number(x.valor_venda.toFixed(2)),
          }))
          .sort((a, b) => b.valor_custo - a.valor_custo),
        por_especie: Array.from(porEspecie.values())
          .map((x) => ({
            ...x,
            kg: Number(x.kg.toFixed(2)),
            valor_custo: Number(x.valor_custo.toFixed(2)),
            valor_venda: Number(x.valor_venda.toFixed(2)),
          }))
          .sort((a, b) => b.valor_custo - a.valor_custo),
        por_conservacao: Array.from(porConservacao.values())
          .map((x) => ({
            ...x,
            kg: Number(x.kg.toFixed(2)),
            valor_custo: Number(x.valor_custo.toFixed(2)),
          }))
          .sort((a, b) => b.valor_custo - a.valor_custo),
      }
    },
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // 3) KARDEX / EXTRATO DE MOVIMENTAÇÕES POR PRODUTO
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(
    '/api/relatorios/bi/kardex',
    { preHandler: requirePermission(PERM_BI_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { produto_id?: string; dataInicio?: string; dataFim?: string }
      const { dataInicio, dataFim } = resolverPeriodo(q)
      const prodId = q.produto_id ? parseUuidOrBadRequest(q.produto_id, 'produto_id') : null

      const conds = [
        eq(movimentacoesLog.tenantId, ctx.tenantId),
        eq(movimentacoesLog.filialId, ctx.filialId),
        sql`DATE(${movimentacoesLog.dataHora} AT TIME ZONE 'America/Sao_Paulo') >= ${dataInicio}::date`,
        sql`DATE(${movimentacoesLog.dataHora} AT TIME ZONE 'America/Sao_Paulo') <= ${dataFim}::date`,
      ]
      if (prodId) conds.push(eq(movimentacoesLog.produtoId, prodId))

      const rows = await conn.db
        .select({
          id: movimentacoesLog.id,
          data_hora: movimentacoesLog.dataHora,
          tipo: movimentacoesLog.tipo,
          produto_id: movimentacoesLog.produtoId,
          produto_codigo: produtos.codigo,
          produto_descricao: produtos.descricao,
          endereco_origem: movimentacoesLog.enderecoOrigem,
          endereco_destino: movimentacoesLog.enderecoDestino,
          lote: movimentacoesLog.lote,
          qtd_caixas: movimentacoesLog.qtdCaixas,
          qtd_kg: movimentacoesLog.qtdKg,
          num_pedido: movimentacoesLog.numPedido,
          operador_nome: movimentacoesLog.operadorNome,
        })
        .from(movimentacoesLog)
        .leftJoin(produtos, eq(produtos.id, movimentacoesLog.produtoId))
        .where(and(...conds))
        .orderBy(desc(movimentacoesLog.dataHora))
        .limit(500)

      let saldoAtualKg = 0
      if (prodId) {
        const [sal] = await conn.db
          .select({ kg: sql<string>`COALESCE(SUM(${estoqueCaixas.pesoKg}), 0)` })
          .from(estoqueCaixas)
          .where(
            and(
              eq(estoqueCaixas.tenantId, ctx.tenantId),
              eq(estoqueCaixas.filialId, ctx.filialId),
              eq(estoqueCaixas.produtoId, prodId),
              inArray(estoqueCaixas.status, ['DISPONIVEL', 'RESERVADA']),
            ),
          )
        saldoAtualKg = toNum(sal?.kg, 0)
      }

      const TIPOS_ENTRADA = new Set(['RECEBIMENTO', 'ENTRADA', 'RETORNO_PRODUCAO', 'DEVOLUCAO', 'RECEBIMENTO_DESMEMBRAMENTO'])
      const TIPOS_SAIDA = new Set(['SAIDA', 'EXPEDICAO', 'BAIXA_PERDA', 'PRODUCAO_SAIDA', 'ALOCADA_PRODUCAO', 'INVENTARIO_PERDA', 'DESMEMBRADA'])

      let entradasKg = 0
      let saidasKg = 0
      const data = rows.map((r) => {
        const kg = toNum(r.qtd_kg, 0)
        const tipoUp = String(r.tipo || '').toUpperCase()
        const direcao = TIPOS_ENTRADA.has(tipoUp) ? 'ENTRADA' : TIPOS_SAIDA.has(tipoUp) ? 'SAIDA' : 'INTERNA'
        if (direcao === 'ENTRADA') entradasKg += kg
        if (direcao === 'SAIDA') saidasKg += kg
        return {
          ...r,
          qtd_caixas: toNum(r.qtd_caixas, 0),
          qtd_kg: Number(kg.toFixed(3)),
          direcao,
        }
      })

      return {
        success: true,
        periodo: { dataInicio, dataFim },
        resumo: {
          total_movimentos: data.length,
          entradas_kg: Number(entradasKg.toFixed(2)),
          saidas_kg: Number(saidasKg.toFixed(2)),
          variacao_liquida_kg: Number((entradasKg - saidasKg).toFixed(2)),
          saldo_atual_kg: Number(saldoAtualKg.toFixed(2)),
        },
        data,
      }
    },
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // 4) GIRO, COBERTURA (DIAS) & ESTOQUE ENCALHADO (DEAD STOCK)
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(
    '/api/relatorios/bi/giro-deadstock',
    { preHandler: requirePermission(PERM_BI_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { dias?: string }
      const { dataInicio, dataFim, dias } = resolverPeriodo({ dias: q.dias || '30' })

      const [caixas, movsSaida] = await Promise.all([
        conn.db
          .select({
            produto_id: estoqueCaixas.produtoId,
            codigo: produtos.codigo,
            descricao: produtos.descricao,
            especie: produtos.especie,
            peso_kg: estoqueCaixas.pesoKg,
            custo_cx: estoqueCaixas.custoUnitarioKg,
            custo_prod: produtos.custoMedioKg,
          })
          .from(estoqueCaixas)
          .innerJoin(produtos, eq(produtos.id, estoqueCaixas.produtoId))
          .where(
            and(
              eq(estoqueCaixas.tenantId, ctx.tenantId),
              eq(estoqueCaixas.filialId, ctx.filialId),
              inArray(estoqueCaixas.status, ['DISPONIVEL', 'RESERVADA']),
            ),
          ),
        conn.db
          .select({
            produto_id: movimentacoesLog.produtoId,
            qtd_kg: movimentacoesLog.qtdKg,
          })
          .from(movimentacoesLog)
          .where(
            and(
              eq(movimentacoesLog.tenantId, ctx.tenantId),
              eq(movimentacoesLog.filialId, ctx.filialId),
              sql`${movimentacoesLog.tipo} IN ('SAIDA', 'EXPEDICAO', 'ALOCADA_PRODUCAO', 'PRODUCAO_SAIDA')`,
              sql`DATE(${movimentacoesLog.dataHora}) >= ${dataInicio}::date`,
              sql`DATE(${movimentacoesLog.dataHora}) <= ${dataFim}::date`,
            ),
          ),
      ])

      const saidaPorProd = new Map<string, number>()
      for (const m of movsSaida) {
        if (!m.produto_id) continue
        saidaPorProd.set(m.produto_id, (saidaPorProd.get(m.produto_id) || 0) + toNum(m.qtd_kg, 0))
      }

      const estPorProd = new Map<
        string,
        { produto_id: string; codigo: string; descricao: string; especie: string; saldo_kg: number; valor_parado: number }
      >()
      for (const c of caixas) {
        const kg = toNum(c.peso_kg, 0)
        const cu = toNum(c.custo_cx, 0) || toNum(c.custo_prod, 0)
        const cur = estPorProd.get(c.produto_id) || {
          produto_id: c.produto_id,
          codigo: c.codigo || '',
          descricao: c.descricao,
          especie: c.especie || 'OUTROS',
          saldo_kg: 0,
          valor_parado: 0,
        }
        cur.saldo_kg += kg
        cur.valor_parado += kg * cu
        estPorProd.set(c.produto_id, cur)
      }

      const itens = Array.from(estPorProd.values()).map((e) => {
        const saidaPeriodoKg = saidaPorProd.get(e.produto_id) || 0
        const consumoDiaKg = saidaPeriodoKg / dias
        const coberturaDias = consumoDiaKg > 0 ? Math.round(e.saldo_kg / consumoDiaKg) : null
        const giroPeriodo = e.saldo_kg > 0 ? Number((saidaPeriodoKg / e.saldo_kg).toFixed(2)) : 0
        const statusGiro =
          saidaPeriodoKg <= 0
            ? 'SEM_GIRO'
            : coberturaDias != null && coberturaDias <= 5
              ? 'RUPTURA_IMINENTE'
              : coberturaDias != null && coberturaDias > 45
                ? 'EXCESSO'
                : 'SAUDAVEL'
        return {
          ...e,
          saldo_kg: Number(e.saldo_kg.toFixed(2)),
          valor_parado: Number(e.valor_parado.toFixed(2)),
          saida_periodo_kg: Number(saidaPeriodoKg.toFixed(2)),
          consumo_dia_kg: Number(consumoDiaKg.toFixed(2)),
          cobertura_dias: coberturaDias,
          giro_periodo: giroPeriodo,
          status_giro: statusGiro,
        }
      })

      itens.sort((a, b) => {
        const ord: Record<string, number> = { SEM_GIRO: 0, RUPTURA_IMINENTE: 1, EXCESSO: 2, SAUDAVEL: 3 }
        return (ord[a.status_giro] ?? 9) - (ord[b.status_giro] ?? 9) || b.valor_parado - a.valor_parado
      })

      const deadStock = itens.filter((i) => i.status_giro === 'SEM_GIRO')
      const ruptura = itens.filter((i) => i.status_giro === 'RUPTURA_IMINENTE')

      return {
        success: true,
        periodo_dias: dias,
        resumo: {
          total_skus_estoque: itens.length,
          dead_stock_qtd: deadStock.length,
          dead_stock_kg: Number(deadStock.reduce((s, i) => s + i.saldo_kg, 0).toFixed(2)),
          dead_stock_valor: Number(deadStock.reduce((s, i) => s + i.valor_parado, 0).toFixed(2)),
          ruptura_iminente_qtd: ruptura.length,
          saudaveis_qtd: itens.filter((i) => i.status_giro === 'SAUDAVEL').length,
        },
        data: itens,
      }
    },
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // 5) MAPA FEFO COMPLETO POR FAIXAS DE VALIDADE
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(
    '/api/relatorios/bi/mapa-fefo',
    { preHandler: requirePermission(PERM_BI_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const hoje = hojeIsoLocal()
      const hojeMs = Date.parse(`${hoje}T00:00:00Z`)

      const caixas = await conn.db
        .select({
          id: estoqueCaixas.id,
          ean_caixa: estoqueCaixas.eanCaixa,
          produto_codigo: produtos.codigo,
          produto_descricao: produtos.descricao,
          endereco: estoqueCaixas.endereco,
          lote: estoqueCaixas.lote,
          validade: estoqueCaixas.validade,
          peso_kg: estoqueCaixas.pesoKg,
          custo_cx: estoqueCaixas.custoUnitarioKg,
          custo_prod: produtos.custoMedioKg,
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
        )
        .orderBy(asc(estoqueCaixas.validade))
        .limit(800)

      const faixasDef = [
        { id: 'VENCIDO', label: 'Vencido (< 0d)', qtd: 0, kg: 0, valor: 0 },
        { id: 'CRITICO_3D', label: '0 a 3 dias', qtd: 0, kg: 0, valor: 0 },
        { id: 'ATENCAO_7D', label: '4 a 7 dias', qtd: 0, kg: 0, valor: 0 },
        { id: 'PRAZO_15D', label: '8 a 15 dias', qtd: 0, kg: 0, valor: 0 },
        { id: 'PRAZO_30D', label: '16 a 30 dias', qtd: 0, kg: 0, valor: 0 },
        { id: 'LONGO_30P', label: '> 30 dias', qtd: 0, kg: 0, valor: 0 },
      ]
      const faixaMap = new Map(faixasDef.map((f) => [f.id, f]))

      const itens = caixas.map((c) => {
        const valIso = String(c.validade).slice(0, 10)
        const diasRest = Math.round((Date.parse(`${valIso}T00:00:00Z`) - hojeMs) / 86_400_000)
        const faixaId =
          diasRest < 0
            ? 'VENCIDO'
            : diasRest <= 3
              ? 'CRITICO_3D'
              : diasRest <= 7
                ? 'ATENCAO_7D'
                : diasRest <= 15
                  ? 'PRAZO_15D'
                  : diasRest <= 30
                    ? 'PRAZO_30D'
                    : 'LONGO_30P'
        const kg = toNum(c.peso_kg, 0)
        const cu = toNum(c.custo_cx, 0) || toNum(c.custo_prod, 0)
        const val = kg * cu
        const f = faixaMap.get(faixaId)!
        f.qtd += 1
        f.kg = Number((f.kg + kg).toFixed(2))
        f.valor = Number((f.valor + val).toFixed(2))
        return {
          id: c.id,
          ean_caixa: c.ean_caixa,
          produto_codigo: c.produto_codigo || '',
          produto_descricao: c.produto_descricao,
          endereco: c.endereco || '-',
          lote: c.lote || '-',
          validade: valIso,
          dias_restantes: diasRest,
          faixa: faixaId,
          peso_kg: Number(kg.toFixed(3)),
          valor_custo: Number(val.toFixed(2)),
        }
      })

      const risco15 = faixasDef.slice(0, 4)
      return {
        success: true,
        resumo: {
          total_caixas: itens.length,
          total_kg: Number(itens.reduce((s, i) => s + i.peso_kg, 0).toFixed(2)),
          capital_risco_15d: Number(risco15.reduce((s, f) => s + f.valor, 0).toFixed(2)),
          caixas_vencidas: faixaMap.get('VENCIDO')!.qtd,
        },
        faixas: faixasDef,
        data: itens.slice(0, 300),
      }
    },
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // 6) ACURACIDADE DE INVENTÁRIO (IRA) & DIVERGÊNCIAS
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(
    '/api/relatorios/bi/acuracidade-inventario',
    { preHandler: requirePermission(PERM_BI_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { dataInicio?: string; dataFim?: string }
      const { dataInicio, dataFim } = resolverPeriodo(q)

      const [invs, ajustes, invLoja] = await Promise.all([
        conn.db
          .select()
          .from(inventarios)
          .where(
            and(
              eq(inventarios.tenantId, ctx.tenantId),
              sql`DATE(${inventarios.dataCriacao}) >= ${dataInicio}::date`,
              sql`DATE(${inventarios.dataCriacao}) <= ${dataFim}::date`,
            ),
          )
          .orderBy(desc(inventarios.dataCriacao))
          .limit(100),
        conn.db
          .select({
            id: inventarioAjustesLog.id,
            endereco: inventarioAjustesLog.endereco,
            tipo_ajuste: inventarioAjustesLog.tipoAjuste,
            qtd_kg: inventarioAjustesLog.qtdAjustadaKg,
            custo_unit: inventarioAjustesLog.custoUnitarioData,
            aprovou: inventarioAjustesLog.usuarioAprovouNome,
            data_ajuste: inventarioAjustesLog.dataAjuste,
            produto_descricao: produtos.descricao,
            produto_codigo: produtos.codigo,
          })
          .from(inventarioAjustesLog)
          .leftJoin(produtos, eq(produtos.id, inventarioAjustesLog.produtoId))
          .where(
            and(
              eq(inventarioAjustesLog.tenantId, ctx.tenantId),
              sql`DATE(${inventarioAjustesLog.dataAjuste}) >= ${dataInicio}::date`,
              sql`DATE(${inventarioAjustesLog.dataAjuste}) <= ${dataFim}::date`,
            ),
          )
          .orderBy(desc(inventarioAjustesLog.dataAjuste))
          .limit(200),
        conn.db
          .select()
          .from(varejoInventarios)
          .where(
            and(
              eq(varejoInventarios.tenantId, ctx.tenantId),
              sql`DATE(${varejoInventarios.createdAt}) >= ${dataInicio}::date`,
              sql`DATE(${varejoInventarios.createdAt}) <= ${dataFim}::date`,
            ),
          )
          .orderBy(desc(varejoInventarios.createdAt))
          .limit(100),
      ])

      const invIds = invs.map((i) => i.id)
      const invItensRows =
        invIds.length > 0
          ? await conn.db
              .select({
                inventarioId: inventarioItens.inventarioId,
                sisKg: inventarioItens.qtdSistemaKg,
                contKg: inventarioItens.qtdContadaKg,
              })
              .from(inventarioItens)
              .where(inArray(inventarioItens.inventarioId, invIds))
          : []

      let totalItensContados = 0
      let totalItensExatos = 0
      for (const it of invItensRows) {
        if (it.contKg == null) continue
        totalItensContados += 1
        if (Math.abs(toNum(it.sisKg, 0) - toNum(it.contKg, 0)) <= 0.1) totalItensExatos += 1
      }
      for (const il of invLoja) {
        totalItensContados += Number(il.totalItens || 0)
        totalItensExatos += Math.max(0, Number(il.totalItens || 0) - Number(il.totalDivergencias || 0))
      }

      const iraPct =
        totalItensContados > 0 ? Number(((totalItensExatos / totalItensContados) * 100).toFixed(1)) : 100

      let impactoFaltas = 0
      let impactoSobras = 0
      const ajustesFmt = ajustes.map((a) => {
        const kg = toNum(a.qtd_kg, 0)
        const cu = toNum(a.custo_unit, 0)
        const val = Number((kg * cu).toFixed(2))
        if (val < 0 || String(a.tipo_ajuste || '').toUpperCase().includes('PERDA')) impactoFaltas += Math.abs(val)
        else impactoSobras += Math.abs(val)
        return {
          id: a.id,
          data_ajuste: a.data_ajuste,
          endereco: a.endereco || '-',
          produto_codigo: a.produto_codigo || '',
          produto_descricao: a.produto_descricao || '-',
          tipo_ajuste: a.tipo_ajuste || 'AJUSTE',
          qtd_kg: Number(kg.toFixed(3)),
          valor_impacto: val,
          aprovou: a.aprovou || '-',
        }
      })

      return {
        success: true,
        periodo: { dataInicio, dataFim },
        resumo: {
          ira_pct: iraPct,
          inventarios_wms_qtd: invs.length,
          inventarios_loja_qtd: invLoja.length,
          total_ajustes: ajustesFmt.length,
          impacto_faltas_valor: Number(impactoFaltas.toFixed(2)),
          impacto_sobras_valor: Number(impactoSobras.toFixed(2)),
        },
        ajustes: ajustesFmt,
        inventarios_loja: invLoja.map((l) => ({
          id: l.id,
          codigo: l.codigo,
          titulo: l.titulo,
          tipo: l.tipoInventario,
          status: l.status,
          total_itens: l.totalItens,
          total_divergencias: l.totalDivergencias,
          operador_nome: l.operadorNome,
          created_at: l.createdAt,
        })),
      }
    },
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // 7) CURVA ABC DE VENDAS POR PRODUTO (ATACADO + PDV VAREJO)
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(
    '/api/relatorios/bi/curva-abc-vendas',
    { preHandler: requirePermission(PERM_BI_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { dataInicio?: string; dataFim?: string }
      const { dataInicio, dataFim } = resolverPeriodo(q)

      const [pedItens, vendasPdv, prodRows] = await Promise.all([
        conn.db
          .select({
            produto_id: pedidosItens.produtoId,
            codigo: produtos.codigo,
            descricao: produtos.descricao,
            qtd_kg: pedidosItens.qtdKgSolicitada,
            preco_unit: pedidosItens.precoUnitario,
            custo_prod: produtos.custoMedioKg,
            valor_prod: produtos.valorUnitario,
          })
          .from(pedidosItens)
          .innerJoin(pedidos, eq(pedidos.id, pedidosItens.pedidoId))
          .innerJoin(produtos, eq(produtos.id, pedidosItens.produtoId))
          .where(
            and(
              eq(pedidos.tenantId, ctx.tenantId),
              sql`${pedidos.status} NOT IN ('CANCELADO', 'RASCUNHO')`,
              sql`DATE(${pedidos.createdAt}) >= ${dataInicio}::date`,
              sql`DATE(${pedidos.createdAt}) <= ${dataFim}::date`,
            ),
          ),
        conn.db
          .select({
            itensJson: pdvVendas.itensJson,
          })
          .from(pdvVendas)
          .where(
            and(
              eq(pdvVendas.tenantId, ctx.tenantId),
              eq(pdvVendas.status, 'CONCLUIDA'),
              sql`DATE(${pdvVendas.createdAt}) >= ${dataInicio}::date`,
              sql`DATE(${pdvVendas.createdAt}) <= ${dataFim}::date`,
            ),
          ),
        conn.db
          .select({ id: produtos.id, codigo: produtos.codigo, descricao: produtos.descricao, custoMedioKg: produtos.custoMedioKg })
          .from(produtos)
          .where(eq(produtos.tenantId, ctx.tenantId)),
      ])

      const prodMap = new Map(prodRows.map((p) => [p.id, p]))
      const agg = new Map<
        string,
        {
          produto_id: string
          codigo: string
          descricao: string
          qtd_atacado: number
          receita_atacado: number
          qtd_pdv: number
          receita_pdv: number
          custo_total: number
        }
      >()

      for (const it of pedItens) {
        const qtd = toNum(it.qtd_kg, 0)
        const pu = toNum(it.preco_unit, 0) || toNum(it.valor_prod, 0)
        const cu = toNum(it.custo_prod, 0)
        const cur = agg.get(it.produto_id) || {
          produto_id: it.produto_id,
          codigo: it.codigo || '',
          descricao: it.descricao,
          qtd_atacado: 0,
          receita_atacado: 0,
          qtd_pdv: 0,
          receita_pdv: 0,
          custo_total: 0,
        }
        cur.qtd_atacado += qtd
        cur.receita_atacado += qtd * pu
        cur.custo_total += qtd * cu
        agg.set(it.produto_id, cur)
      }

      for (const v of vendasPdv) {
        const arr = Array.isArray(v.itensJson) ? v.itensJson : []
        for (const it of arr) {
          const pid = String(it.produto_id || it.id || it.descricao || 'PDV')
          const prod = prodMap.get(pid)
          const qtd = toNum(it.qtd ?? it.quantidade ?? it.peso_kg, 0)
          const tot = toNum(it.subtotal ?? it.valor_total, qtd * toNum(it.preco_unitario, 0))
          const cu = prod ? toNum(prod.custoMedioKg, 0) : 0
          const cur = agg.get(pid) || {
            produto_id: pid,
            codigo: String(it.codigo || prod?.codigo || ''),
            descricao: String(it.descricao || prod?.descricao || 'Item PDV'),
            qtd_atacado: 0,
            receita_atacado: 0,
            qtd_pdv: 0,
            receita_pdv: 0,
            custo_total: 0,
          }
          cur.qtd_pdv += qtd
          cur.receita_pdv += tot
          cur.custo_total += qtd * cu
          agg.set(pid, cur)
        }
      }

      const lista = Array.from(agg.values())
        .map((x) => {
          const receita = x.receita_atacado + x.receita_pdv
          const margemR = receita - x.custo_total
          const margemPct = receita > 0 ? (margemR / receita) * 100 : 0
          return {
            ...x,
            qtd_total: Number((x.qtd_atacado + x.qtd_pdv).toFixed(2)),
            receita_atacado: Number(x.receita_atacado.toFixed(2)),
            receita_pdv: Number(x.receita_pdv.toFixed(2)),
            receita_total: Number(receita.toFixed(2)),
            custo_total: Number(x.custo_total.toFixed(2)),
            margem_valor: Number(margemR.toFixed(2)),
            margem_pct: Number(margemPct.toFixed(1)),
          }
        })
        .sort((a, b) => b.receita_total - a.receita_total)

      const totalRec = lista.reduce((s, x) => s + x.receita_total, 0)
      const totalCusto = lista.reduce((s, x) => s + x.custo_total, 0)
      let acum = 0
      const data = lista.map((x) => {
        const share = totalRec > 0 ? (x.receita_total / totalRec) * 100 : 0
        const classe = classificarAbc(acum === 0 ? 0 : acum)
        acum += share
        return {
          ...x,
          participacao_pct: Number(share.toFixed(2)),
          acumulado_pct: Number(Math.min(100, acum).toFixed(2)),
          classe_abc: classe,
        }
      })

      return {
        success: true,
        periodo: { dataInicio, dataFim },
        resumo: {
          skus_vendidos: data.length,
          receita_total: Number(totalRec.toFixed(2)),
          receita_atacado: Number(data.reduce((s, x) => s + x.receita_atacado, 0).toFixed(2)),
          receita_pdv: Number(data.reduce((s, x) => s + x.receita_pdv, 0).toFixed(2)),
          margem_media_pct: totalRec > 0 ? Number((((totalRec - totalCusto) / totalRec) * 100).toFixed(1)) : 0,
        },
        data: data.slice(0, 200),
      }
    },
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // 8) RENTABILIDADE & MARGEM POR CLIENTE, VENDEDOR E CANAL
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(
    '/api/relatorios/bi/rentabilidade',
    { preHandler: requirePermission(PERM_BI_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { dataInicio?: string; dataFim?: string }
      const { dataInicio, dataFim } = resolverPeriodo(q)

      const [peds, vends, pdvRows] = await Promise.all([
        conn.db
          .select({
            id: pedidos.id,
            cliente_id: pedidos.clienteId,
            cliente: pedidos.cliente,
            vendedor_id: pedidos.vendedorId,
            valor_total: pedidos.valorTotal,
            custo_estimado: pedidos.custoTotalEstimado,
          })
          .from(pedidos)
          .where(
            and(
              eq(pedidos.tenantId, ctx.tenantId),
              sql`${pedidos.status} NOT IN ('CANCELADO', 'RASCUNHO')`,
              sql`DATE(${pedidos.createdAt}) >= ${dataInicio}::date`,
              sql`DATE(${pedidos.createdAt}) <= ${dataFim}::date`,
            ),
          ),
        conn.db
          .select({ id: vendedores.id, nome: vendedores.nome, sigla: vendedores.sigla })
          .from(vendedores)
          .where(eq(vendedores.tenantId, ctx.tenantId)),
        conn.db
          .select({ valor_total: pdvVendas.valorTotal, desconto_valor: pdvVendas.descontoValor })
          .from(pdvVendas)
          .where(
            and(
              eq(pdvVendas.tenantId, ctx.tenantId),
              eq(pdvVendas.status, 'CONCLUIDA'),
              sql`DATE(${pdvVendas.createdAt}) >= ${dataInicio}::date`,
              sql`DATE(${pdvVendas.createdAt}) <= ${dataFim}::date`,
            ),
          ),
      ])

      const vendMap = new Map(vends.map((v) => [v.id, v.nome]))
      const porCliente = new Map<string, { cliente: string; pedidos: number; receita: number; custo: number; descontos: number }>()
      const porVendedor = new Map<string, { vendedor: string; pedidos: number; receita: number; custo: number }>()

      let recAtacado = 0
      let custoAtacado = 0
      for (const p of peds) {
        const rec = toNum(p.valor_total, 0)
        const custo = toNum(p.custo_estimado, 0) || rec * 0.78
        recAtacado += rec
        custoAtacado += custo

        const cliKey = (p.cliente || 'Cliente Diverso').trim()
        const cr = porCliente.get(cliKey) || { cliente: cliKey, pedidos: 0, receita: 0, custo: 0, descontos: 0 }
        cr.pedidos += 1
        cr.receita += rec
        cr.custo += custo
        porCliente.set(cliKey, cr)

        const vNome = (p.vendedor_id && vendMap.get(p.vendedor_id)) || 'Venda Direta / Sem Vendedor'
        const vr = porVendedor.get(vNome) || { vendedor: vNome, pedidos: 0, receita: 0, custo: 0 }
        vr.pedidos += 1
        vr.receita += rec
        vr.custo += custo
        porVendedor.set(vNome, vr)
      }

      const recPdv = pdvRows.reduce((s, r) => s + toNum(r.valor_total, 0), 0)
      const descPdv = pdvRows.reduce((s, r) => s + toNum(r.desconto_valor, 0), 0)

      const formatList = <T extends { receita: number; custo: number; pedidos: number }>(arr: T[]) =>
        arr
          .map((x) => {
            const lucro = x.receita - x.custo
            return {
              ...x,
              receita: Number(x.receita.toFixed(2)),
              custo: Number(x.custo.toFixed(2)),
              margem_valor: Number(lucro.toFixed(2)),
              margem_pct: x.receita > 0 ? Number(((lucro / x.receita) * 100).toFixed(1)) : 0,
              ticket_medio: x.pedidos > 0 ? Number((x.receita / x.pedidos).toFixed(2)) : 0,
            }
          })
          .sort((a, b) => b.receita - a.receita)

      return {
        success: true,
        periodo: { dataInicio, dataFim },
        resumo: {
          receita_total: Number((recAtacado + recPdv).toFixed(2)),
          receita_atacado: Number(recAtacado.toFixed(2)),
          receita_pdv: Number(recPdv.toFixed(2)),
          descontos_pdv: Number(descPdv.toFixed(2)),
          margem_atacado_valor: Number((recAtacado - custoAtacado).toFixed(2)),
          margem_atacado_pct:
            recAtacado > 0 ? Number((((recAtacado - custoAtacado) / recAtacado) * 100).toFixed(1)) : 0,
          qtd_pedidos_atacado: peds.length,
          qtd_cupons_pdv: pdvRows.length,
        },
        por_cliente: formatList(Array.from(porCliente.values())).slice(0, 100),
        por_vendedor: formatList(Array.from(porVendedor.values())),
      }
    },
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // 9) FECHAMENTO DE CAIXAS & MEIOS DE PAGAMENTO (PDV)
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(
    '/api/relatorios/bi/fechamento-pdv',
    { preHandler: requirePermission(PERM_BI_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { dataInicio?: string; dataFim?: string }
      const { dataInicio, dataFim } = resolverPeriodo(q)

      const [caixas, vendas] = await Promise.all([
        conn.db
          .select()
          .from(pdvCaixas)
          .where(
            and(
              eq(pdvCaixas.tenantId, ctx.tenantId),
              sql`DATE(${pdvCaixas.abertoEm}) >= ${dataInicio}::date`,
              sql`DATE(${pdvCaixas.abertoEm}) <= ${dataFim}::date`,
            ),
          )
          .orderBy(desc(pdvCaixas.abertoEm))
          .limit(200),
        conn.db
          .select({
            status: pdvVendas.status,
            valor_total: pdvVendas.valorTotal,
            desconto_valor: pdvVendas.descontoValor,
          })
          .from(pdvVendas)
          .where(
            and(
              eq(pdvVendas.tenantId, ctx.tenantId),
              sql`DATE(${pdvVendas.createdAt}) >= ${dataInicio}::date`,
              sql`DATE(${pdvVendas.createdAt}) <= ${dataFim}::date`,
            ),
          ),
      ])

      const totDin = caixas.reduce((s, c) => s + toNum(c.totalDinheiro, 0), 0)
      const totPix = caixas.reduce((s, c) => s + toNum(c.totalPix, 0), 0)
      const totDeb = caixas.reduce((s, c) => s + toNum(c.totalDebito, 0), 0)
      const totCred = caixas.reduce((s, c) => s + toNum(c.totalCredito, 0), 0)
      const totCrediario = caixas.reduce((s, c) => s + toNum(c.totalCrediario, 0), 0)
      const totQuebra = caixas.reduce((s, c) => s + toNum(c.diferencaQuebra, 0), 0)
      const totSangrias = caixas.reduce((s, c) => s + toNum(c.totalSangrias, 0), 0)

      const concluidas = vendas.filter((v) => v.status === 'CONCLUIDA')
      const canceladas = vendas.filter((v) => v.status === 'CANCELADA')
      const totalVendas = concluidas.reduce((s, v) => s + toNum(v.valor_total, 0), 0)
      const totalDesc = concluidas.reduce((s, v) => s + toNum(v.desconto_valor, 0), 0)

      return {
        success: true,
        periodo: { dataInicio, dataFim },
        resumo: {
          total_caixas: caixas.length,
          total_cupons_concluidos: concluidas.length,
          total_cupons_cancelados: canceladas.length,
          faturamento_pdv: Number(totalVendas.toFixed(2)),
          ticket_medio: concluidas.length > 0 ? Number((totalVendas / concluidas.length).toFixed(2)) : 0,
          descontos_concedidos: Number(totalDesc.toFixed(2)),
          total_sangrias: Number(totSangrias.toFixed(2)),
          saldo_quebras_sobras: Number(totQuebra.toFixed(2)),
        },
        por_forma: [
          { forma: 'PIX', valor: Number(totPix.toFixed(2)) },
          { forma: 'Dinheiro', valor: Number(totDin.toFixed(2)) },
          { forma: 'Cartão Débito', valor: Number(totDeb.toFixed(2)) },
          { forma: 'Cartão Crédito', valor: Number(totCred.toFixed(2)) },
          { forma: 'Crediário / Fiado', valor: Number(totCrediario.toFixed(2)) },
        ].sort((a, b) => b.valor - a.valor),
        caixas: caixas.map((c) => ({
          id: c.id,
          codigo: c.codigo,
          operador_nome: c.operadorNome,
          status: c.status,
          aberto_em: c.abertoEm,
          fechado_em: c.fechadoEm,
          total_vendas: toNum(c.totalVendas, 0),
          total_dinheiro: toNum(c.totalDinheiro, 0),
          total_pix: toNum(c.totalPix, 0),
          total_debito: toNum(c.totalDebito, 0),
          total_credito: toNum(c.totalCredito, 0),
          total_crediario: toNum(c.totalCrediario, 0),
          diferenca_quebra: c.diferencaQuebra != null ? toNum(c.diferencaQuebra, 0) : 0,
        })),
      }
    },
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // 10) EXTRATO DE COMISSÕES & METAS DE VENDEDORES
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(
    '/api/relatorios/bi/comissoes-vendedores',
    { preHandler: requirePermission(PERM_BI_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { dataInicio?: string; dataFim?: string }
      const { dataInicio, dataFim } = resolverPeriodo(q)

      const [vends, peds] = await Promise.all([
        conn.db
          .select()
          .from(vendedores)
          .where(and(eq(vendedores.tenantId, ctx.tenantId), eq(vendedores.ativo, 1)))
          .orderBy(asc(vendedores.nome)),
        conn.db
          .select({
            vendedor_id: pedidos.vendedorId,
            valor_total: pedidos.valorTotal,
            custo_estimado: pedidos.custoTotalEstimado,
          })
          .from(pedidos)
          .where(
            and(
              eq(pedidos.tenantId, ctx.tenantId),
              sql`${pedidos.status} NOT IN ('CANCELADO', 'RASCUNHO')`,
              sql`DATE(${pedidos.createdAt}) >= ${dataInicio}::date`,
              sql`DATE(${pedidos.createdAt}) <= ${dataFim}::date`,
            ),
          ),
      ])

      const rows = vends.map((v) => {
        const vp = peds.filter((p) => p.vendedor_id === v.id)
        const faturado = vp.reduce((s, p) => s + toNum(p.valor_total, 0), 0)
        const custo = vp.reduce((s, p) => s + (toNum(p.custo_estimado, 0) || toNum(p.valor_total, 0) * 0.78), 0)
        const margemR = Math.max(0, faturado - custo)
        const pctCom = toNum(v.pctComissao, 0)
        const baseComissao = v.tipoComissao === 'PCT_MARGEM' ? margemR : faturado
        const comissaoValor = (baseComissao * pctCom) / 100
        const metaValor = toNum(v.metaMensalValor, 0)
        const atingMetaPct = metaValor > 0 ? Number(((faturado / metaValor) * 100).toFixed(1)) : null
        return {
          id: v.id,
          codigo: v.codigo || '',
          sigla: v.sigla || '',
          nome: v.nome,
          tipo_comissao: v.tipoComissao,
          pct_comissao: pctCom,
          pedidos_qtd: vp.length,
          faturado: Number(faturado.toFixed(2)),
          margem_valor: Number(margemR.toFixed(2)),
          margem_pct: faturado > 0 ? Number(((margemR / faturado) * 100).toFixed(1)) : 0,
          meta_valor: metaValor,
          atingimento_meta_pct: atingMetaPct,
          comissao_valor: Number(comissaoValor.toFixed(2)),
        }
      })

      rows.sort((a, b) => b.faturado - a.faturado)

      return {
        success: true,
        periodo: { dataInicio, dataFim },
        resumo: {
          vendedores_ativos: rows.length,
          faturamento_equipe: Number(rows.reduce((s, r) => s + r.faturado, 0).toFixed(2)),
          comissao_total: Number(rows.reduce((s, r) => s + r.comissao_valor, 0).toFixed(2)),
          meta_total: Number(rows.reduce((s, r) => s + r.meta_valor, 0).toFixed(2)),
        },
        data: rows,
      }
    },
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // 11) QUEBRA, RENDIMENTO & RECEITA DO AÇOUGUE
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(
    '/api/relatorios/bi/rendimento-acougue',
    { preHandler: requirePermission(PERM_BI_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { dataInicio?: string; dataFim?: string }
      const { dataInicio, dataFim } = resolverPeriodo(q)

      const [mps, etiquetas] = await Promise.all([
        conn.db
          .select({
            id: estoqueCaixas.id,
            ean_caixa: estoqueCaixas.eanCaixa,
            produto_descricao: produtos.descricao,
            especie: produtos.especie,
            peso_kg: estoqueCaixas.pesoKg,
            quebra_kg: estoqueCaixas.quebraAcougueKg,
            peso_restante_kg: estoqueCaixas.pesoRestanteKg,
            status: estoqueCaixas.status,
            updated_at: estoqueCaixas.updatedAt,
          })
          .from(estoqueCaixas)
          .innerJoin(produtos, eq(produtos.id, estoqueCaixas.produtoId))
          .where(
            and(
              eq(estoqueCaixas.tenantId, ctx.tenantId),
              inArray(estoqueCaixas.status, ['ABERTA_ACOUGUE', 'CONSUMIDA_ACOUGUE']),
              sql`DATE(${estoqueCaixas.updatedAt}) >= ${dataInicio}::date`,
              sql`DATE(${estoqueCaixas.updatedAt}) <= ${dataFim}::date`,
            ),
          )
          .orderBy(desc(estoqueCaixas.updatedAt))
          .limit(200),
        conn.db
          .select({
            especie: etiquetasAcougue.especie,
            produto_descricao: etiquetasAcougue.produtoDescricao,
            peso_kg: etiquetasAcougue.pesoLiquidoKg,
            valor_total: etiquetasAcougue.valorTotal,
            status: etiquetasAcougue.status,
          })
          .from(etiquetasAcougue)
          .where(
            and(
              eq(etiquetasAcougue.tenantId, ctx.tenantId),
              sql`DATE(${etiquetasAcougue.createdAt}) >= ${dataInicio}::date`,
              sql`DATE(${etiquetasAcougue.createdAt}) <= ${dataFim}::date`,
            ),
          )
          .limit(1000),
      ])

      const porEspecie = new Map<string, { especie: string; etiquetas: number; kg_pesado: number; valor_pesado: number; valor_vendido: number }>()
      let kgPesado = 0
      let valPesado = 0
      let valVendido = 0
      let qtdVendidas = 0
      let qtdDescarte = 0

      for (const e of etiquetas) {
        if (e.status === 'CANCELADA') continue
        const kg = toNum(e.peso_kg, 0)
        const v = toNum(e.valor_total, 0)
        kgPesado += kg
        valPesado += v
        if (e.status === 'VENDIDA') {
          valVendido += v
          qtdVendidas += 1
        }
        if (e.status === 'PERDA_DESCARTE' || e.status === 'PERDA_INVENTARIO') qtdDescarte += 1

        const esp = (e.especie || 'OUTROS').toUpperCase()
        const cur = porEspecie.get(esp) || { especie: esp, etiquetas: 0, kg_pesado: 0, valor_pesado: 0, valor_vendido: 0 }
        cur.etiquetas += 1
        cur.kg_pesado += kg
        cur.valor_pesado += v
        if (e.status === 'VENDIDA') cur.valor_vendido += v
        porEspecie.set(esp, cur)
      }

      const mpsEncerradas = mps.filter((m) => m.status === 'CONSUMIDA_ACOUGUE')
      const mpPesoIni = mpsEncerradas.reduce((s, m) => s + toNum(m.peso_kg, 0), 0)
      const mpQuebra = mpsEncerradas.reduce((s, m) => s + toNum(m.quebra_kg, 0), 0)
      const rendMedioPct = mpPesoIni > 0 ? Number((((mpPesoIni - mpQuebra) / mpPesoIni) * 100).toFixed(1)) : 0

      return {
        success: true,
        periodo: { dataInicio, dataFim },
        resumo: {
          mps_encerradas: mpsEncerradas.length,
          mps_abertas: mps.filter((m) => m.status === 'ABERTA_ACOUGUE').length,
          quebra_total_kg: Number(mpQuebra.toFixed(2)),
          rendimento_medio_pct: rendMedioPct,
          etiquetas_pesadas: etiquetas.filter((e) => e.status !== 'CANCELADA').length,
          etiquetas_vendidas: qtdVendidas,
          etiquetas_descarte: qtdDescarte,
          kg_pesado: Number(kgPesado.toFixed(2)),
          valor_etiquetado: Number(valPesado.toFixed(2)),
          valor_vendido: Number(valVendido.toFixed(2)),
          preco_medio_kg: kgPesado > 0 ? Number((valPesado / kgPesado).toFixed(2)) : 0,
        },
        por_especie: Array.from(porEspecie.values())
          .map((x) => ({
            ...x,
            kg_pesado: Number(x.kg_pesado.toFixed(2)),
            valor_pesado: Number(x.valor_pesado.toFixed(2)),
            valor_vendido: Number(x.valor_vendido.toFixed(2)),
          }))
          .sort((a, b) => b.valor_pesado - a.valor_pesado),
        mps: mps.map((m) => {
          const pIni = toNum(m.peso_kg, 0)
          const qKg = toNum(m.quebra_kg, 0)
          return {
            id: m.id,
            ean_caixa: m.ean_caixa,
            produto_descricao: m.produto_descricao,
            especie: m.especie || 'OUTROS',
            status: m.status,
            peso_inicial_kg: Number(pIni.toFixed(2)),
            quebra_kg: Number(qKg.toFixed(2)),
            rendimento_pct: pIni > 0 && m.status === 'CONSUMIDA_ACOUGUE' ? Number((((pIni - qKg) / pIni) * 100).toFixed(1)) : null,
            updated_at: m.updated_at,
          }
        }),
      }
    },
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // 12) HISTÓRICO DE COMPRAS & INFLAÇÃO DE PREÇO POR CORTE / FORNECEDOR
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(
    '/api/relatorios/bi/compras-inflacao',
    { preHandler: requirePermission(PERM_BI_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { dataInicio?: string; dataFim?: string }
      const { dataInicio, dataFim } = resolverPeriodo(q)

      const rows = await conn.db
        .select({
          pc_codigo: pedidosCompra.codigo,
          pc_data: pedidosCompra.createdAt,
          fornecedor_id: pedidosCompra.fornecedorId,
          fornecedor_nome: fornecedores.nomeFantasia,
          fornecedor_razao: fornecedores.razaoSocial,
          produto_id: pedidosCompraItens.produtoId,
          produto_codigo: produtos.codigo,
          produto_descricao: produtos.descricao,
          qtd_kg: pedidosCompraItens.qtdKgSolicitada,
          preco_kg: pedidosCompraItens.precoUnitarioKg,
        })
        .from(pedidosCompraItens)
        .innerJoin(pedidosCompra, eq(pedidosCompra.id, pedidosCompraItens.pedidoCompraId))
        .innerJoin(produtos, eq(produtos.id, pedidosCompraItens.produtoId))
        .leftJoin(fornecedores, eq(fornecedores.id, pedidosCompra.fornecedorId))
        .where(
          and(
            eq(pedidosCompra.tenantId, ctx.tenantId),
            sql`${pedidosCompra.status} != 'CANCELADO'`,
            sql`DATE(${pedidosCompra.createdAt}) >= ${dataInicio}::date`,
            sql`DATE(${pedidosCompra.createdAt}) <= ${dataFim}::date`,
          ),
        )
        .orderBy(asc(pedidosCompra.createdAt))
        .limit(1000)

      const porProd = new Map<
        string,
        {
          produto_id: string
          codigo: string
          descricao: string
          compras_qtd: number
          kg_total: number
          valor_total: number
          preco_min: number
          preco_max: number
          primeiro_preco: number
          ultimo_preco: number
        }
      >()
      const porForn = new Map<string, { fornecedor: string; kg_total: number; valor_total: number; itens: number }>()

      let totalGasto = 0
      let totalKg = 0

      for (const r of rows) {
        const kg = toNum(r.qtd_kg, 0)
        const pr = toNum(r.preco_kg, 0)
        const val = kg * pr
        totalGasto += val
        totalKg += kg

        const fNome = r.fornecedor_nome || r.fornecedor_razao || 'Fornecedor Diverso'
        const fr = porForn.get(fNome) || { fornecedor: fNome, kg_total: 0, valor_total: 0, itens: 0 }
        fr.kg_total += kg
        fr.valor_total += val
        fr.itens += 1
        porForn.set(fNome, fr)

        const cur = porProd.get(r.produto_id)
        if (!cur) {
          porProd.set(r.produto_id, {
            produto_id: r.produto_id,
            codigo: r.produto_codigo || '',
            descricao: r.produto_descricao,
            compras_qtd: 1,
            kg_total: kg,
            valor_total: val,
            preco_min: pr,
            preco_max: pr,
            primeiro_preco: pr,
            ultimo_preco: pr,
          })
        } else {
          cur.compras_qtd += 1
          cur.kg_total += kg
          cur.valor_total += val
          if (pr > 0 && (cur.preco_min === 0 || pr < cur.preco_min)) cur.preco_min = pr
          if (pr > cur.preco_max) cur.preco_max = pr
          if (pr > 0) cur.ultimo_preco = pr
        }
      }

      const produtosInflacao = Array.from(porProd.values())
        .map((p) => {
          const precoMedio = p.kg_total > 0 ? p.valor_total / p.kg_total : p.ultimo_preco
          const variacaoPct =
            p.primeiro_preco > 0
              ? Number((((p.ultimo_preco - p.primeiro_preco) / p.primeiro_preco) * 100).toFixed(1))
              : 0
          return {
            ...p,
            kg_total: Number(p.kg_total.toFixed(2)),
            valor_total: Number(p.valor_total.toFixed(2)),
            preco_min: Number(p.preco_min.toFixed(2)),
            preco_medio: Number(precoMedio.toFixed(2)),
            preco_max: Number(p.preco_max.toFixed(2)),
            primeiro_preco: Number(p.primeiro_preco.toFixed(2)),
            ultimo_preco: Number(p.ultimo_preco.toFixed(2)),
            variacao_pct: variacaoPct,
          }
        })
        .sort((a, b) => b.valor_total - a.valor_total)

      return {
        success: true,
        periodo: { dataInicio, dataFim },
        resumo: {
          valor_comprado_total: Number(totalGasto.toFixed(2)),
          kg_comprado_total: Number(totalKg.toFixed(2)),
          custo_medio_geral_kg: totalKg > 0 ? Number((totalGasto / totalKg).toFixed(2)) : 0,
          skus_comprados: produtosInflacao.length,
          fornecedores_ativos: porForn.size,
        },
        por_fornecedor: Array.from(porForn.values())
          .map((x) => ({
            ...x,
            kg_total: Number(x.kg_total.toFixed(2)),
            valor_total: Number(x.valor_total.toFixed(2)),
            custo_medio_kg: x.kg_total > 0 ? Number((x.valor_total / x.kg_total).toFixed(2)) : 0,
          }))
          .sort((a, b) => b.valor_total - a.valor_total),
        data: produtosInflacao,
      }
    },
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // 13) PERFORMANCE LOGÍSTICA (OTIF), EMBARQUES & DEVOLUÇÕES
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(
    '/api/relatorios/bi/logistica-otif',
    { preHandler: requirePermission(PERM_BI_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { dataInicio?: string; dataFim?: string }
      const { dataInicio, dataFim } = resolverPeriodo(q)

      const [embs, tracks, devs] = await Promise.all([
        conn.db
          .select()
          .from(embarques)
          .where(
            and(
              eq(embarques.tenantId, ctx.tenantId),
              sql`${embarques.dataEmbarque} >= ${dataInicio}::date`,
              sql`${embarques.dataEmbarque} <= ${dataFim}::date`,
            ),
          )
          .orderBy(desc(embarques.dataEmbarque))
          .limit(200),
        conn.db
          .select({
            id: entregasTracking.id,
            embarque_id: entregasTracking.embarqueId,
            status_entrega: entregasTracking.statusEntrega,
            temperatura_entrega: entregasTracking.temperaturaEntrega,
            motivo_recusa: entregasTracking.motivoRecusa,
            motorista_nome: embarques.motoristaNome,
            embarque_codigo: embarques.codigo,
            pedido_codigo: pedidos.codigo,
            cliente: pedidos.cliente,
          })
          .from(entregasTracking)
          .innerJoin(embarques, eq(embarques.id, entregasTracking.embarqueId))
          .innerJoin(pedidos, eq(pedidos.id, entregasTracking.pedidoId))
          .where(
            and(
              eq(entregasTracking.tenantId, ctx.tenantId),
              sql`${embarques.dataEmbarque} >= ${dataInicio}::date`,
              sql`${embarques.dataEmbarque} <= ${dataFim}::date`,
            ),
          )
          .limit(500),
        conn.db
          .select()
          .from(devolucoes)
          .where(
            and(
              eq(devolucoes.tenantId, ctx.tenantId),
              sql`DATE(${devolucoes.createdAt}) >= ${dataInicio}::date`,
              sql`DATE(${devolucoes.createdAt}) <= ${dataFim}::date`,
            ),
          )
          .orderBy(desc(devolucoes.createdAt))
          .limit(200),
      ])

      const entregues = tracks.filter((t) => t.status_entrega === 'ENTREGUE').length
      const devolvidasTrack = tracks.filter((t) => t.status_entrega === 'DEVOLVIDA').length
      const finalizadas = entregues + devolvidasTrack
      const otifPct = finalizadas > 0 ? Number(((entregues / finalizadas) * 100).toFixed(1)) : 100

      const motivosDev = new Map<string, { motivo: string; qtd: number; kg: number; valor: number }>()
      let devKg = 0
      let devVal = 0
      for (const d of devs) {
        const kg = toNum(d.pesoTotalKg, 0)
        const v = toNum(d.valorEstimado, 0)
        devKg += kg
        devVal += v
        const m = d.motivo || 'OUTROS'
        const cur = motivosDev.get(m) || { motivo: m, qtd: 0, kg: 0, valor: 0 }
        cur.qtd += 1
        cur.kg = Number((cur.kg + kg).toFixed(2))
        cur.valor = Number((cur.valor + v).toFixed(2))
        motivosDev.set(m, cur)
      }

      return {
        success: true,
        periodo: { dataInicio, dataFim },
        resumo: {
          embarques_total: embs.length,
          embarques_concluidos: embs.filter((e) => e.status === 'CONCLUIDO').length,
          paradas_total: tracks.length,
          paradas_entregues: entregues,
          paradas_devolvidas: devolvidasTrack,
          otif_pct: otifPct,
          devolucoes_qtd: devs.length,
          devolucoes_kg: Number(devKg.toFixed(2)),
          devolucoes_valor: Number(devVal.toFixed(2)),
        },
        motivos_devolucao: Array.from(motivosDev.values()).sort((a, b) => b.valor - a.valor),
        embarques: embs.map((e) => ({
          id: e.id,
          codigo: e.codigo,
          titulo: e.titulo,
          data_embarque: e.dataEmbarque,
          motorista_nome: e.motoristaNome || '-',
          veiculo_placa: e.veiculoPlaca || '-',
          status: e.status,
          paradas: tracks.filter((t) => t.embarque_id === e.id).length,
          entregues: tracks.filter((t) => t.embarque_id === e.id && t.status_entrega === 'ENTREGUE').length,
        })),
        devolucoes: devs.map((d) => ({
          id: d.id,
          codigo: d.codigo,
          cliente_nome: d.clienteNome,
          pedido_codigo: d.pedidoCodigo,
          motivo: d.motivo,
          peso_kg: toNum(d.pesoTotalKg, 0),
          valor_estimado: toNum(d.valorEstimado, 0),
          status_fiscal: d.statusFiscal,
          created_at: d.createdAt,
        })),
      }
    },
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // 14) TRANSFERÊNCIAS INTER-UNIDADES, PERDAS & CADEIA DE FRIO
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(
    '/api/relatorios/bi/interunidades-perdas',
    { preHandler: requirePermission(PERM_BI_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { dataInicio?: string; dataFim?: string }
      const { dataInicio, dataFim } = resolverPeriodo(q)

      const [interRows, filRows, perdasRows, tempRows] = await Promise.all([
        conn.db
          .select()
          .from(interunidadesMovimentacoes)
          .where(
            and(
              eq(interunidadesMovimentacoes.tenantId, ctx.tenantId),
              sql`${interunidadesMovimentacoes.dataMovimento} >= ${dataInicio}::date`,
              sql`${interunidadesMovimentacoes.dataMovimento} <= ${dataFim}::date`,
            ),
          )
          .orderBy(desc(interunidadesMovimentacoes.createdAt))
          .limit(300),
        conn.db.select({ id: filiais.id, codigo: filiais.codigo, nome: filiais.nome }).from(filiais).where(eq(filiais.tenantId, ctx.tenantId)),
        conn.db
          .select()
          .from(perdasRegistro)
          .where(
            and(
              eq(perdasRegistro.tenantId, ctx.tenantId),
              sql`DATE(${perdasRegistro.createdAt}) >= ${dataInicio}::date`,
              sql`DATE(${perdasRegistro.createdAt}) <= ${dataFim}::date`,
            ),
          )
          .orderBy(desc(perdasRegistro.createdAt))
          .limit(300),
        conn.db
          .select({ conforme: camarasTemperaturaLog.conforme })
          .from(camarasTemperaturaLog)
          .where(
            and(
              eq(camarasTemperaturaLog.tenantId, ctx.tenantId),
              sql`DATE(${camarasTemperaturaLog.createdAt}) >= ${dataInicio}::date`,
              sql`DATE(${camarasTemperaturaLog.createdAt}) <= ${dataFim}::date`,
            ),
          ),
      ])

      const filMap = new Map(filRows.map((f) => [f.id, `${f.codigo} ${f.nome}`]))
      const perdasPorMotivo = new Map<string, { motivo: string; qtd: number; kg: number; valor: number }>()
      let perdasKg = 0
      let perdasVal = 0
      for (const p of perdasRows) {
        const kg = toNum(p.qtdKg, 0)
        const v = toNum(p.custoTotalPerda, 0)
        perdasKg += kg
        perdasVal += v
        const cur = perdasPorMotivo.get(p.motivo) || { motivo: p.motivo, qtd: 0, kg: 0, valor: 0 }
        cur.qtd += 1
        cur.kg = Number((cur.kg + kg).toFixed(2))
        cur.valor = Number((cur.valor + v).toFixed(2))
        perdasPorMotivo.set(p.motivo, cur)
      }

      const tempConformes = tempRows.filter((t) => Number(t.conforme) === 1).length
      const tempPct = tempRows.length > 0 ? Number(((tempConformes / tempRows.length) * 100).toFixed(1)) : 100

      return {
        success: true,
        periodo: { dataInicio, dataFim },
        resumo: {
          inter_total_movs: interRows.length,
          inter_kg_total: Number(interRows.reduce((s, r) => s + toNum(r.pesoKg, 0), 0).toFixed(2)),
          inter_valor_total: Number(interRows.reduce((s, r) => s + toNum(r.valorTotal, 0), 0).toFixed(2)),
          perdas_qtd: perdasRows.length,
          perdas_kg: Number(perdasKg.toFixed(2)),
          perdas_valor: Number(perdasVal.toFixed(2)),
          temp_leituras: tempRows.length,
          temp_conformidade_pct: tempPct,
        },
        perdas_por_motivo: Array.from(perdasPorMotivo.values()).sort((a, b) => b.valor - a.valor),
        interunidades: interRows.map((i) => ({
          id: i.id,
          codigo: i.codigo,
          tipo_operacao: i.tipoOperacao,
          origem: filMap.get(i.filialOrigemId) || '-',
          destino: filMap.get(i.filialDestinoId) || '-',
          produto_descricao: i.produtoDescricao,
          peso_kg: toNum(i.pesoKg, 0),
          valor_total: toNum(i.valorTotal, 0),
          status_fiscal: i.statusFiscal,
          data_movimento: i.dataMovimento,
        })),
        perdas: perdasRows.map((p) => ({
          id: p.id,
          codigo: p.codigo,
          motivo: p.motivo,
          origem: p.origem,
          produto_descricao: p.produtoDescricao,
          qtd_kg: toNum(p.qtdKg, 0),
          custo_total_perda: toNum(p.custoTotalPerda, 0),
          operador_nome: p.operadorNome,
          created_at: p.createdAt,
        })),
      }
    },
  )
}
