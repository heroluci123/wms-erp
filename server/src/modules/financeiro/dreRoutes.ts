import type { FastifyInstance } from 'fastify'
import { and, asc, desc, eq, gte, inArray, lte, ne, notInArray } from 'drizzle-orm'
import type { DbConnection } from '../../db/client.js'
import {
  centrosCusto,
  clientes,
  devolucaoItens,
  devolucoes,
  estoqueCaixas,
  financeiroMovimentacoes,
  financeiroTitulos,
  opInsumos,
  opRetornos,
  ordensProducao,
  pedidos,
  pedidosItens,
  produtos,
  romaneios,
  romaneiosItens,
  vendedores,
} from '../../db/schema/index.js'
import { createAuthMiddleware } from '../../middlewares/auth.js'
import { hojeIsoLocal, normalizarDataIso, toNum } from '../wms/helpers.js'

function toIsoDay(d: unknown): string {
  if (!d) return ''
  if (d instanceof Date) return d.toISOString().slice(0, 10)
  return String(d).slice(0, 10)
}

function getMonthRange(ym: string): { ini: string; fim: string } {
  const [y, m] = ym.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return {
    ini: `${ym}-01`,
    fim: `${ym}-${String(lastDay).padStart(2, '0')}`,
  }
}

function getLast6Months(endIso: string): string[] {
  const [y, m] = endIso.slice(0, 7).split('-').map(Number)
  const out: string[] = []
  for (let i = 5; i >= 0; i -= 1) {
    const dt = new Date(Date.UTC(y, m - 1 - i, 1))
    out.push(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

function r2(n: number): number {
  return Number((Number.isFinite(n) ? n : 0).toFixed(2))
}

function r3(n: number): number {
  return Number((Number.isFinite(n) ? n : 0).toFixed(3))
}

function pct(part: number, total: number): number {
  if (!Number.isFinite(total) || Math.abs(total) < 0.005) return 0
  return Number(((part / total) * 100).toFixed(2))
}

interface PedidoAnalisado {
  pedido_id: string
  codigo: string
  data: string
  mes: string
  status: string
  cliente_id: string | null
  cliente_nome: string
  vendedor_id: string | null
  vendedor_nome: string
  vendedor_tipo_comissao: string
  vendedor_pct_comissao: number
  qtd_kg: number
  receita: number
  custo_real: number
  custo_origem: 'CAIXAS_REAIS' | 'CUSTO_MEDIO'
  margem_rs: number
  margem_pct: number
  alerta_margem: 'PREJUIZO' | 'BAIXA' | 'SAUDAVEL'
  itens: Array<{
    produto_id: string
    produto_codigo: string
    produto_descricao: string
    classificacao: string
    qtd_kg: number
    receita: number
    custo_total: number
  }>
}

async function carregarPedidosAnalisados(
  conn: DbConnection,
  tenantId: string,
  dataIni: string,
  dataFim: string,
): Promise<PedidoAnalisado[]> {
  const pedsRows = await conn.db
    .select({
      id: pedidos.id,
      codigo: pedidos.codigo,
      status: pedidos.status,
      clienteId: pedidos.clienteId,
      clienteTexto: pedidos.cliente,
      clienteFant: clientes.nomeFantasia,
      clienteRazao: clientes.razaoSocial,
      vendedorId: pedidos.vendedorId,
      vendedorNome: vendedores.nome,
      vendedorTipoCom: vendedores.tipoComissao,
      vendedorPctCom: vendedores.pctComissao,
      valorTotal: pedidos.valorTotal,
      expedidoAt: pedidos.expedidoAt,
      createdAt: pedidos.createdAt,
    })
    .from(pedidos)
    .leftJoin(clientes, eq(clientes.id, pedidos.clienteId))
    .leftJoin(vendedores, eq(vendedores.id, pedidos.vendedorId))
    .where(
      and(
        eq(pedidos.tenantId, tenantId),
        notInArray(pedidos.status, ['CANCELADO', 'RASCUNHO']),
      ),
    )
    .orderBy(desc(pedidos.createdAt))

  const pedsNoPeriodo = pedsRows
    .map((p) => {
      const dt = toIsoDay(p.expedidoAt || p.createdAt)
      return { ...p, _data: dt, _mes: dt.slice(0, 7) }
    })
    .filter((p) => p._data >= dataIni && p._data <= dataFim)

  if (pedsNoPeriodo.length === 0) return []

  const pedIds = pedsNoPeriodo.map((p) => p.id)

  const [itensRows, romsRows] = await Promise.all([
    conn.db
      .select({
        pedidoId: pedidosItens.pedidoId,
        produtoId: pedidosItens.produtoId,
        prodCodigo: produtos.codigo,
        prodDescricao: produtos.descricao,
        prodClassif: produtos.classificacao,
        prodCustoMedio: produtos.custoMedioKg,
        qtdKg: pedidosItens.qtdKgSolicitada,
        precoUnit: pedidosItens.precoUnitario,
        descontoValor: pedidosItens.descontoValor,
      })
      .from(pedidosItens)
      .innerJoin(produtos, eq(produtos.id, pedidosItens.produtoId))
      .where(inArray(pedidosItens.pedidoId, pedIds)),
    conn.db
      .select({
        pedidoId: romaneios.pedidoId,
        produtoId: romaneiosItens.produtoId,
        pesoKg: romaneiosItens.pesoKg,
        caixaCustoKg: estoqueCaixas.custoUnitarioKg,
        prodCustoMedio: produtos.custoMedioKg,
      })
      .from(romaneiosItens)
      .innerJoin(romaneios, eq(romaneios.id, romaneiosItens.romaneioId))
      .innerJoin(produtos, eq(produtos.id, romaneiosItens.produtoId))
      .leftJoin(estoqueCaixas, eq(estoqueCaixas.id, romaneiosItens.caixaId))
      .where(and(eq(romaneios.tenantId, tenantId), inArray(romaneios.pedidoId, pedIds))),
  ])

  // Agrupa caixas reais expedidas/separadas por (pedidoId + produtoId)
  const realPorPedProd = new Map<string, { kg: number; custo: number; temCustoCaixa: boolean }>()
  const pedsComCaixas = new Set<string>()
  for (const r of romsRows) {
    if (!r.pedidoId) continue
    pedsComCaixas.add(r.pedidoId)
    const key = `${r.pedidoId}::${r.produtoId}`
    const cur = realPorPedProd.get(key) || { kg: 0, custo: 0, temCustoCaixa: false }
    const kg = toNum(r.pesoKg, 0)
    const cxCusto = toNum(r.caixaCustoKg, 0)
    const prodCusto = toNum(r.prodCustoMedio, 0)
    const unit = cxCusto > 0 ? cxCusto : prodCusto
    cur.kg += kg
    cur.custo += kg * unit
    if (cxCusto > 0) cur.temCustoCaixa = true
    realPorPedProd.set(key, cur)
  }

  const itensPorPed = new Map<string, typeof itensRows>()
  for (const it of itensRows) {
    const arr = itensPorPed.get(it.pedidoId) || []
    arr.push(it)
    itensPorPed.set(it.pedidoId, arr)
  }

  return pedsNoPeriodo.map((p) => {
    const its = itensPorPed.get(p.id) || []
    const usaCaixas = pedsComCaixas.has(p.id)
    let kgPed = 0
    let recPed = 0
    let custoPed = 0
    let usouCustoCaixaReal = false

    const itensCalc = its.map((it) => {
      const real = realPorPedProd.get(`${p.id}::${it.produtoId}`)
      const kgSol = toNum(it.qtdKg, 0)
      const preco = toNum(it.precoUnit, 0)
      const desc = toNum(it.descontoValor, 0)
      const kgEfetivo = usaCaixas && real && real.kg > 0 ? real.kg : kgSol
      const recItem = Math.max(0, r2(kgEfetivo * preco - desc))
      let custoItem = 0
      if (usaCaixas && real && real.kg > 0) {
        custoItem = r2(real.custo)
        if (real.temCustoCaixa) usouCustoCaixaReal = true
      } else {
        custoItem = r2(kgEfetivo * toNum(it.prodCustoMedio, 0))
      }

      kgPed += kgEfetivo
      recPed += recItem
      custoPed += custoItem

      return {
        produto_id: it.produtoId,
        produto_codigo: it.prodCodigo || '',
        produto_descricao: it.prodDescricao || 'Produto',
        classificacao: it.prodClassif || '',
        qtd_kg: r3(kgEfetivo),
        receita: recItem,
        custo_total: custoItem,
      }
    })

    // Caso o pedido não tenha preços nos itens mas tenha valorTotal preenchido
    if (recPed <= 0 && toNum(p.valorTotal, 0) > 0) {
      recPed = r2(toNum(p.valorTotal, 0))
    }

    recPed = r2(recPed)
    custoPed = r2(custoPed)
    const margRs = r2(recPed - custoPed)
    const margPct = pct(margRs, recPed)
    const alerta: 'PREJUIZO' | 'BAIXA' | 'SAUDAVEL' =
      margRs < 0 ? 'PREJUIZO' : margPct < 10 ? 'BAIXA' : 'SAUDAVEL'

    return {
      pedido_id: p.id,
      codigo: p.codigo,
      data: p._data,
      mes: p._mes,
      status: p.status,
      cliente_id: p.clienteId,
      cliente_nome: p.clienteFant || p.clienteRazao || p.clienteTexto || 'Cliente',
      vendedor_id: p.vendedorId,
      vendedor_nome: p.vendedorNome || 'Sem Vendedor',
      vendedor_tipo_comissao: String(p.vendedorTipoCom || 'PCT_VENDA').toUpperCase(),
      vendedor_pct_comissao: toNum(p.vendedorPctCom, 0),
      qtd_kg: r3(kgPed),
      receita: recPed,
      custo_real: custoPed,
      custo_origem: usouCustoCaixaReal ? 'CAIXAS_REAIS' : 'CUSTO_MEDIO',
      margem_rs: margRs,
      margem_pct: margPct,
      alerta_margem: alerta,
      itens: itensCalc,
    }
  })
}

export function registerDreRoutes(app: FastifyInstance, conn: DbConnection): void {
  const { requirePermission } = createAuthMiddleware(app, conn)
  const readPerm = requirePermission(['financeiro', 'financeiro_pedidos', 'dashboard_executivo'], {
    write: false,
    bloquearCliente: true,
  })

  // ── DRE GERENCIAL COMPLETO (COMPETÊNCIA OU CAIXA) + EVOLUÇÃO 6 MESES ────────
  app.get('/api/financeiro/dre', { preHandler: readPerm }, async (req) => {
    const ctx = req.authCtx!
    const q = (req.query || {}) as { data_inicio?: string; data_fim?: string; regime?: string }
    const hoje = hojeIsoLocal()
    const dataIni = normalizarDataIso(q.data_inicio) || `${hoje.slice(0, 7)}-01`
    const dataFim = normalizarDataIso(q.data_fim) || hoje
    const regime = String(q.regime || 'COMPETENCIA').toUpperCase() === 'CAIXA' ? 'CAIXA' : 'COMPETENCIA'

    const meses6 = getLast6Months(dataFim)
    const ini6m = getMonthRange(meses6[0]).ini
    const fim6m = getMonthRange(meses6[meses6.length - 1]).fim
    const buscaIni = dataIni < ini6m ? dataIni : ini6m
    const buscaFim = dataFim > fim6m ? dataFim : fim6m

    const [
      pedidos6m,
      devRows,
      titulosPagarRows,
      movsRows,
      opsFechadasRows,
    ] = await Promise.all([
      carregarPedidosAnalisados(conn, ctx.tenantId, buscaIni, buscaFim),
      conn.db
        .select({
          id: devolucoes.id,
          acaoEstoque: devolucoes.acaoEstoque,
          valorEstimado: devolucoes.valorEstimado,
          createdAt: devolucoes.createdAt,
        })
        .from(devolucoes)
        .where(eq(devolucoes.tenantId, ctx.tenantId)),
      conn.db
        .select({
          id: financeiroTitulos.id,
          origem: financeiroTitulos.origem,
          status: financeiroTitulos.status,
          centroCustoId: financeiroTitulos.centroCustoId,
          centroCustoCod: centrosCusto.codigo,
          centroCustoNome: centrosCusto.descricao,
          dataEmissao: financeiroTitulos.dataEmissao,
          dataVencimento: financeiroTitulos.dataVencimento,
          dataPagamento: financeiroTitulos.dataPagamento,
          valorOriginal: financeiroTitulos.valorOriginal,
          valorPago: financeiroTitulos.valorPago,
        })
        .from(financeiroTitulos)
        .leftJoin(centrosCusto, eq(centrosCusto.id, financeiroTitulos.centroCustoId))
        .where(
          and(
            eq(financeiroTitulos.tenantId, ctx.tenantId),
            eq(financeiroTitulos.tipo, 'PAGAR'),
            ne(financeiroTitulos.status, 'CANCELADO'),
          ),
        ),
      conn.db
        .select({
          tipo: financeiroMovimentacoes.tipo,
          categoria: financeiroMovimentacoes.categoria,
          dataMovimento: financeiroMovimentacoes.dataMovimento,
          valor: financeiroMovimentacoes.valor,
          historico: financeiroMovimentacoes.historico,
        })
        .from(financeiroMovimentacoes)
        .where(
          and(
            eq(financeiroMovimentacoes.tenantId, ctx.tenantId),
            gte(financeiroMovimentacoes.dataMovimento, buscaIni),
            lte(financeiroMovimentacoes.dataMovimento, buscaFim),
          ),
        ),
      conn.db
        .select({
          id: ordensProducao.id,
          dataProducao: ordensProducao.dataProducao,
          createdAt: ordensProducao.createdAt,
          custoMpTotal: ordensProducao.custoMpTotal,
          rendimentoPct: ordensProducao.rendimentoPct,
          perdaPct: ordensProducao.perdaPct,
        })
        .from(ordensProducao)
        .where(and(eq(ordensProducao.tenantId, ctx.tenantId), eq(ordensProducao.status, 'FECHADA'))),
    ])

    // Filtra devoluções do período e busca custo das caixas devolvidas (estorno de CMV vs perda em quarentena)
    const devsPeriodo = devRows.filter((d) => {
      const dt = toIsoDay(d.createdAt)
      return dt >= dataIni && dt <= dataFim
    })

    let devolucoesValor = 0
    let estornoCmvDevolucao = 0
    let perdaQuarentenaDevolucao = 0
    if (devsPeriodo.length > 0) {
      devolucoesValor = r2(devsPeriodo.reduce((s, d) => s + toNum(d.valorEstimado, 0), 0))
      const devIds = devsPeriodo.map((d) => d.id)
      const acaoPorDev = new Map(devsPeriodo.map((d) => [d.id, d.acaoEstoque]))
      const devItensRows = await conn.db
        .select({
          devolucaoId: devolucaoItens.devolucaoId,
          pesoKg: devolucaoItens.pesoKg,
          caixaCustoKg: estoqueCaixas.custoUnitarioKg,
          prodCustoMedio: produtos.custoMedioKg,
        })
        .from(devolucaoItens)
        .innerJoin(produtos, eq(produtos.id, devolucaoItens.produtoId))
        .leftJoin(estoqueCaixas, eq(estoqueCaixas.id, devolucaoItens.caixaId))
        .where(inArray(devolucaoItens.devolucaoId, devIds))

      for (const it of devItensRows) {
        const custoUnit = toNum(it.caixaCustoKg, 0) || toNum(it.prodCustoMedio, 0)
        const custoItem = toNum(it.pesoKg, 0) * custoUnit
        if (acaoPorDev.get(it.devolucaoId) === 'DISPONIVEL') {
          estornoCmvDevolucao += custoItem
        } else {
          perdaQuarentenaDevolucao += custoItem
        }
      }
      estornoCmvDevolucao = r2(estornoCmvDevolucao)
      perdaQuarentenaDevolucao = r2(perdaQuarentenaDevolucao)
    }

    // Pedidos do período selecionado
    const pedsPeriodo = pedidos6m.filter((p) => p.data >= dataIni && p.data <= dataFim)

    // 1. Receita Bruta
    let receitaBruta = 0
    if (regime === 'CAIXA') {
      receitaBruta = r2(
        movsRows
          .filter(
            (m) =>
              m.tipo === 'ENTRADA' &&
              ['RECEBIMENTO_TITULO', 'LANCAMENTO_AVULSO', 'CONCILIACAO_OFX'].includes(m.categoria) &&
              toIsoDay(m.dataMovimento) >= dataIni &&
              toIsoDay(m.dataMovimento) <= dataFim,
          )
          .reduce((s, m) => s + toNum(m.valor, 0), 0),
      )
    } else {
      receitaBruta = r2(pedsPeriodo.reduce((s, p) => s + p.receita, 0))
    }

    const receitaLiquida = r2(Math.max(0, receitaBruta - (regime === 'COMPETENCIA' ? devolucoesValor : 0)))

    // 2. CMV Real
    const cmvBruto = r2(pedsPeriodo.reduce((s, p) => s + p.custo_real, 0))
    const cmvLiquido = r2(Math.max(0, cmvBruto - estornoCmvDevolucao))
    const lucroBruto = r2(receitaLiquida - cmvLiquido)
    const margemBrutaPct = pct(lucroBruto, receitaLiquida)

    // 3. Despesas Operacionais por Centro de Custo + Tarifas/Saídas Avulsas (Extrato/OFX)
    const despesasPorCc = new Map<string, { codigo: string; nome: string; valor: number; qtd: number }>()
    let despesasOperacionaisTotal = 0
    let comissoesLancadas = 0

    for (const t of titulosPagarRows) {
      if (['COMPRA_PC', 'COMPRA_NFE_XML'].includes(t.origem)) continue
      const dtRef =
        regime === 'CAIXA'
          ? toIsoDay(t.dataPagamento)
          : toIsoDay(t.dataVencimento || t.dataEmissao)
      if (!dtRef || dtRef < dataIni || dtRef > dataFim) continue
      const val = regime === 'CAIXA' ? toNum(t.valorPago, 0) : toNum(t.valorOriginal, 0)
      if (val <= 0) continue

      if (t.origem === 'COMISSAO') {
        comissoesLancadas += val
        continue
      }

      const key = t.centroCustoId || 'SEM_CC'
      const cur = despesasPorCc.get(key) || {
        codigo: t.centroCustoCod || '-',
        nome: t.centroCustoNome || 'Despesas Gerais (Sem Centro de Custo)',
        valor: 0,
        qtd: 0,
      }
      cur.valor = r2(cur.valor + val)
      cur.qtd += 1
      despesasPorCc.set(key, cur)
      despesasOperacionaisTotal += val
    }

    // Saídas avulsas / tarifas bancárias conciliadas no extrato/OFX
    let saidasAvulsas = 0
    let qtdSaidasAvulsas = 0
    for (const m of movsRows) {
      if (
        m.tipo === 'SAIDA' &&
        ['LANCAMENTO_AVULSO', 'CONCILIACAO_OFX'].includes(m.categoria) &&
        toIsoDay(m.dataMovimento) >= dataIni &&
        toIsoDay(m.dataMovimento) <= dataFim
      ) {
        saidasAvulsas += toNum(m.valor, 0)
        qtdSaidasAvulsas += 1
      }
    }
    if (saidasAvulsas > 0) {
      despesasPorCc.set('EXTRATO_OFX_AVULSO', {
        codigo: 'OFX',
        nome: 'Tarifas & Lançamentos Avulsos Bancários (Extrato/OFX)',
        valor: r2(saidasAvulsas),
        qtd: qtdSaidasAvulsas,
      })
      despesasOperacionaisTotal += saidasAvulsas
    }
    despesasOperacionaisTotal = r2(despesasOperacionaisTotal)

    // 4. Comissões (usa lançadas ou estima sobre pedidos do período no regime de competência)
    let comissoesTotal = r2(comissoesLancadas)
    let comissaoOrigem: 'LANCADA' | 'ESTIMADA' = 'LANCADA'
    if (comissoesTotal <= 0 && regime === 'COMPETENCIA') {
      let estimada = 0
      for (const p of pedsPeriodo) {
        if (!p.vendedor_id || p.vendedor_pct_comissao <= 0) continue
        if (p.vendedor_tipo_comissao === 'VALOR_KG') {
          estimada += p.qtd_kg * p.vendedor_pct_comissao
        } else if (p.vendedor_tipo_comissao === 'PCT_MARGEM') {
          estimada += Math.max(0, p.margem_rs) * (p.vendedor_pct_comissao / 100)
        } else {
          estimada += p.receita * (p.vendedor_pct_comissao / 100)
        }
      }
      if (estimada > 0) {
        comissoesTotal = r2(estimada)
        comissaoOrigem = 'ESTIMADA'
      }
    }

    // 5. Perdas / Quebras de Desossa no Período (Informativo — já absorvido no CMV NRV)
    const opsPeriodo = opsFechadasRows.filter((o) => {
      const dt = toIsoDay(o.dataProducao || o.createdAt)
      return dt >= dataIni && dt <= dataFim
    })
    let prodPesoEntrada = 0
    let prodPesoRetorno = 0
    let prodCustoMp = 0
    if (opsPeriodo.length > 0) {
      const opIds = opsPeriodo.map((o) => o.id)
      const [insRows, retRows] = await Promise.all([
        conn.db
          .select({ pesoKg: opInsumos.pesoKg, custoKg: opInsumos.custoUnitarioKg })
          .from(opInsumos)
          .where(inArray(opInsumos.opId, opIds)),
        conn.db
          .select({ pesoKg: opRetornos.pesoKg })
          .from(opRetornos)
          .where(inArray(opRetornos.opId, opIds)),
      ])
      for (const i of insRows) {
        const kg = toNum(i.pesoKg, 0)
        prodPesoEntrada += kg
        prodCustoMp += kg * toNum(i.custoKg, 0)
      }
      for (const r of retRows) prodPesoRetorno += toNum(r.pesoKg, 0)
    }
    const prodQuebraKg = r3(Math.max(0, prodPesoEntrada - prodPesoRetorno))
    const prodRendimentoPct = prodPesoEntrada > 0 ? pct(prodPesoRetorno, prodPesoEntrada) : 0
    const prodCustoMedioMp = prodPesoEntrada > 0 ? prodCustoMp / prodPesoEntrada : 0
    const prodValorQuebraEst = r2(prodQuebraKg * prodCustoMedioMp)

    // 6. Lucro Líquido Operacional
    const totalDespesasEComissoes = r2(despesasOperacionaisTotal + comissoesTotal + perdaQuarentenaDevolucao)
    const lucroLiquido = r2(lucroBruto - totalDespesasEComissoes)
    const margemLiquidaPct = pct(lucroLiquido, receitaLiquida)

    const linhasDre = [
      {
        codigo: '1',
        nome: regime === 'CAIXA' ? 'Recebimentos Operacionais (Regime de Caixa)' : 'Receita Bruta de Vendas',
        tipo: 'RECEITA',
        valor: receitaBruta,
        pct_receita: 100,
      },
      {
        codigo: '2',
        nome: '(-) Devoluções de Clientes',
        tipo: 'DEDUCAO',
        valor: regime === 'COMPETENCIA' ? -devolucoesValor : 0,
        pct_receita: pct(regime === 'COMPETENCIA' ? devolucoesValor : 0, receitaBruta),
      },
      {
        codigo: '3',
        nome: '(=) Receita Líquida',
        tipo: 'SUBTOTAL',
        valor: receitaLiquida,
        pct_receita: pct(receitaLiquida, receitaBruta || receitaLiquida),
      },
      {
        codigo: '4',
        nome: '(-) CMV — Custo da Mercadoria Vendida (Real)',
        tipo: 'CUSTO',
        valor: -cmvLiquido,
        pct_receita: pct(cmvLiquido, receitaLiquida),
      },
      {
        codigo: '5',
        nome: '(=) Lucro Bruto / Margem de Contribuição',
        tipo: 'SUBTOTAL',
        valor: lucroBruto,
        pct_receita: margemBrutaPct,
      },
      {
        codigo: '6',
        nome: '(-) Despesas Operacionais (Centros de Custo + Tarifas)',
        tipo: 'DESPESA',
        valor: -despesasOperacionaisTotal,
        pct_receita: pct(despesasOperacionaisTotal, receitaLiquida),
      },
      {
        codigo: '7',
        nome: `(-) Comissões de Vendedores (${comissaoOrigem === 'LANCADA' ? 'Lançadas' : 'Estimadas'})`,
        tipo: 'DESPESA',
        valor: -comissoesTotal,
        pct_receita: pct(comissoesTotal, receitaLiquida),
      },
      ...(perdaQuarentenaDevolucao > 0
        ? [
            {
              codigo: '8',
              nome: '(-) Perdas / Avarias (Devoluções em Quarentena)',
              tipo: 'DESPESA',
              valor: -perdaQuarentenaDevolucao,
              pct_receita: pct(perdaQuarentenaDevolucao, receitaLiquida),
            },
          ]
        : []),
      {
        codigo: '9',
        nome: '(=) Resultado Líquido Operacional (Lucro / Prejuízo)',
        tipo: 'RESULTADO',
        valor: lucroLiquido,
        pct_receita: margemLiquidaPct,
      },
    ]

    // 7. Evolução Mensal (Últimos 6 meses)
    const evolucaoMensal = meses6.map((ym) => {
      const pedsMes = pedidos6m.filter((p) => p.mes === ym)
      const recMes =
        regime === 'CAIXA'
          ? r2(
              movsRows
                .filter(
                  (m) =>
                    m.tipo === 'ENTRADA' &&
                    ['RECEBIMENTO_TITULO', 'LANCAMENTO_AVULSO', 'CONCILIACAO_OFX'].includes(m.categoria) &&
                    toIsoDay(m.dataMovimento).slice(0, 7) === ym,
                )
                .reduce((s, m) => s + toNum(m.valor, 0), 0),
            )
          : r2(pedsMes.reduce((s, p) => s + p.receita, 0))
      const cmvMes = r2(pedsMes.reduce((s, p) => s + p.custo_real, 0))

      let despMes = 0
      for (const t of titulosPagarRows) {
        if (['COMPRA_PC', 'COMPRA_NFE_XML'].includes(t.origem)) continue
        const dtRef = regime === 'CAIXA' ? toIsoDay(t.dataPagamento) : toIsoDay(t.dataVencimento || t.dataEmissao)
        if (dtRef.slice(0, 7) !== ym) continue
        despMes += regime === 'CAIXA' ? toNum(t.valorPago, 0) : toNum(t.valorOriginal, 0)
      }
      for (const m of movsRows) {
        if (
          m.tipo === 'SAIDA' &&
          ['LANCAMENTO_AVULSO', 'CONCILIACAO_OFX'].includes(m.categoria) &&
          toIsoDay(m.dataMovimento).slice(0, 7) === ym
        ) {
          despMes += toNum(m.valor, 0)
        }
      }
      despMes = r2(despMes)
      const lucroMes = r2(recMes - cmvMes - despMes)
      return {
        mes: ym,
        receita: recMes,
        cmv: cmvMes,
        despesas: despMes,
        lucro_liquido: lucroMes,
        margem_liquida_pct: pct(lucroMes, recMes),
      }
    })

    return {
      success: true,
      periodo: { data_inicio: dataIni, data_fim: dataFim, regime },
      kpis: {
        receita_bruta: receitaBruta,
        devolucoes: regime === 'COMPETENCIA' ? devolucoesValor : 0,
        receita_liquida: receitaLiquida,
        cmv_real: cmvLiquido,
        lucro_bruto: lucroBruto,
        margem_bruta_pct: margemBrutaPct,
        despesas_operacionais: despesasOperacionaisTotal,
        comissoes: comissoesTotal,
        comissao_origem: comissaoOrigem,
        perdas_quarentena: perdaQuarentenaDevolucao,
        lucro_liquido: lucroLiquido,
        margem_liquida_pct: margemLiquidaPct,
        qtd_pedidos: pedsPeriodo.length,
        volume_vendido_kg: r3(pedsPeriodo.reduce((s, p) => s + p.qtd_kg, 0)),
      },
      linhas_dre: linhasDre,
      despesas_por_centro_custo: Array.from(despesasPorCc.values()).sort((a, b) => b.valor - a.valor),
      informativo_desossa: {
        qtd_ops_fechadas: opsPeriodo.length,
        peso_entrada_kg: r3(prodPesoEntrada),
        peso_retorno_kg: r3(prodPesoRetorno),
        quebra_kg: prodQuebraKg,
        rendimento_medio_pct: prodRendimentoPct,
        valor_quebra_estimado: prodValorQuebraEst,
      },
      evolucao_mensal: evolucaoMensal,
    }
  })

  // ── RAIO-X DE RENTABILIDADE (PRODUTO, CLIENTE, VENDEDOR, PEDIDO) ────────────
  app.get('/api/financeiro/rentabilidade', { preHandler: readPerm }, async (req) => {
    const ctx = req.authCtx!
    const q = (req.query || {}) as { data_inicio?: string; data_fim?: string }
    const hoje = hojeIsoLocal()
    const dataIni = normalizarDataIso(q.data_inicio) || `${hoje.slice(0, 7)}-01`
    const dataFim = normalizarDataIso(q.data_fim) || hoje

    const peds = await carregarPedidosAnalisados(conn, ctx.tenantId, dataIni, dataFim)

    const prodMap = new Map<
      string,
      {
        produto_id: string
        codigo: string
        descricao: string
        classificacao: string
        qtd_kg: number
        receita: number
        custo_total: number
      }
    >()
    const cliMap = new Map<
      string,
      {
        cliente_id: string | null
        cliente_nome: string
        qtd_pedidos: number
        qtd_kg: number
        receita: number
        custo_total: number
      }
    >()
    const vendMap = new Map<
      string,
      {
        vendedor_id: string | null
        vendedor_nome: string
        qtd_pedidos: number
        qtd_kg: number
        receita: number
        custo_total: number
        comissao_estimada: number
      }
    >()

    for (const p of peds) {
      // Por cliente
      const cKey = p.cliente_id || `TXT:${p.cliente_nome}`
      const cCur = cliMap.get(cKey) || {
        cliente_id: p.cliente_id,
        cliente_nome: p.cliente_nome,
        qtd_pedidos: 0,
        qtd_kg: 0,
        receita: 0,
        custo_total: 0,
      }
      cCur.qtd_pedidos += 1
      cCur.qtd_kg += p.qtd_kg
      cCur.receita += p.receita
      cCur.custo_total += p.custo_real
      cliMap.set(cKey, cCur)

      // Por vendedor
      const vKey = p.vendedor_id || 'SEM_VENDEDOR'
      const vCur = vendMap.get(vKey) || {
        vendedor_id: p.vendedor_id,
        vendedor_nome: p.vendedor_nome,
        qtd_pedidos: 0,
        qtd_kg: 0,
        receita: 0,
        custo_total: 0,
        comissao_estimada: 0,
      }
      vCur.qtd_pedidos += 1
      vCur.qtd_kg += p.qtd_kg
      vCur.receita += p.receita
      vCur.custo_total += p.custo_real
      if (p.vendedor_id && p.vendedor_pct_comissao > 0) {
        if (p.vendedor_tipo_comissao === 'VALOR_KG') {
          vCur.comissao_estimada += p.qtd_kg * p.vendedor_pct_comissao
        } else if (p.vendedor_tipo_comissao === 'PCT_MARGEM') {
          vCur.comissao_estimada += Math.max(0, p.margem_rs) * (p.vendedor_pct_comissao / 100)
        } else {
          vCur.comissao_estimada += p.receita * (p.vendedor_pct_comissao / 100)
        }
      }
      vendMap.set(vKey, vCur)

      // Por produto
      for (const it of p.itens) {
        const prCur = prodMap.get(it.produto_id) || {
          produto_id: it.produto_id,
          codigo: it.produto_codigo,
          descricao: it.produto_descricao,
          classificacao: it.classificacao,
          qtd_kg: 0,
          receita: 0,
          custo_total: 0,
        }
        prCur.qtd_kg += it.qtd_kg
        prCur.receita += it.receita
        prCur.custo_total += it.custo_total
        prodMap.set(it.produto_id, prCur)
      }
    }

    const porProduto = Array.from(prodMap.values())
      .map((x) => {
        const rec = r2(x.receita)
        const cus = r2(x.custo_total)
        const marg = r2(rec - cus)
        const mPct = pct(marg, rec)
        return {
          ...x,
          qtd_kg: r3(x.qtd_kg),
          receita: rec,
          custo_total: cus,
          preco_medio_kg: x.qtd_kg > 0 ? r2(rec / x.qtd_kg) : 0,
          custo_medio_real_kg: x.qtd_kg > 0 ? r2(cus / x.qtd_kg) : 0,
          margem_rs: marg,
          margem_pct: mPct,
          alerta_margem: marg < 0 ? 'PREJUIZO' : mPct < 10 ? 'BAIXA' : 'SAUDAVEL',
        }
      })
      .sort((a, b) => b.margem_rs - a.margem_rs)

    const porCliente = Array.from(cliMap.values())
      .map((x) => {
        const rec = r2(x.receita)
        const cus = r2(x.custo_total)
        const marg = r2(rec - cus)
        const mPct = pct(marg, rec)
        return {
          ...x,
          qtd_kg: r3(x.qtd_kg),
          receita: rec,
          custo_total: cus,
          ticket_medio: x.qtd_pedidos > 0 ? r2(rec / x.qtd_pedidos) : 0,
          margem_rs: marg,
          margem_pct: mPct,
          alerta_margem: marg < 0 ? 'PREJUIZO' : mPct < 10 ? 'BAIXA' : 'SAUDAVEL',
        }
      })
      .sort((a, b) => b.margem_rs - a.margem_rs)

    const porVendedor = Array.from(vendMap.values())
      .map((x) => {
        const rec = r2(x.receita)
        const cus = r2(x.custo_total)
        const marg = r2(rec - cus)
        return {
          ...x,
          qtd_kg: r3(x.qtd_kg),
          receita: rec,
          custo_total: cus,
          margem_rs: marg,
          margem_pct: pct(marg, rec),
          comissao_estimada: r2(x.comissao_estimada),
        }
      })
      .sort((a, b) => b.receita - a.receita)

    const porPedido = peds.map(({ itens, vendedor_tipo_comissao, vendedor_pct_comissao, ...pub }) => pub)

    const recTotal = r2(peds.reduce((s, p) => s + p.receita, 0))
    const cusTotal = r2(peds.reduce((s, p) => s + p.custo_real, 0))
    const margTotal = r2(recTotal - cusTotal)

    return {
      success: true,
      periodo: { data_inicio: dataIni, data_fim: dataFim },
      resumo: {
        qtd_pedidos: peds.length,
        qtd_kg: r3(peds.reduce((s, p) => s + p.qtd_kg, 0)),
        receita_total: recTotal,
        custo_total: cusTotal,
        margem_total_rs: margTotal,
        margem_media_pct: pct(margTotal, recTotal),
        pedidos_prejuizo: peds.filter((p) => p.alerta_margem === 'PREJUIZO').length,
        pedidos_margem_baixa: peds.filter((p) => p.alerta_margem === 'BAIXA').length,
        melhor_produto: porProduto[0]?.descricao || '-',
        melhor_cliente: porCliente[0]?.cliente_nome || '-',
      },
      por_produto: porProduto,
      por_cliente: porCliente,
      por_vendedor: porVendedor,
      por_pedido: porPedido,
    }
  })
}
