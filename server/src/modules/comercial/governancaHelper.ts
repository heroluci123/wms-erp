import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import {
  clienteProdutoEspec,
  clientes,
  financeiroTitulos,
  pendenciasSetor,
  produtos,
  tabelasPreco,
  tabelasPrecoItens,
  vendedores,
} from '../../db/schema/index.js'
import { uuidv7 } from '../../utils/uuid.js'
import { hojeIsoLocal, lerTenantFeatures, toDec, toNum, type DbOrTx } from '../wms/helpers.js'

export interface ConfigComercial {
  trava_margem_ativa: boolean
  trava_credito_ativa: boolean
  margem_minima_padrao_pct: number
  desconto_max_vendedor_pct: number
  dias_tolerancia_inadimplencia: number
  bloquear_venda_abaixo_custo: boolean
}

export interface SaudeFinanceiraCliente {
  cliente_id: string
  bloqueado_financeiro: boolean
  limite_credito: number
  credito_utilizado: number
  credito_disponivel: number
  valor_vencido: number
  qtd_titulos_abertos: number
  qtd_titulos_vencidos: number
  maior_atraso_dias: number
  desconto_ativo: boolean
  desconto_max_pct: number
  tabela_preco_id: string | null
  semaforo: 'VERDE' | 'AMARELO' | 'VERMELHO'
}

export interface PrecoResolvidoProduto {
  produto_id: string
  preco_sugerido: number
  origem_preco: 'CONTRATO_CLIENTE' | 'TABELA_CLIENTE' | 'TABELA_ATACADO' | 'ULTIMA_VENDA' | 'CADASTRO_BASE'
  tabela_preco_nome: string
  custo_unitario: number
  margem_sugerida_pct: number | null
  codigo_aux_cliente: string
  especificacao_corte: string
  alerta_reclamacao: boolean
  alerta_descricao: string
  ultima_venda_preco: number | null
  preco_negociado: number | null
}

export interface ItemAvaliacaoInput {
  produto_id: string
  qtd_kg_solicitada: number
  preco_unitario: number
  desconto_pct: number
  desconto_valor: number
}

export interface ItemAlertaComercial {
  produto_id: string
  produto_codigo: string
  produto_descricao: string
  qtd_kg: number
  custo_unitario: number
  preco_unitario: number
  preco_liquido_unit: number
  preco_tabela_ref: number | null
  desconto_efetivo_pct: number
  margem_pct: number | null
  abaixo_custo: boolean
  abaixo_margem_minima: boolean
  desconto_excedido: boolean
}

export interface ResultadoGovernancaComercial {
  config: ConfigComercial
  tabela_preco_usada_id: string | null
  receita_total: number
  custo_total_estimado: number
  margem_bruta_pct: number | null
  margem_minima_aplicada_pct: number
  desconto_max_aplicado_pct: number
  saude_cliente: SaudeFinanceiraCliente | null
  itens_calculados: Map<
    string,
    {
      custo_unitario_ref: number
      margem_item_pct: number | null
      preco_tabela_ref: number | null
    }
  >
  alerta: {
    bloqueado_margem: boolean
    bloqueado_abaixo_custo: boolean
    bloqueado_desconto: boolean
    bloqueado_credito: boolean
    bloqueado_inadimplencia: boolean
    exige_aprovacao: boolean
    motivos: string[]
    itens_alerta: ItemAlertaComercial[]
    credito_info: {
      limite_credito: number
      credito_utilizado: number
      valor_pedido: number
      novo_total: number
      valor_vencido: number
      qtd_titulos_vencidos: number
      maior_atraso_dias: number
      bloqueado_financeiro: boolean
    } | null
  }
}

