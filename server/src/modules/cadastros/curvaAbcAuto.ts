import { and, eq, inArray, sql } from 'drizzle-orm'
import { produtos } from '../../db/schema/index.js'
import { toNum } from '../wms/helpers.js'

export type ClasseCurvaAbc = 'A' | 'B' | 'C'

export interface ItemCurvaAbcDemanda {
  produto_id: string
  codigo: string
  descricao: string
  tipo_produto: string
  classificacao: string
  grupo: string
  especie: string
  unidade: string
  qtd_producao: number
  valor_producao: number
  qtd_venda_direta: number
  valor_venda_direta: number
  qtd_total: number
  valor_total: number
  origem_predominante: 'PRODUCAO' | 'VENDA_DIRETA' | 'MISTO' | 'SEM_GIRO'
  participacao_pct: number
  acumulado_pct: number
  classe_abc: ClasseCurvaAbc
  classe_anterior: ClasseCurvaAbc
}

export interface ResultadoCurvaAbc {
  criterio: 'VALOR' | 'VOLUME'
  dias: number
  data_inicio: string | null
  data_fim: string | null
  total_produtos: number
  produtos_com_giro: number
  classe_a: number
  classe_b: number
  classe_c: number
  valor_producao_total: number
  valor_venda_direta_total: number
  valor_total_demanda: number
  qtd_total_demanda: number
  atualizados: number
  recalculado: boolean
  itens: ItemCurvaAbcDemanda[]
}

const CACHE_TTL_MS = 5 * 60 * 1000
const ultimoRecalculoPorTenant = new Map<string, number>()

export function invalidarCacheCurvaAbc(tenantId: string): void {
  ultimoRecalculoPorTenant.delete(tenantId)
}

function normalizarClasse(v: unknown): ClasseCurvaAbc {
  const s = String(v || 'C').toUpperCase()
  if (s === 'A' || s === 'B') return s
  return 'C'
}

/**
 * Calcula a Curva ABC automática (Pareto 80% / 15% / 5%) com base na demanda real do ERP:
 *  1) Matéria-prima enviada para Produção / Desossa (op_insumos de OPs não canceladas)
 *  2) Matéria-prima enviada/aberta para cortes no Açougue (estoque_caixas ABERTA_ACOUGUE / CONSUMIDA_ACOUGUE)
 *  3) Retirada de insumos/embalagens para operação/produção (insumos_coletas)
 *  4) Venda direta Atacado — Produtos Acabados ou MPs vendidos direto (pedidos_itens + romaneios avulsos expedidos)
 *  5) Venda direta Varejo / PDV / Empório (pdv_vendas concluídas)
 */
