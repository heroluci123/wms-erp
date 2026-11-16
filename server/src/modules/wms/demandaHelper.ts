import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  clienteProdutoEspec,
  estoqueCaixas,
  opItensPrevistos,
  ordensProducao,
  pedidos,
  pedidosItens,
  produtoArvore,
  produtos,
} from '../../db/schema/index.js'
import { normalizarDataIso, toNum, type DbOrTx } from './helpers.js'

export interface DemandaCorteLinha {
  produto_id: string
  produto_codigo: string | null
  produto_descricao: string
  grupo: string
  classificacao: string | null
  materia_prima_id: string | null
  materia_prima_codigo: string | null
  materia_prima_descricao: string | null
  rendimento_usado_pct: number
  qtd_pedida_kg: number
  saldo_disponivel_kg: number
  saldo_em_op_kg: number
  deficit_produzir_kg: number
  qtd_mp_necessaria_kg: number
  especificacao: string
  conservacao: string
  clientes: Array<{
    cliente_id: string | null
    cliente_nome: string
    pedido_codigo: string
    qtd_kg: number
    especificacao: string
  }>
}

export async function calcularDemandaEMateriasPrimas(
  dbOrTx: DbOrTx,
  params: {
    tenantId: string
    filialId: string
    dataInicio?: string | null
    dataFim?: string | null
    incluirRascunho?: boolean
    grupo?: string | null
  },
) {
  const statusPermitidos = params.incluirRascunho
    ? ['RASCUNHO', 'BLOQUEADO_ESTOQUE', 'LIBERADO', 'EM_SEPARACAO', 'AGUARDANDO_PRODUCAO']
    : ['BLOQUEADO_ESTOQUE', 'LIBERADO', 'EM_SEPARACAO', 'AGUARDANDO_PRODUCAO']

  const dtIni = normalizarDataIso(params.dataInicio)
  const dtFim = normalizarDataIso(params.dataFim)

  const pedConds = [
    eq(pedidos.tenantId, params.tenantId),
    eq(pedidos.filialId, params.filialId),
    inArray(pedidos.status, statusPermitidos),
  ]
  if (dtIni) pedConds.push(sql`COALESCE(${pedidos.previsaoEntrega}, CURRENT_DATE) >= ${dtIni}`)
  if (dtFim) pedConds.push(sql`COALESCE(${pedidos.previsaoEntrega}, CURRENT_DATE) <= ${dtFim}`)

  const [pedItensRows, allProds, arvores, saldosRes, opsSaidaRes, especRows] = await Promise.all([
    dbOrTx
      .select({
        pedido_id: pedidos.id,
        pedido_codigo: pedidos.codigo,
        cliente_id: pedidos.clienteId,
        cliente_nome: pedidos.cliente,
        produto_id: pedidosItens.produtoId,
        qtd_kg: pedidosItens.qtdKgSolicitada,
        observacao: pedidosItens.observacao,
        alerta_reclamacao: pedidosItens.alertaReclamacao,
      })
      .from(pedidosItens)
      .innerJoin(pedidos, eq(pedidos.id, pedidosItens.pedidoId))
      .where(and(...pedConds)),
    dbOrTx
      .select({
        id: produtos.id,
        codigo: produtos.codigo,
        descricao: produtos.descricao,
        grupo: produtos.grupo,
        tipo_produto: produtos.tipoProduto,
        classificacao: produtos.classificacao,
        produto_pai_id: produtos.produtoPaiId,
      })
      .from(produtos)
      .where(and(eq(produtos.tenantId, params.tenantId), eq(produtos.ativo, 1))),
    dbOrTx
      .select()
      .from(produtoArvore)
      .where(eq(produtoArvore.tenantId, params.tenantId)),
    dbOrTx
      .select({
        produtoId: estoqueCaixas.produtoId,
        pesoKg: sql<string>`COALESCE(SUM(${estoqueCaixas.pesoKg}), 0)`,
      })
      .from(estoqueCaixas)
      .where(
        and(
          eq(estoqueCaixas.tenantId, params.tenantId),
          eq(estoqueCaixas.filialId, params.filialId),
          eq(estoqueCaixas.status, 'DISPONIVEL'),
          sql`COALESCE(${estoqueCaixas.endereco}, '') NOT IN ('REC', 'EXPEDICAO', 'SAIDA', 'PERDIDO', 'PRODUCAO')`,
        ),
      )
      .groupBy(estoqueCaixas.produtoId),
    dbOrTx
      .select({
        produtoId: opItensPrevistos.produtoId,
        pesoKg: sql<string>`COALESCE(SUM(${opItensPrevistos.pesoKgPrevisto}), 0)`,
      })
      .from(opItensPrevistos)
      .innerJoin(ordensProducao, eq(ordensProducao.id, opItensPrevistos.opId))
      .where(
        and(
          eq(ordensProducao.tenantId, params.tenantId),
          eq(ordensProducao.filialId, params.filialId),
          eq(opItensPrevistos.tipo, 'SAIDA'),
          inArray(ordensProducao.status, ['ABERTA', 'LIBERADA']),
        ),
      )
      .groupBy(opItensPrevistos.produtoId),
    dbOrTx
      .select({
        clienteId: clienteProdutoEspec.clienteId,
        produtoId: clienteProdutoEspec.produtoId,
        especificacaoCorte: clienteProdutoEspec.especificacaoCorte,
        alertaReclamacao: clienteProdutoEspec.alertaReclamacao,
        alertaDescricao: clienteProdutoEspec.alertaDescricao,
      })
      .from(clienteProdutoEspec)
      .where(eq(clienteProdutoEspec.tenantId, params.tenantId)),
  ])

  const prodMap = new Map(allProds.map((p) => [p.id, p]))
  const saldoMap = new Map(saldosRes.map((s) => [s.produtoId, toNum(s.pesoKg, 0)]))
  const emOpMap = new Map(opsSaidaRes.map((o) => [o.produtoId, toNum(o.pesoKg, 0)]))
  const especMap = new Map<string, (typeof especRows)[number]>()
  for (const e of especRows) {
    especMap.set(`${e.clienteId}::${e.produtoId}`, e)
  }

  // Mapa filho -> vínculo prioritário com MP pai
  const arvorePorFilho = new Map<
    string,
    { paiId: string; rendimentoPct: number }
  >()
  for (const a of arvores) {
    const atual = arvorePorFilho.get(a.filhoId)
    const rendRaw = toNum(a.rendimentoAprendidoPct ?? a.rendimentoEsperadoPct, 100)
    const rend = rendRaw > 5 && rendRaw <= 100 ? rendRaw : 100
    // Prioriza vínculo confirmado ou manual antes de OP_AUTO não confirmado
    if (!atual || a.confirmado === 1) {
      arvorePorFilho.set(a.filhoId, { paiId: a.paiId, rendimentoPct: rend })
    }
  }
  for (const p of allProds) {
    if (p.produto_pai_id && !arvorePorFilho.has(p.id)) {
      arvorePorFilho.set(p.id, { paiId: p.produto_pai_id, rendimentoPct: 100 })
    }
  }

  const porProduto = new Map<
    string,
    {
      qtd_pedida_kg: number
      especs: Set<string>
      clientes: DemandaCorteLinha['clientes']
    }
  >()

  const grupoFiltro = params.grupo ? String(params.grupo).trim().toUpperCase() : ''

  for (const row of pedItensRows) {
    const prod = prodMap.get(row.produto_id)
    if (!prod) continue
    if (grupoFiltro && String(prod.grupo || '').trim().toUpperCase() !== grupoFiltro) continue

    const kg = toNum(row.qtd_kg, 0)
    if (kg <= 0) continue

    const cur = porProduto.get(prod.id) || {
      qtd_pedida_kg: 0,
      especs: new Set<string>(),
      clientes: [],
    }
    cur.qtd_pedida_kg = Number((cur.qtd_pedida_kg + kg).toFixed(3))

    const especCli = row.cliente_id ? especMap.get(`${row.cliente_id}::${prod.id}`) : undefined
    const alertaSpec =
      especCli && especCli.alertaReclamacao === 1 && especCli.alertaDescricao
        ? `⚠️ ${especCli.alertaDescricao}`
        : ''
    const textoEspec = [
      especCli?.especificacaoCorte,
      alertaSpec,
      row.observacao,
      row.alerta_reclamacao ? `⚠️ ${row.alerta_reclamacao}` : '',
    ]
      .filter(Boolean)
      .join(' • ')

    if (textoEspec) cur.especs.add(textoEspec)
    cur.clientes.push({
      cliente_id: row.cliente_id,
      cliente_nome: row.cliente_nome || 'Cliente',
      pedido_codigo: row.pedido_codigo,
      qtd_kg: kg,
      especificacao: textoEspec,
    })
    porProduto.set(prod.id, cur)
  }

  const cortes: DemandaCorteLinha[] = []
  const mpPorProdutoId = new Map<string, number>()

  for (const [produtoId, agg] of porProduto.entries()) {
    const prod = prodMap.get(produtoId)
    if (!prod) continue

    const saldoDisp = Number((saldoMap.get(produtoId) || 0).toFixed(3))
    const saldoOp = Number((emOpMap.get(produtoId) || 0).toFixed(3))
    const deficit = Number(Math.max(0, agg.qtd_pedida_kg - saldoDisp - saldoOp).toFixed(3))

    const vinc = arvorePorFilho.get(produtoId)
    const pai = vinc ? prodMap.get(vinc.paiId) : undefined
    const isPropriaMp = prod.classificacao === 'MATERIA_PRIMA' || prod.tipo_produto === 'Materia Prima'
    const rend = vinc ? vinc.rendimentoPct : 100

    let mpId: string | null = pai?.id || (isPropriaMp ? prod.id : null)
    let mpNecKg = 0
    if (deficit > 0 && mpId) {
      mpNecKg = Number((deficit / (rend / 100)).toFixed(3))
      mpPorProdutoId.set(mpId, Number(((mpPorProdutoId.get(mpId) || 0) + mpNecKg).toFixed(3)))
    }

    const especUnica = Array.from(agg.especs).join(' | ')
    const ehCongelado = /CONGELAD/i.test(`${prod.descricao} ${especUnica}`)

    cortes.push({
      produto_id: prod.id,
      produto_codigo: prod.codigo,
      produto_descricao: prod.descricao,
      grupo: prod.grupo || '',
      classificacao: prod.classificacao,
      materia_prima_id: mpId,
      materia_prima_codigo: pai?.codigo || (isPropriaMp ? prod.codigo : null),
      materia_prima_descricao: pai?.descricao || (isPropriaMp ? prod.descricao : null),
      rendimento_usado_pct: rend,
      qtd_pedida_kg: agg.qtd_pedida_kg,
      saldo_disponivel_kg: saldoDisp,
      saldo_em_op_kg: saldoOp,
      deficit_produzir_kg: deficit,
      qtd_mp_necessaria_kg: mpNecKg,
      especificacao: especUnica,
      conservacao: ehCongelado ? 'CONGELADO' : 'RESFRIADO',
      clientes: agg.clientes,
    })
  }

  cortes.sort((a, b) => b.deficit_produzir_kg - a.deficit_produzir_kg || a.produto_descricao.localeCompare(b.produto_descricao))

  return {
    cortes,
    mpPorProdutoId,
    totalDeficitCortesKg: Number(cortes.reduce((s, c) => s + c.deficit_produzir_kg, 0).toFixed(3)),
    totalMpNecessariaKg: Number(
      Array.from(mpPorProdutoId.values())
        .reduce((s, v) => s + v, 0)
        .toFixed(3),
    ),
  }
}