export async function lerConfigComercial(dbOrTx: DbOrTx, tenantId: string): Promise<ConfigComercial> {
  const raw = await lerTenantFeatures(dbOrTx, tenantId)
  const margemMin =
    raw.margem_minima_padrao_pct != null && Number.isFinite(Number(raw.margem_minima_padrao_pct))
      ? Math.max(0, Math.min(90, Number(raw.margem_minima_padrao_pct)))
      : 12
  const descMax =
    raw.desconto_max_vendedor_pct != null && Number.isFinite(Number(raw.desconto_max_vendedor_pct))
      ? Math.max(0, Math.min(100, Number(raw.desconto_max_vendedor_pct)))
      : 5
  const diasTol =
    raw.dias_tolerancia_inadimplencia != null && Number.isFinite(Number(raw.dias_tolerancia_inadimplencia))
      ? Math.max(0, Math.min(180, Math.round(Number(raw.dias_tolerancia_inadimplencia))))
      : 3

  return {
    trava_margem_ativa: Boolean(raw.trava_margem_ativa),
    trava_credito_ativa: Boolean(raw.trava_credito_ativa),
    margem_minima_padrao_pct: margemMin,
    desconto_max_vendedor_pct: descMax,
    dias_tolerancia_inadimplencia: diasTol,
    bloquear_venda_abaixo_custo: raw.bloquear_venda_abaixo_custo !== false,
  }
}

function subtrairDiasIso(baseIso: string, dias: number): string {
  const ms = new Date(`${baseIso}T12:00:00Z`).getTime()
  return new Date(ms - Math.max(0, dias) * 86_400_000).toISOString().slice(0, 10)
}

export async function obterSaudeFinanceiraCliente(
  dbOrTx: DbOrTx,
  params: { tenantId: string; clienteId: string; diasTolerancia?: number; ignorePedidoId?: string | null },
): Promise<SaudeFinanceiraCliente | null> {
  const [cli] = await dbOrTx
    .select({
      id: clientes.id,
      limiteCredito: clientes.limiteCredito,
      bloqueadoFinanceiro: clientes.bloqueadoFinanceiro,
      descontoAtivo: clientes.descontoAtivo,
      descontoMaxPct: clientes.descontoMaxPct,
      tabelaPrecoId: clientes.tabelaPrecoId,
    })
    .from(clientes)
    .where(and(eq(clientes.id, params.clienteId), eq(clientes.tenantId, params.tenantId)))
    .limit(1)

  if (!cli) return null

  const hoje = hojeIsoLocal()
  const corteVenc = subtrairDiasIso(hoje, params.diasTolerancia ?? 3)

  const titRows = await dbOrTx
    .select({
      pedidoVendaId: financeiroTitulos.pedidoVendaId,
      saldoAberto: financeiroTitulos.saldoAberto,
      dataVencimento: financeiroTitulos.dataVencimento,
    })
    .from(financeiroTitulos)
    .where(
      and(
        eq(financeiroTitulos.tenantId, params.tenantId),
        eq(financeiroTitulos.clienteId, params.clienteId),
        eq(financeiroTitulos.tipo, 'RECEBER'),
        inArray(financeiroTitulos.status, ['ABERTO', 'PARCIAL']),
      ),
    )

  let creditoUtilizado = 0
  let valorVencido = 0
  let qtdAbertos = 0
  let qtdVencidos = 0
  let maiorAtrasoDias = 0
  const hojeMs = new Date(`${hoje}T12:00:00Z`).getTime()

  for (const t of titRows) {
    if (params.ignorePedidoId && t.pedidoVendaId === params.ignorePedidoId) continue
    const saldo = toNum(t.saldoAberto, 0)
    if (saldo <= 0) continue
    creditoUtilizado += saldo
    qtdAbertos += 1
    const vencIso = String(t.dataVencimento || '').slice(0, 10)
    if (vencIso && vencIso < corteVenc) {
      valorVencido += saldo
      qtdVencidos += 1
      const vencMs = new Date(`${vencIso}T12:00:00Z`).getTime()
      const atraso = Math.max(0, Math.floor((hojeMs - vencMs) / 86_400_000))
      if (atraso > maiorAtrasoDias) maiorAtrasoDias = atraso
    }
  }

  const limite = toNum(cli.limiteCredito, 0)
  const bloqueado = Number(cli.bloqueadoFinanceiro || 0) === 1
  const disponivel = limite > 0 ? Math.max(0, Number((limite - creditoUtilizado).toFixed(2))) : 0

  let semaforo: 'VERDE' | 'AMARELO' | 'VERMELHO' = 'VERDE'
  if (bloqueado || qtdVencidos > 0 || (limite > 0 && creditoUtilizado > limite)) {
    semaforo = 'VERMELHO'
  } else if (limite > 0 && creditoUtilizado >= limite * 0.8) {
    semaforo = 'AMARELO'
  }

  return {
    cliente_id: cli.id,
    bloqueado_financeiro: bloqueado,
    limite_credito: Number(limite.toFixed(2)),
    credito_utilizado: Number(creditoUtilizado.toFixed(2)),
    credito_disponivel: disponivel,
    valor_vencido: Number(valorVencido.toFixed(2)),
    qtd_titulos_abertos: qtdAbertos,
    qtd_titulos_vencidos: qtdVencidos,
    maior_atraso_dias: maiorAtrasoDias,
    desconto_ativo: Number(cli.descontoAtivo || 0) === 1,
    desconto_max_pct: toNum(cli.descontoMaxPct, 0),
    tabela_preco_id: cli.tabelaPrecoId || null,
    semaforo,
  }
}

