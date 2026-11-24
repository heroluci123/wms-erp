import type { FastifyInstance } from 'fastify'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DbConnection } from '../../db/client.js'
import {
  auditoriaAcessos,
  camarasTemperaturaLog,
  estoqueCaixas,
  etiquetasAcougue,
  opInsumos,
  opRetornos,
  ordensProducao,
  pdvVendas,
  produtoArvore,
  produtos,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import { hojeIsoLocal, toDec, toNum } from '../wms/helpers.js'

const PERM_LP_READ = [
  'compras',
  'fornecedores',
  'recebimento',
  'estoque_enderecos',
  'consulta_estoque',
  'relatorios_estoque',
  'dashboard_executivo',
  'varejo_acougue',
  'financeiro',
  'producao_entrada',
  'retorno_producao',
]

const PERM_LP_WRITE = [
  'compras',
  'recebimento',
  'estoque_enderecos',
  'dashboard_executivo',
  'varejo_acougue',
  'producao_entrada',
  'retorno_producao',
  'saida',
  'expedicao',
]

export const FAIXAS_TEMPERATURA_SIF: Record<
  string,
  { label: string; min: number; max: number }
> = {
  RESFRIADO: { label: 'Câmara Resfriada', min: -1, max: 7 },
  CONGELADO: { label: 'Câmara Congelada', min: -25, max: -12 },
  CLIMATIZADO: { label: 'Sala Desossa / Climatizada', min: 4, max: 12 },
  BALCAO_ACOUGUE: { label: 'Balcão / Expositor Açougue', min: 0, max: 7 },
  VEICULO: { label: 'Baú / Caminhão Frigorífico', min: -18, max: 7 },
}

function somarDiasIso(iso: string, delta: number): string {
  const dt = new Date(`${iso}T12:00:00Z`)
  dt.setUTCDate(dt.getUTCDate() + delta)
  return dt.toISOString().slice(0, 10)
}

function diffDiasEntre(isoA: string, isoB: string): number {
  const a = Date.parse(`${isoA}T00:00:00Z`)
  const b = Date.parse(`${isoB}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.round((a - b) / 86400000)
}

export function registerLossPreventionRoutes(app: FastifyInstance, conn: DbConnection) {
  const { requirePermission } = createAuthMiddleware(app, conn)

  // ═══════════════════════════════════════════════════════════════════════════
  // 1) ALARME DE FURO DE RENDIMENTO (DESOSSA / INDÚSTRIA + AÇOUGUE / VAREJO)
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(
    '/api/governanca/loss-prevention/rendimento',
    { preHandler: requirePermission(PERM_LP_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as {
        dias?: string
        tolerancia_pct?: string
        meta_desossa_pct?: string
        meta_acougue_pct?: string
      }

      const dias = Math.min(365, Math.max(1, Math.round(Number(q.dias || 30))))
      const toleranciaPct = Math.min(30, Math.max(1, Number(q.tolerancia_pct || 5)))
      const metaDesossaPadrao = Math.min(99, Math.max(30, Number(q.meta_desossa_pct || 75)))
      const metaAcouguePadrao = Math.min(99, Math.max(30, Number(q.meta_acougue_pct || 85)))
      const dataCorte = somarDiasIso(hojeIsoLocal(), -dias)

      const [opsRows, arvoreRows, mpsAcougueRows] = await Promise.all([
        conn.db
          .select({
            id: ordensProducao.id,
            codigo: ordensProducao.codigo,
            nome: ordensProducao.nome,
            status: ordensProducao.status,
            cliente: ordensProducao.cliente,
            operador_nome: ordensProducao.operadorNome,
            rendimento_pct: ordensProducao.rendimentoPct,
            perda_pct: ordensProducao.perdaPct,
            custo_mp_total: ordensProducao.custoMpTotal,
            data_producao: ordensProducao.dataProducao,
            created_at: ordensProducao.createdAt,
          })
          .from(ordensProducao)
          .where(
            and(
              eq(ordensProducao.tenantId, ctx.tenantId),
              sql`DATE(${ordensProducao.createdAt}) >= ${dataCorte}::date`,
              sql`${ordensProducao.status} IN ('FECHADA', 'ABERTA')`,
            ),
          )
          .orderBy(desc(ordensProducao.createdAt))
          .limit(200),
        conn.db
          .select({
            paiId: produtoArvore.paiId,
            rendimentoEsperadoPct: produtoArvore.rendimentoEsperadoPct,
            rendimentoAprendidoPct: produtoArvore.rendimentoAprendidoPct,
          })
          .from(produtoArvore)
          .where(eq(produtoArvore.tenantId, ctx.tenantId)),
        conn.db
          .select({
            id: estoqueCaixas.id,
            ean_caixa: estoqueCaixas.eanCaixa,
            produto_id: estoqueCaixas.produtoId,
            produto_codigo: produtos.codigo,
            produto_descricao: produtos.descricao,
            peso_kg: estoqueCaixas.pesoKg,
            quebra_acougue_kg: estoqueCaixas.quebraAcougueKg,
            peso_restante_kg: estoqueCaixas.pesoRestanteKg,
            custo_unitario_kg: estoqueCaixas.custoUnitarioKg,
            prod_custo_medio: produtos.custoMedioKg,
            status: estoqueCaixas.status,
            lote: estoqueCaixas.lote,
            updated_at: estoqueCaixas.updatedAt,
          })
          .from(estoqueCaixas)
          .innerJoin(produtos, eq(produtos.id, estoqueCaixas.produtoId))
          .where(
            and(
              eq(estoqueCaixas.tenantId, ctx.tenantId),
              eq(estoqueCaixas.status, 'CONSUMIDA_ACOUGUE'),
              sql`DATE(${estoqueCaixas.updatedAt}) >= ${dataCorte}::date`,
            ),
          )
          .orderBy(desc(estoqueCaixas.updatedAt))
          .limit(200),
      ])

      // Mapa de rendimento esperado por MP (soma dos rendimentos dos cortes filhos na árvore, limitado a 98%)
      const rendPorPai = new Map<string, number>()
      for (const a of arvoreRows) {
        const pct = toNum(a.rendimentoAprendidoPct, 0) || toNum(a.rendimentoEsperadoPct, 0)
        if (pct > 0) {
          rendPorPai.set(a.paiId, Math.min(98, (rendPorPai.get(a.paiId) || 0) + pct))
        }
      }

      const opIds = opsRows.map((o) => o.id)
      const [insumosRows, retornosRows] =
        opIds.length > 0
          ? await Promise.all([
              conn.db
                .select({
                  opId: opInsumos.opId,
                  produtoId: opInsumos.produtoId,
                  pesoKg: opInsumos.pesoKg,
                  custoUnitarioKg: opInsumos.custoUnitarioKg,
                })
                .from(opInsumos)
                .where(inArray(opInsumos.opId, opIds)),
              conn.db
                .select({
                  opId: opRetornos.opId,
                  pesoKg: opRetornos.pesoKg,
                })
                .from(opRetornos)
                .where(inArray(opRetornos.opId, opIds)),
            ])
          : [[], []]

      const insPorOp = new Map<string, typeof insumosRows>()
      for (const r of insumosRows) {
        const arr = insPorOp.get(r.opId) || []
        arr.push(r)
        insPorOp.set(r.opId, arr)
      }
      const retPorOp = new Map<string, number>()
      for (const r of retornosRows) {
        retPorOp.set(r.opId, (retPorOp.get(r.opId) || 0) + toNum(r.pesoKg, 0))
      }

      const opsAnalise = []
      for (const op of opsRows) {
        const ins = insPorOp.get(op.id) || []
        const pesoEntrada = ins.reduce((s, i) => s + toNum(i.pesoKg, 0), 0)
        const pesoSaida = retPorOp.get(op.id) || 0
        if (pesoEntrada <= 0) continue
        // Só avalia anomalia de OP se já foi fechada ou se já teve saída lançada
        if (op.status !== 'FECHADA' && pesoSaida <= 0) continue

        const rendReal =
          op.rendimento_pct != null && toNum(op.rendimento_pct, 0) > 0
            ? toNum(op.rendimento_pct, 0)
            : Number(((pesoSaida / pesoEntrada) * 100).toFixed(2))

        // Calcula rendimento esperado ponderado pelas MPs da árvore (ou meta padrão)
        let pesoComArvore = 0
        let somaRendPond = 0
        for (const i of ins) {
          const pKg = toNum(i.pesoKg, 0)
          const rArv = i.produtoId ? rendPorPai.get(i.produtoId) : undefined
          if (rArv && rArv >= 30) {
            pesoComArvore += pKg
            somaRendPond += pKg * rArv
          }
        }
        const rendEsperado =
          pesoComArvore > 0 ? Number((somaRendPond / pesoComArvore).toFixed(1)) : metaDesossaPadrao

        const desvioPct = Number((rendReal - rendEsperado).toFixed(2))
        const anomalia = desvioPct < -toleranciaPct

        const custoTotalMp =
          toNum(op.custo_mp_total, 0) ||
          ins.reduce((s, i) => s + toNum(i.pesoKg, 0) * toNum(i.custoUnitarioKg, 0), 0)
        const custoMedioKg = pesoEntrada > 0 ? custoTotalMp / pesoEntrada : 0
        const kgFuroExtra = anomalia ? Number(((pesoEntrada * Math.abs(desvioPct)) / 100).toFixed(2)) : 0
        const prejuizoEstimado = Number((kgFuroExtra * custoMedioKg).toFixed(2))

        opsAnalise.push({
          id: op.id,
          origem: 'DESOSSA_OP',
          codigo: op.codigo,
          descricao: op.nome || op.codigo,
          cliente: op.cliente || 'INTERNO',
          operador_nome: op.operador_nome || 'Produção',
          status: op.status,
          peso_entrada_kg: Number(pesoEntrada.toFixed(2)),
          peso_saida_kg: Number(pesoSaida.toFixed(2)),
          quebra_kg: Number(Math.max(0, pesoEntrada - pesoSaida).toFixed(2)),
          rendimento_esperado_pct: rendEsperado,
          rendimento_real_pct: Number(rendReal.toFixed(2)),
          desvio_pct: desvioPct,
          anomalia,
          kg_furo_extra: kgFuroExtra,
          custo_medio_kg: Number(custoMedioKg.toFixed(2)),
          prejuizo_estimado: prejuizoEstimado,
          data_ref: op.data_producao || new Date(op.created_at).toISOString().slice(0, 10),
        })
      }

      const acougueAnalise = []
      for (const mp of mpsAcougueRows) {
        const pesoIni = toNum(mp.peso_kg, 0)
        if (pesoIni <= 0) continue
        const quebraKg = Math.max(0, toNum(mp.quebra_acougue_kg, 0))
        const pesoAproveitado = Math.max(0, pesoIni - quebraKg)
        const rendReal = Number(((pesoAproveitado / pesoIni) * 100).toFixed(2))
        const rendEsperado = rendPorPai.get(mp.produto_id) || metaAcouguePadrao
        const desvioPct = Number((rendReal - rendEsperado).toFixed(2))
        const anomalia = desvioPct < -toleranciaPct
        const custoUnit = toNum(mp.custo_unitario_kg, 0) || toNum(mp.prod_custo_medio, 0)
        const kgFuroExtra = anomalia ? Number(((pesoIni * Math.abs(desvioPct)) / 100).toFixed(2)) : 0
        const prejuizoEstimado = Number((kgFuroExtra * custoUnit).toFixed(2))

        acougueAnalise.push({
          id: mp.id,
          origem: 'ACOUGUE_MP',
          codigo: mp.ean_caixa,
          produto_codigo: mp.produto_codigo || '',
          descricao: mp.produto_descricao,
          lote: mp.lote || '-',
          peso_entrada_kg: Number(pesoIni.toFixed(2)),
          peso_saida_kg: Number(pesoAproveitado.toFixed(2)),
          quebra_kg: Number(quebraKg.toFixed(2)),
          rendimento_esperado_pct: Number(rendEsperado.toFixed(1)),
          rendimento_real_pct: rendReal,
          desvio_pct: desvioPct,
          anomalia,
          kg_furo_extra: kgFuroExtra,
          custo_medio_kg: Number(custoUnit.toFixed(2)),
          prejuizo_estimado: prejuizoEstimado,
          data_ref: new Date(mp.updated_at).toISOString().slice(0, 10),
        })
      }

      opsAnalise.sort((a, b) => a.desvio_pct - b.desvio_pct)
      acougueAnalise.sort((a, b) => a.desvio_pct - b.desvio_pct)

      const opsAnom = opsAnalise.filter((x) => x.anomalia)
      const acAnom = acougueAnalise.filter((x) => x.anomalia)
      const kgFuroTotal = Number(
        [...opsAnom, ...acAnom].reduce((s, x) => s + x.kg_furo_extra, 0).toFixed(2),
      )
      const prejuizoTotal = Number(
        [...opsAnom, ...acAnom].reduce((s, x) => s + x.prejuizo_estimado, 0).toFixed(2),
      )

      const mediaOps =
        opsAnalise.length > 0
          ? Number(
              (opsAnalise.reduce((s, x) => s + x.rendimento_real_pct, 0) / opsAnalise.length).toFixed(1),
            )
          : null
      const mediaAc =
        acougueAnalise.length > 0
          ? Number(
              (
                acougueAnalise.reduce((s, x) => s + x.rendimento_real_pct, 0) / acougueAnalise.length
              ).toFixed(1),
            )
          : null

      return {
        success: true,
        parametros: {
          dias,
          tolerancia_pct: toleranciaPct,
          meta_desossa_pct: metaDesossaPadrao,
          meta_acougue_pct: metaAcouguePadrao,
        },
        resumo: {
          total_avaliados: opsAnalise.length + acougueAnalise.length,
          total_anomalias: opsAnom.length + acAnom.length,
          total_ops_avaliadas: opsAnalise.length,
          total_ops_anomalia: opsAnom.length,
          total_mps_acougue_avaliadas: acougueAnalise.length,
          total_mps_acougue_anomalia: acAnom.length,
          kg_furo_total: kgFuroTotal,
          prejuizo_estimado_total: prejuizoTotal,
          rendimento_medio_desossa_pct: mediaOps,
          rendimento_medio_acougue_pct: mediaAc,
        },
        ops: opsAnalise,
        acougue: acougueAnalise,
      }
    },
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // 2) AUDITORIA DE ETIQUETA FANTASMA & SUBFATURAMENTO (AÇOUGUE / PDV)
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(
    '/api/governanca/loss-prevention/etiquetas-fantasma',
    { preHandler: requirePermission(PERM_LP_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { dias?: string; dias_fantasma?: string }
      const dias = Math.min(180, Math.max(1, Math.round(Number(q.dias || 30))))
      const diasFantasma = Math.min(30, Math.max(1, Math.round(Number(q.dias_fantasma || 3))))
      const hoje = hojeIsoLocal()
      const dataCorte = somarDiasIso(hoje, -dias)

      const [etiquetas, vendasPdv] = await Promise.all([
        conn.db
          .select({
            id: etiquetasAcougue.id,
            codigo_etiqueta: etiquetasAcougue.codigoEtiqueta,
            produto_id: etiquetasAcougue.produtoId,
            produto_codigo: etiquetasAcougue.produtoCodigo,
            produto_descricao: etiquetasAcougue.produtoDescricao,
            especie: etiquetasAcougue.especie,
            conservacao: etiquetasAcougue.conservacao,
            peso_liquido_kg: etiquetasAcougue.pesoLiquidoKg,
            preco_kg: etiquetasAcougue.precoKg,
            valor_total: etiquetasAcougue.valorTotal,
            lote: etiquetasAcougue.lote,
            data_pesagem: etiquetasAcougue.dataPesagem,
            validade: etiquetasAcougue.validade,
            status: etiquetasAcougue.status,
            operador_nome: etiquetasAcougue.operadorNome,
            created_at: etiquetasAcougue.createdAt,
            prod_preco_base: produtos.valorUnitario,
            prod_custo_kg: produtos.custoMedioKg,
          })
          .from(etiquetasAcougue)
          .leftJoin(produtos, eq(produtos.id, etiquetasAcougue.produtoId))
          .where(
            and(
              eq(etiquetasAcougue.tenantId, ctx.tenantId),
              sql`(DATE(${etiquetasAcougue.createdAt}) >= ${dataCorte}::date OR ${etiquetasAcougue.status} = 'EM_ESTOQUE')`,
            ),
          )
          .orderBy(desc(etiquetasAcougue.createdAt))
          .limit(500),
        conn.db
          .select({
            id: pdvVendas.id,
            status: pdvVendas.status,
            operador_nome: pdvVendas.operadorNome,
            valor_total: pdvVendas.valorTotal,
            desconto_pct: pdvVendas.descontoPct,
          })
          .from(pdvVendas)
          .where(
            and(
              eq(pdvVendas.tenantId, ctx.tenantId),
              sql`DATE(${pdvVendas.createdAt}) >= ${dataCorte}::date`,
            ),
          )
          .limit(1000),
      ])

      const fantasmas: Array<{
        id: string
        codigo_etiqueta: string
        produto_codigo: string
        produto_descricao: string
        peso_kg: number
        preco_kg: number
        valor_total: number
        data_pesagem: string
        validade: string | null
        idade_dias: number
        vencida: boolean
        operador_nome: string
        motivo_alerta: string
      }> = []

      const subfaturadas: Array<{
        id: string
        codigo_etiqueta: string
        produto_codigo: string
        produto_descricao: string
        peso_kg: number
        preco_etiqueta_kg: number
        preco_ref_kg: number
        custo_kg: number
        diferenca_valor: number
        abaixo_custo: boolean
        desconto_implicito_pct: number
        status: string
        operador_nome: string
        data_pesagem: string
      }> = []

      let canceladasQtd = 0
      let canceladasKg = 0

      // Estatísticas por operador (Açougue + PDV)
      const opStats = new Map<
        string,
        {
          operador: string
          etiquetas_emitidas: number
          etiquetas_canceladas: number
          etiquetas_fantasma: number
          etiquetas_subfaturadas: number
          vendas_pdv: number
          cancelamentos_pdv: number
          descontos_altos_pdv: number
        }
      >()
      const getOp = (nome: string) => {
        const k = (nome || 'Operador').trim()
        let row = opStats.get(k)
        if (!row) {
          row = {
            operador: k,
            etiquetas_emitidas: 0,
            etiquetas_canceladas: 0,
            etiquetas_fantasma: 0,
            etiquetas_subfaturadas: 0,
            vendas_pdv: 0,
            cancelamentos_pdv: 0,
            descontos_altos_pdv: 0,
          }
          opStats.set(k, row)
        }
        return row
      }

      for (const e of etiquetas) {
        const op = getOp(e.operador_nome)
        op.etiquetas_emitidas += 1

        const peso = toNum(e.peso_liquido_kg, 0)
        const precoEtq = toNum(e.preco_kg, 0)
        const valTot = toNum(e.valor_total, 0)
        const dataPes = String(e.data_pesagem || '').slice(0, 10) || new Date(e.created_at).toISOString().slice(0, 10)
        const valIso = e.validade ? String(e.validade).slice(0, 10) : null
        const idadeDias = Math.max(0, diffDiasEntre(hoje, dataPes))
        const vencida = Boolean(valIso && valIso < hoje)

        if (e.status === 'CANCELADA') {
          canceladasQtd += 1
          canceladasKg += peso
          op.etiquetas_canceladas += 1
        }

        // 1) Etiqueta Fantasma: continua EM_ESTOQUE mas está vencida ou encalhada há >= diasFantasma dias
        if (e.status === 'EM_ESTOQUE' && (vencida || idadeDias >= diasFantasma)) {
          op.etiquetas_fantasma += 1
          fantasmas.push({
            id: e.id,
            codigo_etiqueta: e.codigo_etiqueta,
            produto_codigo: e.produto_codigo || '',
            produto_descricao: e.produto_descricao,
            peso_kg: Number(peso.toFixed(3)),
            preco_kg: Number(precoEtq.toFixed(2)),
            valor_total: Number(valTot.toFixed(2)),
            data_pesagem: dataPes,
            validade: valIso,
            idade_dias: idadeDias,
            vencida,
            operador_nome: e.operador_nome || 'Açougue',
            motivo_alerta: vencida
              ? `Etiqueta vencida em ${valIso} sem venda e sem baixa de perda`
              : `Pesada há ${idadeDias} dia(s) sem passar no PDV (possível extravio / consumo interno)`,
          })
        }

        // 2) Subfaturamento / Re-etiquetagem suspeita (preço abaixo do custo ou < 80% do cadastro)
        if (e.status !== 'CANCELADA' && precoEtq > 0) {
          const precoRef = toNum(e.prod_preco_base, 0)
          const custoKg = toNum(e.prod_custo_kg, 0)
          const abaixoCusto = custoKg > 0 && precoEtq < custoKg
          const descPct = precoRef > 0 ? Number((((precoRef - precoEtq) / precoRef) * 100).toFixed(1)) : 0
          const muitoAbaixoTabela = precoRef > 0 && descPct >= 20

          if (abaixoCusto || muitoAbaixoTabela) {
            op.etiquetas_subfaturadas += 1
            const refComp = Math.max(precoRef, custoKg)
            const diffValor = Number(Math.max(0, (refComp - precoEtq) * peso).toFixed(2))
            subfaturadas.push({
              id: e.id,
              codigo_etiqueta: e.codigo_etiqueta,
              produto_codigo: e.produto_codigo || '',
              produto_descricao: e.produto_descricao,
              peso_kg: Number(peso.toFixed(3)),
              preco_etiqueta_kg: Number(precoEtq.toFixed(2)),
              preco_ref_kg: Number(precoRef.toFixed(2)),
              custo_kg: Number(custoKg.toFixed(2)),
              diferenca_valor: diffValor,
              abaixo_custo: abaixoCusto,
              desconto_implicito_pct: Math.max(0, descPct),
              status: e.status,
              operador_nome: e.operador_nome || 'Açougue',
              data_pesagem: dataPes,
            })
          }
        }
      }

      for (const v of vendasPdv) {
        const op = getOp(v.operador_nome)
        op.vendas_pdv += 1
        if (v.status === 'CANCELADA') op.cancelamentos_pdv += 1
        if (v.status === 'CONCLUIDA' && toNum(v.desconto_pct, 0) >= 10) op.descontos_altos_pdv += 1
      }

      const rankingOperadores = Array.from(opStats.values())
        .map((o) => {
          const totalAcoes = o.etiquetas_emitidas + o.vendas_pdv
          const totalCancel = o.etiquetas_canceladas + o.cancelamentos_pdv
          const taxaCancelPct = totalAcoes > 0 ? Number(((totalCancel / totalAcoes) * 100).toFixed(1)) : 0
          const scoreAlerta =
            o.etiquetas_fantasma * 2 +
            o.etiquetas_subfaturadas * 3 +
            o.cancelamentos_pdv * 2 +
            o.etiquetas_canceladas +
            o.descontos_altos_pdv
          return { ...o, taxa_cancelamento_pct: taxaCancelPct, score_alerta: scoreAlerta }
        })
        .filter((o) => o.score_alerta > 0)
        .sort((a, b) => b.score_alerta - a.score_alerta)

      fantasmas.sort((a, b) => Number(b.vencida) - Number(a.vencida) || b.valor_total - a.valor_total)
      subfaturadas.sort((a, b) => Number(b.abaixo_custo) - Number(a.abaixo_custo) || b.diferenca_valor - a.diferenca_valor)

      const fantasmaKg = Number(fantasmas.reduce((s, f) => s + f.peso_kg, 0).toFixed(2))
      const fantasmaValor = Number(fantasmas.reduce((s, f) => s + f.valor_total, 0).toFixed(2))
      const subfDiffValor = Number(subfaturadas.reduce((s, x) => s + x.diferenca_valor, 0).toFixed(2))

      return {
        success: true,
        parametros: { dias, dias_fantasma: diasFantasma },
        resumo: {
          fantasma_qtd: fantasmas.length,
          fantasma_kg: fantasmaKg,
          fantasma_valor: fantasmaValor,
          subfaturada_qtd: subfaturadas.length,
          subfaturada_diferenca_valor: subfDiffValor,
          canceladas_acougue_qtd: canceladasQtd,
          canceladas_acougue_kg: Number(canceladasKg.toFixed(2)),
          risco_total_valor: Number((fantasmaValor + subfDiffValor).toFixed(2)),
        },
        fantasmas: fantasmas.slice(0, 150),
        subfaturadas: subfaturadas.slice(0, 150),
        ranking_operadores: rankingOperadores.slice(0, 15),
      }
    },
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // 3) RONDA DE TEMPERATURA DAS CÂMARAS (CADEIA DE FRIO / LAUDO SIF)
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(
    '/api/governanca/temperatura',
    { preHandler: requirePermission(PERM_LP_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { dias?: string }
      const dias = Math.min(90, Math.max(1, Math.round(Number(q.dias || 7))))
      const dataCorte = somarDiasIso(hojeIsoLocal(), -dias)

      const rows = await conn.db
        .select()
        .from(camarasTemperaturaLog)
        .where(
          and(
            eq(camarasTemperaturaLog.tenantId, ctx.tenantId),
            eq(camarasTemperaturaLog.filialId, ctx.filialId),
            sql`DATE(${camarasTemperaturaLog.createdAt}) >= ${dataCorte}::date`,
          ),
        )
        .orderBy(desc(camarasTemperaturaLog.createdAt))
        .limit(400)

      const porLocal = new Map<
        string,
        {
          local_nome: string
          tipo_ambiente: string
          ultima_temp_c: number
          temp_min_c: number
          temp_max_c: number
          conforme: boolean
          desvio_c: number
          operador_nome: string
          ultima_leitura_em: string
          horas_desde_leitura: number
          total_leituras: number
          total_alertas: number
        }
      >()

      const nowMs = Date.now()
      for (const r of rows) {
        const key = r.localNome.toUpperCase()
        const existing = porLocal.get(key)
        if (!existing) {
          const dtMs = new Date(r.createdAt).getTime()
          porLocal.set(key, {
            local_nome: r.localNome,
            tipo_ambiente: r.tipoAmbiente,
            ultima_temp_c: toNum(r.temperaturaC, 0),
            temp_min_c: toNum(r.tempMinC, 0),
            temp_max_c: toNum(r.tempMaxC, 0),
            conforme: Number(r.conforme) === 1,
            desvio_c: toNum(r.desvioC, 0),
            operador_nome: r.operadorNome,
            ultima_leitura_em: new Date(r.createdAt).toISOString(),
            horas_desde_leitura: Number(Math.max(0, (nowMs - dtMs) / 3600000).toFixed(1)),
            total_leituras: 1,
            total_alertas: Number(r.conforme) === 0 ? 1 : 0,
          })
        } else {
          existing.total_leituras += 1
          if (Number(r.conforme) === 0) existing.total_alertas += 1
        }
      }

      const semaforo = Array.from(porLocal.values()).sort(
        (a, b) => Number(a.conforme) - Number(b.conforme) || a.local_nome.localeCompare(b.local_nome),
      )

      const conformes = rows.filter((r) => Number(r.conforme) === 1).length
      const alertas = rows.length - conformes
      const conformidadePct = rows.length > 0 ? Number(((conformes / rows.length) * 100).toFixed(1)) : 100

      return {
        success: true,
        periodo_dias: dias,
        faixas_padrao: FAIXAS_TEMPERATURA_SIF,
        resumo: {
          total_leituras: rows.length,
          leituras_conformes: conformes,
          alertas_fora_faixa: alertas,
          conformidade_pct: conformidadePct,
          locais_monitorados: semaforo.length,
          locais_em_alerta: semaforo.filter((s) => !s.conforme).length,
        },
        semaforo_locais: semaforo,
        historico: rows.map((r) => ({
          id: r.id,
          local_nome: r.localNome,
          tipo_ambiente: r.tipoAmbiente,
          temperatura_c: toNum(r.temperaturaC, 0),
          temp_min_c: toNum(r.tempMinC, 0),
          temp_max_c: toNum(r.tempMaxC, 0),
          conforme: Number(r.conforme) === 1,
          desvio_c: toNum(r.desvioC, 0),
          acao_corretiva: r.acaoCorretiva,
          operador_nome: r.operadorNome,
          created_at: r.createdAt,
        })),
      }
    },
  )

  app.post(
    '/api/governanca/temperatura',
    { preHandler: requirePermission(PERM_LP_WRITE) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        local_nome?: string
        tipo_ambiente?: string
        temperatura_c?: number | string
        temp_min_c?: number | string | null
        temp_max_c?: number | string | null
        acao_corretiva?: string
      }

      const localNome = String(body.local_nome || '').trim().toUpperCase()
      if (!localNome) throw new HttpError(400, 'Informe o nome da câmara, balcão ou local aferido.')

      const tipoRaw = String(body.tipo_ambiente || 'RESFRIADO').toUpperCase()
      const tipo = FAIXAS_TEMPERATURA_SIF[tipoRaw] ? tipoRaw : 'RESFRIADO'
      const faixa = FAIXAS_TEMPERATURA_SIF[tipo]

      const temp = toNum(body.temperatura_c, NaN)
      if (!Number.isFinite(temp) || temp < -50 || temp > 60) {
        throw new HttpError(400, 'Informe uma temperatura válida em °C (entre -50°C e 60°C).')
      }

      const tempMin =
        body.temp_min_c != null && body.temp_min_c !== '' ? toNum(body.temp_min_c, faixa.min) : faixa.min
      const tempMax =
        body.temp_max_c != null && body.temp_max_c !== '' ? toNum(body.temp_max_c, faixa.max) : faixa.max
      if (tempMin >= tempMax) {
        throw new HttpError(400, 'Temperatura mínima da faixa deve ser menor que a máxima.')
      }

      const conforme = temp >= tempMin && temp <= tempMax ? 1 : 0
      const desvioC =
        conforme === 1 ? 0 : temp > tempMax ? Number((temp - tempMax).toFixed(2)) : Number((temp - tempMin).toFixed(2))
      const acao = String(body.acao_corretiva || '').trim()
      const id = uuidv7()

      await conn.db.transaction(async (tx) => {
        await tx.insert(camarasTemperaturaLog).values({
          id,
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          localNome,
          tipoAmbiente: tipo,
          temperaturaC: toDec(temp, 2),
          tempMinC: toDec(tempMin, 2),
          tempMaxC: toDec(tempMax, 2),
          conforme,
          desvioC: toDec(desvioC, 2),
          acaoCorretiva: acao,
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
        })

        if (conforme === 0) {
          await tx.insert(auditoriaAcessos).values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            targetUserNome: localNome,
            acao: 'ALERTA_TEMPERATURA_CAMARA',
            detalhesDepois: {
              local_nome: localNome,
              tipo_ambiente: tipo,
              temperatura_c: temp,
              faixa: `${tempMin}°C a ${tempMax}°C`,
              desvio_c: desvioC,
              acao_corretiva: acao,
            },
            executorId: ctx.operador.id,
            executorNome: ctx.operador.nome,
          })
        }
      })

      return reply.status(201).send({
        success: true,
        data: {
          id,
          local_nome: localNome,
          tipo_ambiente: tipo,
          temperatura_c: temp,
          temp_min_c: tempMin,
          temp_max_c: tempMax,
          conforme: conforme === 1,
          desvio_c: desvioC,
          acao_corretiva: acao,
        },
      })
    },
  )
}