export async function calcularCurvaAbcDemanda(
  db: any,
  tenantId: string,
  opts?: { dias?: number; dataInicio?: string; dataFim?: string },
): Promise<ResultadoCurvaAbc> {
  const diasSeguros = Math.max(1, Math.min(365, Math.trunc(Number(opts?.dias || 90))))
  const usaIntervaloDatas = Boolean(opts?.dataInicio && opts?.dataFim)
  const dataCorteIso = new Date(Date.now() - diasSeguros * 86400000).toISOString()

  const condData = (colSql: ReturnType<typeof sql>) =>
    usaIntervaloDatas
      ? sql`${colSql} >= ${`${opts!.dataInicio!}T00:00:00-03:00`}::timestamptz AND ${colSql} <= ${`${opts!.dataFim!}T23:59:59.999-03:00`}::timestamptz`
      : sql`${colSql} >= ${dataCorteIso}::timestamptz`

  const [prodRows, opRes, acougueRes, insumosRes, pedRes, romRes, pdvRes] = await Promise.all([
    db
      .select({
        id: produtos.id,
        codigo: produtos.codigo,
        descricao: produtos.descricao,
        tipoProduto: produtos.tipoProduto,
        classificacao: produtos.classificacao,
        grupo: produtos.grupo,
        especie: produtos.especie,
        unidade: produtos.unidade,
        statusCurva: produtos.statusCurva,
        valorUnitario: produtos.valorUnitario,
        custoMedioKg: produtos.custoMedioKg,
        ultimoPrecoCompra: produtos.ultimoPrecoCompra,
      })
      .from(produtos)
      .where(and(eq(produtos.tenantId, tenantId), eq(produtos.ativo, 1))),

    // 1) Saída de Matéria-Prima para Produção / Desossa (OPs)
    db.execute(sql`
      SELECT oi.produto_id,
             COALESCE(SUM(oi.peso_kg), 0) AS qtd,
             COALESCE(SUM(
               oi.peso_kg * COALESCE(
                 NULLIF(oi.custo_unitario_kg, 0),
                 NULLIF(p.custo_medio_kg, 0),
                 NULLIF(p.ultimo_preco_compra, 0),
                 NULLIF(p.valor_unitario, 0),
                 0
               )
             ), 0) AS valor
      FROM op_insumos oi
      JOIN ordens_producao op ON op.id = oi.op_id
      JOIN produtos p ON p.id = oi.produto_id
      WHERE oi.tenant_id = ${tenantId}
        AND oi.produto_id IS NOT NULL
        AND op.status <> 'CANCELADA'
        AND ${condData(sql`oi.created_at`)}
      GROUP BY oi.produto_id
    `),

    // 2) Matéria-Prima enviada / aberta na produção do Açougue
    db.execute(sql`
      SELECT ec.produto_id,
             COALESCE(SUM(ec.peso_kg), 0) AS qtd,
             COALESCE(SUM(
               ec.peso_kg * COALESCE(
                 NULLIF(ec.custo_unitario_kg, 0),
                 NULLIF(p.custo_medio_kg, 0),
                 NULLIF(p.ultimo_preco_compra, 0),
                 NULLIF(p.valor_unitario, 0),
                 0
               )
             ), 0) AS valor
      FROM estoque_caixas ec
      JOIN produtos p ON p.id = ec.produto_id
      WHERE ec.tenant_id = ${tenantId}
        AND ec.status IN ('ABERTA_ACOUGUE', 'CONSUMIDA_ACOUGUE')
        AND ${condData(sql`COALESCE(ec.entrada_acougue_em, ec.updated_at)`)}
      GROUP BY ec.produto_id
    `),

    // 3) Saída de Insumos / Embalagens para Produção / Operação
    db.execute(sql`
      SELECT ic.produto_id,
             COALESCE(SUM(ic.quantidade), 0) AS qtd,
             COALESCE(SUM(
               CASE
                 WHEN COALESCE(ic.custo_total, 0) > 0 THEN ic.custo_total
                 ELSE ic.quantidade * COALESCE(
                   NULLIF(p.custo_medio_kg, 0),
                   NULLIF(p.ultimo_preco_compra, 0),
                   NULLIF(p.valor_unitario, 0),
                   0
                 )
               END
             ), 0) AS valor
      FROM insumos_coletas ic
      JOIN produtos p ON p.id = ic.produto_id
      WHERE ic.tenant_id = ${tenantId}
        AND ic.tipo NOT LIKE 'ENTRADA%'
        AND ic.quantidade > 0
        AND ${condData(sql`ic.created_at`)}
      GROUP BY ic.produto_id
    `),

    // 4a) Venda Direta Atacado — Pedidos (Produtos Acabados ou MPs vendidas direto)
    db.execute(sql`
      SELECT pi.produto_id,
             COALESCE(SUM(COALESCE(NULLIF(pi.qtd_kg_solicitada, 0), NULLIF(pi.qtd_solicitada_exibicao, 0), 1)), 0) AS qtd,
             COALESCE(SUM(
               COALESCE(NULLIF(pi.qtd_kg_solicitada, 0), NULLIF(pi.qtd_solicitada_exibicao, 0), 1) *
               COALESCE(
                 NULLIF(pi.preco_unitario * (1 - COALESCE(pi.desconto_pct, 0) / 100.0), 0),
                 NULLIF(p.valor_unitario, 0),
                 NULLIF(p.custo_medio_kg, 0),
                 NULLIF(p.ultimo_preco_compra, 0),
                 0
               )
             ), 0) AS valor
      FROM pedidos_itens pi
      JOIN pedidos ped ON ped.id = pi.pedido_id
      JOIN produtos p ON p.id = pi.produto_id
      WHERE pi.tenant_id = ${tenantId}
        AND ped.status NOT IN ('CANCELADO', 'RASCUNHO')
        AND ${condData(sql`ped.created_at`)}
      GROUP BY pi.produto_id
    `),

    // 4b) Venda Direta Atacado — Romaneios avulsos expedidos sem pedido vinculado
    db.execute(sql`
      SELECT ri.produto_id,
             COALESCE(SUM(COALESCE(ri.peso_kg, 0)), 0) AS qtd,
             COALESCE(SUM(
               COALESCE(ri.peso_kg, 0) * COALESCE(
                 NULLIF(p.valor_unitario, 0),
                 NULLIF(p.custo_medio_kg, 0),
                 NULLIF(p.ultimo_preco_compra, 0),
                 0
               )
             ), 0) AS valor
      FROM romaneios_itens ri
      JOIN romaneios r ON r.id = ri.romaneio_id
      JOIN produtos p ON p.id = ri.produto_id
      WHERE ri.tenant_id = ${tenantId}
        AND r.pedido_id IS NULL
        AND r.status = 'EXPEDIDO'
        AND ${condData(sql`COALESCE(r.expedido_at, r.created_at)`)}
      GROUP BY ri.produto_id
    `),

    // 5) Venda Direta Varejo / PDV / Açougue / Empório
    db.execute(sql`
      SELECT itens_json
      FROM pdv_vendas
      WHERE tenant_id = ${tenantId}
        AND status = 'CONCLUIDA'
        AND ${condData(sql`created_at`)}
    `),
  ])

  const ativos = (prodRows as Array<Record<string, unknown>>).filter(
    (p) => String(p.codigo || '').trim().toUpperCase() !== 'VAZIO',
  )

  const agg = new Map<
    string,
    {
      produto_id: string
      codigo: string
      descricao: string
      tipo_produto: string
      classificacao: string
      grupo: string
      especie: string
      unidade: string
      classe_anterior: ClasseCurvaAbc
      ref_unit: number
      qtd_producao: number
      valor_producao: number
      qtd_venda_direta: number
      valor_venda_direta: number
    }
  >()

  for (const p of ativos) {
    const id = String(p.id)
    const refUnit =
      toNum(p.valorUnitario, 0) || toNum(p.custoMedioKg, 0) || toNum(p.ultimoPrecoCompra, 0)
    agg.set(id, {
      produto_id: id,
      codigo: String(p.codigo || ''),
      descricao: String(p.descricao || ''),
      tipo_produto: String(p.tipoProduto || 'Materia Prima'),
      classificacao: String(p.classificacao || ''),
      grupo: String(p.grupo || ''),
      especie: String(p.especie || ''),
      unidade: String(p.unidade || 'KG'),
      classe_anterior: normalizarClasse(p.statusCurva),
      ref_unit: refUnit,
      qtd_producao: 0,
      valor_producao: 0,
      qtd_venda_direta: 0,
      valor_venda_direta: 0,
    })
  }

  const somarProducao = (rows: Array<Record<string, unknown>>) => {
    for (const r of rows) {
      const item = agg.get(String(r.produto_id || ''))
      if (!item) continue
      item.qtd_producao += toNum(r.qtd, 0)
      item.valor_producao += toNum(r.valor, 0)
    }
  }

  const somarVenda = (rows: Array<Record<string, unknown>>) => {
    for (const r of rows) {
      const item = agg.get(String(r.produto_id || ''))
      if (!item) continue
      item.qtd_venda_direta += toNum(r.qtd, 0)
      item.valor_venda_direta += toNum(r.valor, 0)
    }
  }

  somarProducao((opRes.rows || []) as Array<Record<string, unknown>>)
  somarProducao((acougueRes.rows || []) as Array<Record<string, unknown>>)
  somarProducao((insumosRes.rows || []) as Array<Record<string, unknown>>)
  somarVenda((pedRes.rows || []) as Array<Record<string, unknown>>)
  somarVenda((romRes.rows || []) as Array<Record<string, unknown>>)

  for (const v of (pdvRes.rows || []) as Array<{ itens_json: unknown }>) {
    const itensJson = Array.isArray(v.itens_json) ? v.itens_json : []
    for (const raw of itensJson) {
      const it = (raw || {}) as Record<string, unknown>
      const pid = String(it.produto_id || it.id || '')
      const item = agg.get(pid)
      if (!item) continue
      const qtd = toNum(it.qtd ?? it.quantidade ?? it.peso_kg, 0)
      if (qtd <= 0) continue
      const precoInformado = toNum(it.preco_unitario, 0)
      const val =
        toNum(it.subtotal ?? it.valor_total, 0) ||
        qtd * (precoInformado > 0 ? precoInformado : item.ref_unit)
      item.qtd_venda_direta += qtd
      item.valor_venda_direta += val
    }
  }

  const todos = Array.from(agg.values())
  const somaValorGlobal = todos.reduce((s, x) => s + x.valor_producao + x.valor_venda_direta, 0)
  const criterio: 'VALOR' | 'VOLUME' = somaValorGlobal > 0 ? 'VALOR' : 'VOLUME'

  const comScore = todos.map((x) => {
    const qtdTotal = x.qtd_producao + x.qtd_venda_direta
    const valTotal = x.valor_producao + x.valor_venda_direta
    const score = criterio === 'VALOR' ? (valTotal > 0 ? valTotal : qtdTotal) : qtdTotal
    let origem: 'PRODUCAO' | 'VENDA_DIRETA' | 'MISTO' | 'SEM_GIRO' = 'SEM_GIRO'
    if (x.qtd_producao > 0 && x.qtd_venda_direta > 0) origem = 'MISTO'
    else if (x.qtd_producao > 0) origem = 'PRODUCAO'
    else if (x.qtd_venda_direta > 0) origem = 'VENDA_DIRETA'
    return { ...x, qtd_total: qtdTotal, valor_total: valTotal, score, origem }
  })

  comScore.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.qtd_total !== a.qtd_total) return b.qtd_total - a.qtd_total
    return a.descricao.localeCompare(b.descricao)
  })

  const totalScore = comScore.reduce((s, x) => s + x.score, 0)
  let acum = 0
  let classeA = 0
  let classeB = 0
  let classeC = 0

  const itens: ItemCurvaAbcDemanda[] = comScore.map((x) => {
    let classe: ClasseCurvaAbc = 'C'
    let share = 0
    if (x.score > 0 && totalScore > 0) {
      share = (x.score / totalScore) * 100
      if (acum < 80) classe = 'A'
      else if (acum < 95) classe = 'B'
      else classe = 'C'
      acum += share
    }

    if (classe === 'A') classeA += 1
    else if (classe === 'B') classeB += 1
    else classeC += 1

    return {
      produto_id: x.produto_id,
      codigo: x.codigo,
      descricao: x.descricao,
      tipo_produto: x.tipo_produto,
      classificacao: x.classificacao,
      grupo: x.grupo,
      especie: x.especie,
      unidade: x.unidade,
      qtd_producao: Number(x.qtd_producao.toFixed(3)),
      valor_producao: Number(x.valor_producao.toFixed(2)),
      qtd_venda_direta: Number(x.qtd_venda_direta.toFixed(3)),
      valor_venda_direta: Number(x.valor_venda_direta.toFixed(2)),
      qtd_total: Number(x.qtd_total.toFixed(3)),
      valor_total: Number(x.valor_total.toFixed(2)),
      origem_predominante: x.origem,
      participacao_pct: Number(share.toFixed(2)),
      acumulado_pct: Number((x.score > 0 ? Math.min(100, acum) : 100).toFixed(2)),
      classe_abc: classe,
      classe_anterior: x.classe_anterior,
    }
  })

  const valorProdTotal = itens.reduce((s, x) => s + x.valor_producao, 0)
  const valorVendaTotal = itens.reduce((s, x) => s + x.valor_venda_direta, 0)
  const qtdTotal = itens.reduce((s, x) => s + x.qtd_total, 0)

  return {
    criterio,
    dias: diasSeguros,
    data_inicio: usaIntervaloDatas ? opts!.dataInicio! : null,
    data_fim: usaIntervaloDatas ? opts!.dataFim! : null,
    total_produtos: itens.length,
    produtos_com_giro: itens.filter((x) => x.qtd_total > 0).length,
    classe_a: classeA,
    classe_b: classeB,
    classe_c: classeC,
    valor_producao_total: Number(valorProdTotal.toFixed(2)),
    valor_venda_direta_total: Number(valorVendaTotal.toFixed(2)),
    valor_total_demanda: Number((valorProdTotal + valorVendaTotal).toFixed(2)),
    qtd_total_demanda: Number(qtdTotal.toFixed(3)),
    atualizados: 0,
    recalculado: true,
    itens,
  }
}