export async function resolverPrecosClienteProdutos(
  dbOrTx: DbOrTx,
  params: {
    tenantId: string
    clienteId?: string | null
    tabelaPrecoId?: string | null
    produtoIds: string[]
  },
): Promise<{
  tabelaUsadaId: string | null
  tabelaUsadaNome: string
  precos: Map<string, PrecoResolvidoProduto>
}> {
  const uniqueIds = Array.from(new Set(params.produtoIds.filter(Boolean)))
  const precos = new Map<string, PrecoResolvidoProduto>()
  if (uniqueIds.length === 0) {
    return { tabelaUsadaId: null, tabelaUsadaNome: '', precos }
  }

  const hoje = hojeIsoLocal()

  let clienteTabelaId: string | null = params.tabelaPrecoId || null
  if (!clienteTabelaId && params.clienteId) {
    const [cli] = await dbOrTx
      .select({ tabelaPrecoId: clientes.tabelaPrecoId })
      .from(clientes)
      .where(and(eq(clientes.id, params.clienteId), eq(clientes.tenantId, params.tenantId)))
      .limit(1)
    if (cli?.tabelaPrecoId) clienteTabelaId = cli.tabelaPrecoId
  }

  // Busca tabelas candidatas: específica do cliente/pedido + tabela padrão ATACADO
  const tabsAtivas = await dbOrTx
    .select()
    .from(tabelasPreco)
    .where(and(eq(tabelasPreco.tenantId, params.tenantId), eq(tabelasPreco.ativo, 1)))
    .orderBy(desc(tabelasPreco.padrao), desc(tabelasPreco.updatedAt))

  const tabValida = (t: (typeof tabsAtivas)[number]) => {
    const ini = t.dataInicio ? String(t.dataInicio).slice(0, 10) : null
    const fim = t.dataFim ? String(t.dataFim).slice(0, 10) : null
    if (ini && ini > hoje) return false
    if (fim && fim < hoje) return false
    return true
  }

  const tabCliente = clienteTabelaId ? tabsAtivas.find((t) => t.id === clienteTabelaId && tabValida(t)) || null : null
  const tabAtacado =
    tabsAtivas.find((t) => t.finalidade === 'ATACADO' && Number(t.padrao) === 1 && tabValida(t)) ||
    tabsAtivas.find((t) => t.finalidade === 'ATACADO' && tabValida(t)) ||
    null

  const tabIdsConsultar = Array.from(new Set([tabCliente?.id, tabAtacado?.id].filter(Boolean) as string[]))

  const [prodRows, especRows, tabItensRows] = await Promise.all([
    dbOrTx
      .select({
        id: produtos.id,
        valorUnitario: produtos.valorUnitario,
        custoMedioKg: produtos.custoMedioKg,
        ultimoPrecoCompra: produtos.ultimoPrecoCompra,
      })
      .from(produtos)
      .where(and(eq(produtos.tenantId, params.tenantId), inArray(produtos.id, uniqueIds))),
    params.clienteId
      ? dbOrTx
          .select()
          .from(clienteProdutoEspec)
          .where(
            and(
              eq(clienteProdutoEspec.tenantId, params.tenantId),
              eq(clienteProdutoEspec.clienteId, params.clienteId),
              inArray(clienteProdutoEspec.produtoId, uniqueIds),
            ),
          )
      : Promise.resolve([]),
    tabIdsConsultar.length > 0
      ? dbOrTx
          .select()
          .from(tabelasPrecoItens)
          .where(
            and(
              eq(tabelasPrecoItens.tenantId, params.tenantId),
              inArray(tabelasPrecoItens.tabelaPrecoId, tabIdsConsultar),
              inArray(tabelasPrecoItens.produtoId, uniqueIds),
            ),
          )
      : Promise.resolve([]),
  ])

  const especMap = new Map(especRows.map((e) => [e.produtoId, e]))
  const tabCliMap = new Map<string, (typeof tabItensRows)[number]>()
  const tabAtacMap = new Map<string, (typeof tabItensRows)[number]>()
  for (const ti of tabItensRows) {
    if (tabCliente && ti.tabelaPrecoId === tabCliente.id) tabCliMap.set(ti.produtoId, ti)
    if (tabAtacado && ti.tabelaPrecoId === tabAtacado.id) tabAtacMap.set(ti.produtoId, ti)
  }

  for (const p of prodRows) {
    const espec = especMap.get(p.id)
    const tiCli = tabCliMap.get(p.id)
    const tiAtac = tabAtacMap.get(p.id)

    const custo = toNum(p.custoMedioKg, 0) || toNum(p.ultimoPrecoCompra, 0)
    const precoNeg = espec?.precoNegociado != null ? toNum(espec.precoNegociado, 0) : 0
    const ultVenda = espec?.ultimaVendaPreco != null ? toNum(espec.ultimaVendaPreco, 0) : 0
    const precoTabCli = tiCli
      ? toNum(tiCli.precoPromocional, 0) > 0
        ? toNum(tiCli.precoPromocional, 0)
        : toNum(tiCli.precoVenda, 0)
      : 0
    const precoTabAtac = tiAtac
      ? toNum(tiAtac.precoPromocional, 0) > 0
        ? toNum(tiAtac.precoPromocional, 0)
        : toNum(tiAtac.precoVenda, 0)
      : 0
    const precoBase = toNum(p.valorUnitario, 0)

    let precoSugerido = precoBase
    let origem: PrecoResolvidoProduto['origem_preco'] = 'CADASTRO_BASE'
    let tabelaNome = ''

    if (precoNeg > 0) {
      precoSugerido = precoNeg
      origem = 'CONTRATO_CLIENTE'
    } else if (precoTabCli > 0 && tabCliente) {
      precoSugerido = precoTabCli
      origem = 'TABELA_CLIENTE'
      tabelaNome = tabCliente.nome
    } else if (precoTabAtac > 0 && tabAtacado) {
      precoSugerido = precoTabAtac
      origem = 'TABELA_ATACADO'
      tabelaNome = tabAtacado.nome
    } else if (ultVenda > 0) {
      precoSugerido = ultVenda
      origem = 'ULTIMA_VENDA'
    }

    const margemSug =
      precoSugerido > 0 && custo > 0 ? Number((((precoSugerido - custo) / precoSugerido) * 100).toFixed(2)) : null

    precos.set(p.id, {
      produto_id: p.id,
      preco_sugerido: Number(precoSugerido.toFixed(4)),
      origem_preco: origem,
      tabela_preco_nome: tabelaNome,
      custo_unitario: Number(custo.toFixed(4)),
      margem_sugerida_pct: margemSug,
      codigo_aux_cliente: espec?.codigoAuxCliente || '',
      especificacao_corte: espec?.especificacaoCorte || '',
      alerta_reclamacao: Number(espec?.alertaReclamacao || 0) === 1,
      alerta_descricao: espec?.alertaDescricao || '',
      ultima_venda_preco: ultVenda > 0 ? ultVenda : null,
      preco_negociado: precoNeg > 0 ? precoNeg : null,
    })
  }

  return {
    tabelaUsadaId: tabCliente?.id || tabAtacado?.id || null,
    tabelaUsadaNome: tabCliente?.nome || tabAtacado?.nome || '',
    precos,
  }
}

