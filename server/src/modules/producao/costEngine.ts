import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import {
  estoqueCaixas,
  fornecedores,
  opInsumos,
  opRetornos,
  ordensProducao,
  pedidosItens,
  produtos,
} from '../../db/schema/index.js'
import { type DbOrTx, toDec, toNum } from '../wms/helpers.js'

export interface CorteCustoResumo {
  produto_id: string
  produto_codigo: string
  produto_descricao: string
  classificacao: string
  eh_apara: boolean
  qtd_caixas: number
  peso_kg: number
  rendimento_sobre_mp_pct: number
  custo_alocado_kg: number
  custo_total: number
  preco_venda_ref_kg: number
  receita_estimada: number
  margem_rs: number
  margem_pct: number
}

export interface OpCustosResumo {
  op_id: string
  op_codigo: string
  op_nome: string
  status: string
  data_producao: string | null
  peso_insumos_kg: number
  peso_retornos_kg: number
  rendimento_pct: number
  perda_pct: number
  custo_mp_total: number
  custo_embalagens: number
  custo_mo_indireto: number
  custo_total_op: number
  custo_efetivo_aproveitado_kg: number
  receita_estimada_total: number
  margem_bruta_rs: number
  margem_bruta_pct: number
  metodo_rateio: 'NRV' | 'PESO'
  insumos_origem: Array<{
    fornecedor_id: string | null
    fornecedor_nome: string
    sif_origem: string
    lote: string
    produto_descricao: string
    peso_kg: number
    custo_medio_kg: number
    custo_total: number
  }>
  cortes: CorteCustoResumo[]
}

export async function resolverPrecoVendaRefKg(
  dbOrTx: DbOrTx,
  tenantId: string,
  produtoId: string,
  valorUnitarioCadastro?: unknown,
): Promise<number> {
  const [ultVenda] = await dbOrTx
    .select({ preco: pedidosItens.precoUnitario })
    .from(pedidosItens)
    .where(and(eq(pedidosItens.tenantId, tenantId), eq(pedidosItens.produtoId, produtoId)))
    .orderBy(desc(pedidosItens.createdAt))
    .limit(1)

  const pvUlt = toNum(ultVenda?.preco, 0)
  if (pvUlt > 0) return Number(pvUlt.toFixed(4))

  const pvCad = toNum(valorUnitarioCadastro, 0)
  if (pvCad > 0) return Number(pvCad.toFixed(4))

  const [pRow] = await dbOrTx
    .select({ valorUnitario: produtos.valorUnitario })
    .from(produtos)
    .where(eq(produtos.id, produtoId))
    .limit(1)
  return Number(toNum(pRow?.valorUnitario, 0).toFixed(4))
}