/**
 * Recalcula e persiste automaticamente produtos.status_curva para o tenant.
 * Usa cache em memória de 5 minutos (quando force = false) para não onerar listagens frequentes.
 */
export async function recalcularCurvaAbcTenant(
  db: any,
  tenantId: string,
  opts?: { dias?: number; force?: boolean },
): Promise<ResultadoCurvaAbc | null> {
  const force = Boolean(opts?.force)
  const agora = Date.now()
  const ultimo = ultimoRecalculoPorTenant.get(tenantId) || 0
  if (!force && agora - ultimo < CACHE_TTL_MS) {
    return null
  }

  const resultado = await calcularCurvaAbcDemanda(db, tenantId, { dias: opts?.dias ?? 90 })

  const paraA: string[] = []
  const paraB: string[] = []
  const paraC: string[] = []

  for (const it of resultado.itens) {
    if (it.classe_abc === it.classe_anterior) continue
    if (it.classe_abc === 'A') paraA.push(it.produto_id)
    else if (it.classe_abc === 'B') paraB.push(it.produto_id)
    else paraC.push(it.produto_id)
  }

  const updates: Promise<unknown>[] = []
  if (paraA.length > 0) {
    updates.push(
      db
        .update(produtos)
        .set({ statusCurva: 'A' })
        .where(and(eq(produtos.tenantId, tenantId), inArray(produtos.id, paraA))),
    )
  }
  if (paraB.length > 0) {
    updates.push(
      db
        .update(produtos)
        .set({ statusCurva: 'B' })
        .where(and(eq(produtos.tenantId, tenantId), inArray(produtos.id, paraB))),
    )
  }
  if (paraC.length > 0) {
    updates.push(
      db
        .update(produtos)
        .set({ statusCurva: 'C' })
        .where(and(eq(produtos.tenantId, tenantId), inArray(produtos.id, paraC))),
    )
  }

  if (updates.length > 0) {
    await Promise.all(updates)
  }

  ultimoRecalculoPorTenant.set(tenantId, Date.now())
  resultado.atualizados = paraA.length + paraB.length + paraC.length
  return resultado
}