export async function avaliarGovernancaComercialPedido(
  tx: DbOrTx,
  params: {
    tenantId: string
    clienteId?: string | null
    vendedorId?: string | null
    tabelaPrecoId?: string | null
    pagamentoNaEntrega?: boolean
    itens: ItemAvaliacaoInput[]
    forcarAvaliacaoEstrita?: boolean
    ignorePedidoId?: string | null
  },
): Promise<ResultadoGovernancaComercial> {
  const config = await lerConfigComercial(tx, params.tenantId)
  const prodIds = Array.from(new Set(params.itens.map((i) => i.produto_id)))

  const [prodRows, vendRows, saudeCliente, precosRes] = await Promise.all([
    prodIds.length > 0
      ? tx
          .select({
            id: produtos.id,
            codigo: produtos.codigo,
            descricao: produtos.descricao,
            custoMedioKg: produtos.custoMedioKg,
            ultimoPrecoCompra: produtos.ultimoPrecoCompra,
          })
          .from(produtos)
          .where(and(eq(produtos.tenantId, params.tenantId), inArray(produtos.id, prodIds)))
      : Promise.resolve([]),
    params.vendedorId
      ? tx
          .select({
            id: vendedores.id,
            descontoMaxPct: vendedores.descontoMaxPct,
            margemMinimaPct: vendedores.margemMinimaPct,
          })
          .from(vendedores)
          .where(and(eq(vendedores.id, params.vendedorId), eq(vendedores.tenantId, params.tenantId)))
          .limit(1)
      : Promise.resolve([]),
    params.clienteId
      ? obterSaudeFinanceiraCliente(tx, {
          tenantId: params.tenantId,
          clienteId: params.clienteId,
          diasTolerancia: config.dias_tolerancia_inadimplencia,
          ignorePedidoId: params.ignorePedidoId,
        })
      : Promise.resolve(null),
    resolverPrecosClienteProdutos(tx, {
      tenantId: params.tenantId,
      clienteId: params.clienteId,
      tabelaPrecoId: params.tabelaPrecoId,
      produtoIds: prodIds,
    }),
  ])

  const prodMap = new Map(prodRows.map((p) => [p.id, p]))
  const vend = vendRows[0] || null

  const margemMinimaAplicada =
    vend?.margemMinimaPct != null && Number.isFinite(Number(vend.margemMinimaPct))
      ? Math.max(0, toNum(vend.margemMinimaPct, config.margem_minima_padrao_pct))
      : config.margem_minima_padrao_pct

  // Teto de desconto: usa o maior entre teto do vendedor (ou padrão) e teto negociado do cliente se ativo
  const tetoVendedor = vend ? toNum(vend.descontoMaxPct, config.desconto_max_vendedor_pct) : config.desconto_max_vendedor_pct
  const tetoCliente = saudeCliente?.desconto_ativo ? saudeCliente.desconto_max_pct : 0
  const descontoMaxAplicado = Math.max(tetoVendedor, tetoCliente)

  let receitaTotal = 0
  let custoTotal = 0
  let receitaComCusto = 0

  let bloqueadoMargem = false
  let bloqueadoAbaixoCusto = false
  let bloqueadoDesconto = false
  const itensAlerta: ItemAlertaComercial[] = []
  const itensCalculados = new Map<
    string,
    { custo_unitario_ref: number; margem_item_pct: number | null; preco_tabela_ref: number | null }
  >()

  for (const it of params.itens) {
    const p = prodMap.get(it.produto_id)
    const pRef = precosRes.precos.get(it.produto_id)
    const kg = Math.max(0, toNum(it.qtd_kg_solicitada, 0))
    const precoUnit = Math.max(0, toNum(it.preco_unitario, 0))
    const descPct = Math.max(0, Math.min(100, toNum(it.desconto_pct, 0)))
    const descVal = Math.max(0, toNum(it.desconto_valor, 0))

    const bruto = kg * precoUnit
    const liquido = Math.max(0, bruto * (1 - descPct / 100) - descVal)
    const precoLiqUnit = kg > 0 ? liquido / kg : 0
    const custoUnit = p ? toNum(p.custoMedioKg, 0) || toNum(p.ultimoPrecoCompra, 0) : 0
    const precoTabela = pRef && pRef.preco_sugerido > 0 ? pRef.preco_sugerido : null

    // Desconto efetivo considera desconto explícito + eventual redução manual abaixo do preço de tabela
    let descEfetivoPct = bruto > 0 ? ((bruto - liquido) / bruto) * 100 : descPct
    if (precoTabela && precoTabela > 0 && precoLiqUnit > 0 && precoLiqUnit < precoTabela) {
      const descSobreTabela = ((precoTabela - precoLiqUnit) / precoTabela) * 100
      if (descSobreTabela > descEfetivoPct) descEfetivoPct = descSobreTabela
    }
    descEfetivoPct = Number(Math.max(0, descEfetivoPct).toFixed(2))

    const margemItemPct =
      precoLiqUnit > 0 && custoUnit > 0 ? Number((((precoLiqUnit - custoUnit) / precoLiqUnit) * 100).toFixed(2)) : null

    receitaTotal += liquido
    if (custoUnit > 0) {
      custoTotal += kg * custoUnit
      receitaComCusto += liquido
    }

    itensCalculados.set(it.produto_id, {
      custo_unitario_ref: Number(custoUnit.toFixed(4)),
      margem_item_pct: margemItemPct,
      preco_tabela_ref: precoTabela != null ? Number(precoTabela.toFixed(4)) : null,
    })

    const abaixoCusto = custoUnit > 0 && precoLiqUnit > 0 && precoLiqUnit < custoUnit - 0.0001
    const abaixoMargemMin = margemItemPct !== null && margemItemPct < margemMinimaAplicada - 0.01
    const descontoExcedido = descEfetivoPct > descontoMaxAplicado + 0.01

    if (abaixoCusto || abaixoMargemMin || descontoExcedido) {
      if (abaixoCusto) bloqueadoAbaixoCusto = true
      if (abaixoMargemMin) bloqueadoMargem = true
      if (descontoExcedido) bloqueadoDesconto = true

      itensAlerta.push({
        produto_id: it.produto_id,
        produto_codigo: p?.codigo || '',
        produto_descricao: p?.descricao || 'Produto',
        qtd_kg: Number(kg.toFixed(3)),
        custo_unitario: Number(custoUnit.toFixed(4)),
        preco_unitario: Number(precoUnit.toFixed(4)),
        preco_liquido_unit: Number(precoLiqUnit.toFixed(4)),
        preco_tabela_ref: precoTabela,
        desconto_efetivo_pct: descEfetivoPct,
        margem_pct: margemItemPct,
        abaixo_custo: abaixoCusto,
        abaixo_margem_minima: abaixoMargemMin,
        desconto_excedido: descontoExcedido,
      })
    }
  }

  receitaTotal = Number(receitaTotal.toFixed(2))
  custoTotal = Number(custoTotal.toFixed(2))
  const margemBrutaPct =
    receitaComCusto > 0 && custoTotal > 0
      ? Number((((receitaComCusto - custoTotal) / receitaComCusto) * 100).toFixed(2))
      : null

  // Análise de Crédito e Inadimplência
  let bloqueadoCredito = false
  let bloqueadoInadimplencia = false
  const motivos: string[] = []

  const aplicarTravaMargem = config.trava_margem_ativa || params.forcarAvaliacaoEstrita === true
  const aplicarTravaCredito = config.trava_credito_ativa || params.forcarAvaliacaoEstrita === true

  if (aplicarTravaMargem) {
    if (bloqueadoAbaixoCusto && config.bloquear_venda_abaixo_custo) {
      const qtd = itensAlerta.filter((i) => i.abaixo_custo).length
      motivos.push(`${qtd} item(ns) com preço líquido ABAIXO DO CUSTO`)
    }
    if (bloqueadoMargem) {
      const qtd = itensAlerta.filter((i) => i.abaixo_margem_minima).length
      motivos.push(`${qtd} item(ns) abaixo da margem mínima de ${margemMinimaAplicada.toFixed(1)}%`)
    }
    if (bloqueadoDesconto) {
      const maxEncontrado = Math.max(...itensAlerta.map((i) => i.desconto_efetivo_pct))
      motivos.push(`Desconto de ${maxEncontrado.toFixed(1)}% excede o limite de ${descontoMaxAplicado.toFixed(1)}%`)
    }
  }

  let creditoInfo: ResultadoGovernancaComercial['alerta']['credito_info'] = null
  if (saudeCliente) {
    const novoTotal = Number((saudeCliente.credito_utilizado + receitaTotal).toFixed(2))
    creditoInfo = {
      limite_credito: saudeCliente.limite_credito,
      credito_utilizado: saudeCliente.credito_utilizado,
      valor_pedido: receitaTotal,
      novo_total: novoTotal,
      valor_vencido: saudeCliente.valor_vencido,
      qtd_titulos_vencidos: saudeCliente.qtd_titulos_vencidos,
      maior_atraso_dias: saudeCliente.maior_atraso_dias,
      bloqueado_financeiro: saudeCliente.bloqueado_financeiro,
    }

    if (aplicarTravaCredito) {
      if (saudeCliente.bloqueado_financeiro) {
        bloqueadoInadimplencia = true
        motivos.push('Cliente com bloqueio financeiro ativo')
      }
      if (saudeCliente.qtd_titulos_vencidos > 0 && !params.pagamentoNaEntrega) {
        bloqueadoInadimplencia = true
        motivos.push(
          `Cliente inadimplente: ${saudeCliente.qtd_titulos_vencidos} título(s) vencido(s) (R$ ${saudeCliente.valor_vencido.toFixed(2)}, atraso máx. ${saudeCliente.maior_atraso_dias}d)`,
        )
      }
      if (saudeCliente.limite_credito > 0 && !params.pagamentoNaEntrega && novoTotal > saudeCliente.limite_credito + 0.01) {
        bloqueadoCredito = true
        motivos.push(
          `Limite de crédito excedido (Utilizado + Pedido R$ ${novoTotal.toFixed(2)} > Limite R$ ${saudeCliente.limite_credito.toFixed(2)})`,
        )
      }
    }
  }

  const exigeAprovacao = motivos.length > 0

  return {
    config,
    tabela_preco_usada_id: params.tabelaPrecoId || precosRes.tabelaUsadaId,
    receita_total: receitaTotal,
    custo_total_estimado: custoTotal,
    margem_bruta_pct: margemBrutaPct,
    margem_minima_aplicada_pct: margemMinimaAplicada,
    desconto_max_aplicado_pct: descontoMaxAplicado,
    saude_cliente: saudeCliente,
    itens_calculados: itensCalculados,
    alerta: {
      bloqueado_margem: aplicarTravaMargem && bloqueadoMargem,
      bloqueado_abaixo_custo: aplicarTravaMargem && bloqueadoAbaixoCusto && config.bloquear_venda_abaixo_custo,
      bloqueado_desconto: aplicarTravaMargem && bloqueadoDesconto,
      bloqueado_credito: bloqueadoCredito,
      bloqueado_inadimplencia: bloqueadoInadimplencia,
      exige_aprovacao: exigeAprovacao,
      motivos,
      itens_alerta: itensAlerta,
      credito_info: creditoInfo,
    },
  }
}