export async function calcularEPersistirCustosOp(
  tx: DbOrTx,
  tenantId: string,
  opId: string,
  opts: {
    persistir?: boolean
    precosRefOverride?: Record<string, number>
  } = {},
): Promise<OpCustosResumo> {
  const [op] = await tx
    .select()
    .from(ordensProducao)
    .where(and(eq(ordensProducao.id, opId), eq(ordensProducao.tenantId, tenantId)))
    .limit(1)
  if (!op) {
    throw new Error('OP não encontrada para cálculo de custos.')
  }

  const [insumosRows, retornosRows] = await Promise.all([
    tx
      .select({
        insumo_id: opInsumos.id,
        caixa_id: opInsumos.caixaId,
        produto_id: opInsumos.produtoId,
        peso_kg: opInsumos.pesoKg,
        lote: opInsumos.lote,
        custo_insumo_kg: opInsumos.custoUnitarioKg,
        caixa_custo_kg: estoqueCaixas.custoUnitarioKg,
        fornecedor_id: estoqueCaixas.fornecedorId,
        fornecedor_nome: fornecedores.nomeFantasia,
        sif_origem: estoqueCaixas.sifOrigem,
        prod_descricao: produtos.descricao,
        prod_custo_medio_kg: produtos.custoMedioKg,
      })
      .from(opInsumos)
      .leftJoin(estoqueCaixas, eq(estoqueCaixas.id, opInsumos.caixaId))
      .leftJoin(fornecedores, eq(fornecedores.id, estoqueCaixas.fornecedorId))
      .leftJoin(produtos, eq(produtos.id, opInsumos.produtoId))
      .where(eq(opInsumos.opId, opId)),
    tx
      .select({
        retorno_id: opRetornos.id,
        caixa_id: opRetornos.caixaId,
        produto_id: opRetornos.produtoId,
        peso_kg: opRetornos.pesoKg,
        preco_venda_ref_kg: opRetornos.precoVendaRefKg,
        prod_codigo: produtos.codigo,
        prod_descricao: produtos.descricao,
        classificacao: produtos.classificacao,
        valor_unitario_cad: produtos.valorUnitario,
      })
      .from(opRetornos)
      .leftJoin(produtos, eq(produtos.id, opRetornos.produtoId))
      .where(eq(opRetornos.opId, opId)),
  ])

  let pesoInsumos = 0
  let custoMpTotal = 0
  const origemMap = new Map<
    string,
    {
      fornecedor_id: string | null
      fornecedor_nome: string
      sif_origem: string
      lote: string
      produto_descricao: string
      peso_kg: number
      custo_total: number
    }
  >()

  for (const ins of insumosRows) {
    const peso = toNum(ins.peso_kg, 0)
    const custoKg =
      toNum(ins.custo_insumo_kg, 0) > 0
        ? toNum(ins.custo_insumo_kg, 0)
        : toNum(ins.caixa_custo_kg, 0) > 0
          ? toNum(ins.caixa_custo_kg, 0)
          : toNum(ins.prod_custo_medio_kg, 0)
    const tot = peso * custoKg
    pesoInsumos += peso
    custoMpTotal += tot

    const key = `${ins.fornecedor_id || 'SEM'}__${ins.lote || ''}__${ins.produto_id || ''}`
    const g = origemMap.get(key) || {
      fornecedor_id: ins.fornecedor_id || null,
      fornecedor_nome: ins.fornecedor_nome || 'Estoque / Produção Anterior',
      sif_origem: ins.sif_origem || '',
      lote: ins.lote || '',
      produto_descricao: ins.prod_descricao || 'Matéria-Prima',
      peso_kg: 0,
      custo_total: 0,
    }
    g.peso_kg += peso
    g.custo_total += tot
    origemMap.set(key, g)

    if (opts.persistir && toNum(ins.custo_insumo_kg, 0) === 0 && custoKg > 0) {
      await tx
        .update(opInsumos)
        .set({ custoUnitarioKg: toDec(custoKg, 4) })
        .where(eq(opInsumos.id, ins.insumo_id))
    }
  }

  const custoEmb = toNum(op.custoEmbalagens, 0)
  const custoMo = toNum(op.custoMoIndireto, 0)
  const custoTotalOp = Number((custoMpTotal + custoEmb + custoMo).toFixed(2))

  // Resolver preços de venda ref por produto de retorno
  const retProdIds = Array.from(new Set(retornosRows.map((r) => r.produto_id).filter(Boolean) as string[]))
  const precoRefCache = new Map<string, number>()
  for (const pid of retProdIds) {
    const override = opts.precosRefOverride?.[pid]
    if (override !== undefined && Number.isFinite(Number(override))) {
      precoRefCache.set(pid, Math.max(0, Number(override)))
      continue
    }
    const existingRow = retornosRows.find((r) => r.produto_id === pid && toNum(r.preco_venda_ref_kg, 0) > 0)
    if (existingRow) {
      precoRefCache.set(pid, toNum(existingRow.preco_venda_ref_kg, 0))
    } else {
      const sample = retornosRows.find((r) => r.produto_id === pid)
      const pv = await resolverPrecoVendaRefKg(tx, tenantId, pid, sample?.valor_unitario_cad)
      precoRefCache.set(pid, pv)
    }
  }

  // Separar Aparas vs Cortes Principais
  let pesoRetornos = 0
  let valorAparas = 0
  let somaPotencialPrincipais = 0
  let pesoPrincipais = 0

  const retPrep = retornosRows.map((r) => {
    const peso = toNum(r.peso_kg, 0)
    const pid = r.produto_id || ''
    const precoRef = precoRefCache.get(pid) || 0
    const ehApara = String(r.classificacao || '').toUpperCase() === 'APARA'
    const potencial = peso * precoRef
    pesoRetornos += peso
    if (ehApara) {
      valorAparas += potencial
    } else {
      somaPotencialPrincipais += potencial
      pesoPrincipais += peso
    }
    return {
      ...r,
      peso,
      precoRef,
      ehApara,
      potencial,
    }
  })

  // Abate valor recuperável das aparas (limitado ao custo total da OP)
  const creditoAparas = Math.min(custoTotalOp, valorAparas)
  const custoParaPrincipais = Math.max(0, custoTotalOp - creditoAparas)
  const usarNrv = somaPotencialPrincipais > 0
  const metodoRateio: 'NRV' | 'PESO' = usarNrv ? 'NRV' : 'PESO'

  const cortesMap = new Map<string, CorteCustoResumo>()
  const caixaCustoUpdates: Array<{ caixaId: string; custoKg: number; retornoId: string; precoRef: number }> = []

  for (const r of retPrep) {
    let custoItemTotal = 0
    if (r.peso > 0) {
      if (r.ehApara) {
        custoItemTotal = valorAparas > 0 ? creditoAparas * (r.potencial / valorAparas) : 0
      } else if (pesoPrincipais > 0) {
        if (usarNrv) {
          custoItemTotal = custoParaPrincipais * (r.potencial / somaPotencialPrincipais)
        } else {
          custoItemTotal = custoParaPrincipais * (r.peso / pesoPrincipais)
        }
      } else {
        // Caso raro: OP só teve aparas
        custoItemTotal = pesoRetornos > 0 ? custoTotalOp * (r.peso / pesoRetornos) : 0
      }
    }
    const custoItemKg = r.peso > 0 ? Number((custoItemTotal / r.peso).toFixed(4)) : 0
    if (r.caixa_id) {
      caixaCustoUpdates.push({
        caixaId: r.caixa_id,
        custoKg: custoItemKg,
        retornoId: r.retorno_id,
        precoRef: r.precoRef,
      })
    }

    const pid = r.produto_id || r.retorno_id
    const cur = cortesMap.get(pid) || {
      produto_id: pid,
      produto_codigo: r.prod_codigo || '',
      produto_descricao: r.prod_descricao || 'Corte',
      classificacao: r.classificacao || 'SUBPRODUTO',
      eh_apara: r.ehApara,
      qtd_caixas: 0,
      peso_kg: 0,
      rendimento_sobre_mp_pct: 0,
      custo_alocado_kg: 0,
      custo_total: 0,
      preco_venda_ref_kg: r.precoRef,
      receita_estimada: 0,
      margem_rs: 0,
      margem_pct: 0,
    }
    cur.qtd_caixas += 1
    cur.peso_kg += r.peso
    cur.custo_total += custoItemTotal
    cur.receita_estimada += r.potencial
    cortesMap.set(pid, cur)
  }

  if (opts.persistir) {
    for (const u of caixaCustoUpdates) {
      await tx
        .update(opRetornos)
        .set({
          custoAlocadoKg: toDec(u.custoKg, 4),
          precoVendaRefKg: toDec(u.precoRef, 4),
        })
        .where(eq(opRetornos.id, u.retornoId))
      await tx
        .update(estoqueCaixas)
        .set({ custoUnitarioKg: toDec(u.custoKg, 4), updatedAt: new Date() })
        .where(eq(estoqueCaixas.id, u.caixaId))
    }

    // Atualizar custoMedioKg do produto produzido pela OP
    for (const c of cortesMap.values()) {
      if (c.peso_kg > 0 && c.custo_total > 0 && !c.eh_apara) {
        const cm = Number((c.custo_total / c.peso_kg).toFixed(4))
        await tx
          .update(produtos)
          .set({ custoMedioKg: toDec(cm, 4), updatedAt: new Date() })
          .where(and(eq(produtos.id, c.produto_id), eq(produtos.tenantId, tenantId)))
      }
    }
  }

  const rendimentoPct = pesoInsumos > 0 ? Number(((pesoRetornos / pesoInsumos) * 100).toFixed(2)) : 0
  const perdaPct = pesoInsumos > 0 ? Number((100 - rendimentoPct).toFixed(2)) : 0

  if (opts.persistir) {
    await tx
      .update(ordensProducao)
      .set({
        custoMpTotal: toDec(custoMpTotal, 2),
        rendimentoPct: pesoInsumos > 0 ? toDec(rendimentoPct, 2) : null,
        perdaPct: pesoInsumos > 0 ? toDec(perdaPct, 2) : null,
        updatedAt: new Date(),
      })
      .where(eq(ordensProducao.id, opId))
  }

  let receitaTotal = 0
  const cortesList = Array.from(cortesMap.values()).map((c) => {
    const custoKg = c.peso_kg > 0 ? Number((c.custo_total / c.peso_kg).toFixed(4)) : 0
    const rec = Number(c.receita_estimada.toFixed(2))
    const cus = Number(c.custo_total.toFixed(2))
    const margRs = Number((rec - cus).toFixed(2))
    const margPct = rec > 0 ? Number(((margRs / rec) * 100).toFixed(2)) : 0
    receitaTotal += rec
    return {
      ...c,
      peso_kg: Number(c.peso_kg.toFixed(3)),
      rendimento_sobre_mp_pct: pesoInsumos > 0 ? Number(((c.peso_kg / pesoInsumos) * 100).toFixed(2)) : 0,
      custo_alocado_kg: custoKg,
      custo_total: cus,
      receita_estimada: rec,
      margem_rs: margRs,
      margem_pct: margPct,
    }
  })

  const margemTotalRs = Number((receitaTotal - custoTotalOp).toFixed(2))
  const margemTotalPct = receitaTotal > 0 ? Number(((margemTotalRs / receitaTotal) * 100).toFixed(2)) : 0

  return {
    op_id: op.id,
    op_codigo: op.codigo,
    op_nome: op.nome || op.codigo,
    status: op.status,
    data_producao: op.dataProducao || op.createdAt.toISOString().slice(0, 10),
    peso_insumos_kg: Number(pesoInsumos.toFixed(3)),
    peso_retornos_kg: Number(pesoRetornos.toFixed(3)),
    rendimento_pct: rendimentoPct,
    perda_pct: perdaPct,
    custo_mp_total: Number(custoMpTotal.toFixed(2)),
    custo_embalagens: Number(custoEmb.toFixed(2)),
    custo_mo_indireto: Number(custoMo.toFixed(2)),
    custo_total_op: custoTotalOp,
    custo_efetivo_aproveitado_kg: pesoRetornos > 0 ? Number((custoTotalOp / pesoRetornos).toFixed(4)) : 0,
    receita_estimada_total: Number(receitaTotal.toFixed(2)),
    margem_bruta_rs: margemTotalRs,
    margem_bruta_pct: margemTotalPct,
    metodo_rateio: metodoRateio,
    insumos_origem: Array.from(origemMap.values()).map((o) => ({
      ...o,
      peso_kg: Number(o.peso_kg.toFixed(3)),
      custo_total: Number(o.custo_total.toFixed(2)),
      custo_medio_kg: o.peso_kg > 0 ? Number((o.custo_total / o.peso_kg).toFixed(4)) : 0,
    })),
    cortes: cortesList.sort((a, b) => b.peso_kg - a.peso_kg),
  }
}