export async function registrarPendenciaTravaComercial(
  tx: DbOrTx,
  params: {
    tenantId: string
    filialId: string
    pedidoId: string
    codigoPedido: string
    clienteNome: string
    alerta: ResultadoGovernancaComercial['alerta']
  },
): Promise<void> {
  if (!params.alerta.exige_aprovacao) return

  const setorDestino =
    params.alerta.bloqueado_credito || params.alerta.bloqueado_inadimplencia ? 'FINANCEIRO' : 'FATURAMENTO'
  const resumo = params.alerta.motivos.join(' | ').slice(0, 260)
  const titulo = `${params.codigoPedido} — ${params.clienteNome}: ${resumo}. Aguardando aprovação comercial/gerencial.`

  const [existente] = await tx
    .select({ id: pendenciasSetor.id })
    .from(pendenciasSetor)
    .where(
      and(
        eq(pendenciasSetor.tenantId, params.tenantId),
        eq(pendenciasSetor.referenciaId, params.pedidoId),
        eq(pendenciasSetor.tipoPendencia, 'TRAVA_COMERCIAL_PEDIDO'),
        sql`${pendenciasSetor.status} != 'CONCLUIDA'`,
      ),
    )
    .limit(1)

  if (existente) {
    await tx
      .update(pendenciasSetor)
      .set({ setorDestino, titulo, prioridade: 4 })
      .where(eq(pendenciasSetor.id, existente.id))
  } else {
    await tx.insert(pendenciasSetor).values({
      id: uuidv7(),
      tenantId: params.tenantId,
      filialId: params.filialId,
      setorDestino,
      tipoPendencia: 'TRAVA_COMERCIAL_PEDIDO',
      referenciaTabela: 'pedidos',
      referenciaId: params.pedidoId,
      titulo,
      prioridade: 4,
      status: 'PENDENTE',
    })
  }
}

export async function atualizarUltimaVendaClienteProdutos(
  tx: DbOrTx,
  params: {
    tenantId: string
    clienteId?: string | null
    itens: Array<{ produto_id: string; preco_unitario: number }>
  },
): Promise<void> {
  if (!params.clienteId) return
  const validos = params.itens.filter((i) => toNum(i.preco_unitario, 0) > 0)
  if (validos.length === 0) return

  const existingRows = await tx
    .select({ id: clienteProdutoEspec.id, produtoId: clienteProdutoEspec.produtoId })
    .from(clienteProdutoEspec)
    .where(
      and(
        eq(clienteProdutoEspec.tenantId, params.tenantId),
        eq(clienteProdutoEspec.clienteId, params.clienteId),
        inArray(
          clienteProdutoEspec.produtoId,
          validos.map((v) => v.produto_id),
        ),
      ),
    )
  const exMap = new Map(existingRows.map((e) => [e.produtoId, e.id]))

  for (const it of validos) {
    const precoStr = toDec(it.preco_unitario, 4)
    const exId = exMap.get(it.produto_id)
    if (exId) {
      await tx
        .update(clienteProdutoEspec)
        .set({ ultimaVendaPreco: precoStr, updatedAt: new Date() })
        .where(eq(clienteProdutoEspec.id, exId))
    } else {
      await tx.insert(clienteProdutoEspec).values({
        id: uuidv7(),
        tenantId: params.tenantId,
        clienteId: params.clienteId,
        produtoId: it.produto_id,
        ultimaVendaPreco: precoStr,
      })
    }
  }
}
